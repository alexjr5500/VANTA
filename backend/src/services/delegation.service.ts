import { prisma } from '../prisma';
import type { Prisma } from '@prisma/client';

const DAY=86400000;
const identity={id:true,username:true} as const;
const grantSelect={id:true,ownerId:true,delegateId:true,owner:{select:identity},delegate:{select:identity},scope:true,status:true,createdAt:true,invitationExpiresAt:true,acceptedAt:true,expiresAt:true,endedAt:true} as const;
export const DELEGATION_SCOPE='CONTENT_ANALYTICS';
type DB=Prisma.TransactionClient;
async function assertAccounts(db:DB,ownerId:string,delegateId:string){
  if(!ownerId||!delegateId||ownerId===delegateId)throw new Error('Invalid delegation');
  const [users,block]=await Promise.all([
    db.user.count({where:{id:{in:[ownerId,delegateId]},status:'ACTIVE'}}),
    db.blockedUser.findFirst({where:{OR:[{userId:ownerId,targetId:delegateId},{userId:delegateId,targetId:ownerId}]},select:{id:true}}),
  ]);
  if(users!==2||block)throw new Error('Delegation is unavailable between these accounts');
}
function liveGrant(now:Date){
  return {OR:[{status:'PENDING',invitationExpiresAt:{gt:now}},{status:'ACTIVE',expiresAt:{gt:now}}]};
}
export async function listDelegations(userId:string){
  const [outgoing,incoming]=await Promise.all([
    prisma.accountDelegation.findMany({where:{ownerId:userId},select:grantSelect,orderBy:{createdAt:'desc'},take:100}),
    prisma.accountDelegation.findMany({where:{delegateId:userId},select:grantSelect,orderBy:{createdAt:'desc'},take:100}),
  ]);
  const now=new Date();
  const normalize=(item:typeof outgoing[number])=>({...item,status:(item.status==='PENDING'&&item.invitationExpiresAt<=now)||(item.status==='ACTIVE'&&(!item.expiresAt||item.expiresAt<=now))?'EXPIRED':item.status});
  return {outgoing:outgoing.map(normalize),incoming:incoming.map(normalize)};
}
export async function inviteDelegate(ownerId:string,username:string){
  return prisma.$transaction(async tx=>{
    // Serialize issuance per owner. No duplicate active grants or unlimited
    // outstanding invitations even when requests arrive concurrently.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'delegation:'+ownerId})::bigint)`;
    const target=await tx.user.findFirst({where:{username:{equals:username,mode:'insensitive'},status:'ACTIVE'},select:identity});
    if(!target)throw new Error('Account unavailable');
    await assertAccounts(tx,ownerId,target.id);
    const now=new Date();
    const existing=await tx.accountDelegation.findFirst({where:{ownerId,delegateId:target.id,...liveGrant(now)},select:grantSelect});
    if(existing)return {grant:existing,created:false};
    const [outstanding,recent]=await Promise.all([
      tx.accountDelegation.count({where:{ownerId,...liveGrant(now)}}),
      tx.accountDelegation.count({where:{ownerId,createdAt:{gte:new Date(now.getTime()-DAY)}}}),
    ]);
    if(outstanding>=20||recent>=20)throw new Error('Delegation invitation limit reached');
    const grant=await tx.accountDelegation.create({data:{ownerId,delegateId:target.id,scope:DELEGATION_SCOPE,invitationExpiresAt:new Date(now.getTime()+7*DAY)},select:grantSelect});
    return {grant,created:true};
  });
}
export async function respondToDelegation(delegateId:string,id:string,accept:boolean){
  return prisma.$transaction(async tx=>{
    const grant=await tx.accountDelegation.findFirst({where:{id,delegateId,scope:DELEGATION_SCOPE,status:'PENDING',invitationExpiresAt:{gt:new Date()}},select:{ownerId:true}});
    if(!grant)throw new Error('Invitation expired or unavailable');
    if(accept)await assertAccounts(tx,grant.ownerId,delegateId);
    const now=new Date();
    const result=await tx.accountDelegation.updateMany({where:{id,delegateId,status:'PENDING',invitationExpiresAt:{gt:now}},data:accept?{status:'ACTIVE',acceptedAt:now,expiresAt:new Date(now.getTime()+30*DAY)}:{status:'DECLINED',endedAt:now}});
    if(result.count!==1)throw new Error('Invitation already reviewed');
  });
}
export async function endDelegation(userId:string,id:string){
  const result=await prisma.accountDelegation.updateMany({where:{id,OR:[{ownerId:userId},{delegateId:userId}],status:{in:['PENDING','ACTIVE']}},data:{status:'REVOKED',endedAt:new Date()}});
  return result.count===1;
}
export async function readDelegatedAnalytics(delegateId:string,id:string){
  return prisma.$transaction(async tx=>{
    // Lock the exact grant during this read. Revocation is serialized against
    // it; no owner-id override or general-purpose impersonation exists.
    const rows=await tx.$queryRaw<Array<{id:string;ownerId:string}>>`SELECT "id","ownerId" FROM "AccountDelegation" WHERE "id"=${id} AND "delegateId"=${delegateId} AND "scope"='CONTENT_ANALYTICS' AND "status"='ACTIVE' AND "expiresAt">CURRENT_TIMESTAMP FOR SHARE`;
    const grant=rows[0];
    if(!grant)throw new Error('Delegated access unavailable');
    await assertAccounts(tx,grant.ownerId,delegateId);
    const ownerId=grant.ownerId;
    const post={authorId:ownerId,moderationRemovedAt:null};
    const reel={creatorId:ownerId,publishStatus:'PUBLISHED',moderationRemovedAt:null,videoUrl:{not:null}};
    const [followers,posts,reels,postLikes,reelLikes,postComments,reelComments]=await Promise.all([
      tx.follow.count({where:{followingId:ownerId}}),
      tx.post.aggregate({where:post,_count:{_all:true},_sum:{views:true,shareCount:true}}),
      tx.video.aggregate({where:reel,_count:{_all:true},_sum:{views:true}}),
      tx.postLike.count({where:{post}}),
      tx.videoLike.count({where:{video:reel}}),
      tx.postComment.count({where:{post,moderationRemovedAt:null}}),
      tx.videoComment.count({where:{video:reel,moderationRemovedAt:null}}),
    ]);
    return {followers,posts:posts._count._all,reels:reels._count._all,postViews:posts._sum.views??0,reelViews:reels._sum.views??0,likes:postLikes+reelLikes,comments:postComments+reelComments,postShares:posts._sum.shareCount??0};
  });
}
