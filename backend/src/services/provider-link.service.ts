import { prisma } from '../prisma';

type Identity={providerAccountId:string;email?:string;displayName?:string;avatarUrl?:string;metadata?:string};
type Pending={id:string;provider:string;identity:Identity};
type CredentialSnapshot={passwordHash:string|null;emailVerified:boolean;status:string;twoFactorEnabled:boolean;twoFactorSecret:string|null};

export async function getPendingProviderLink(userId:string,sessionId:string,id:string):Promise<Pending|null>{
  if(!userId||!sessionId||! /^[A-Za-z0-9_-]{16,64}$/.test(id))return null;
  const record=await prisma.oAuthState.findFirst({where:{id,linkingUserId:userId,linkingSessionId:sessionId,consumedAt:{not:null},linkedAt:null,expiresAt:{gt:new Date()},verifiedLinkIdentity:{not:null}},select:{id:true,provider:true,verifiedLinkIdentity:true}});
  if(!record?.verifiedLinkIdentity||!['google','telegram'].includes(record.provider))return null;
  const identity=JSON.parse(record.verifiedLinkIdentity) as Identity;
  if(typeof identity.providerAccountId!=='string'||!identity.providerAccountId)return null;
  return {id:record.id,provider:record.provider,identity};
}

export async function confirmProviderLink(userId:string,sessionId:string,pending:Pending,credentials:CredentialSnapshot){
  return prisma.$transaction(async tx=>{
    // Serialize credential verification with a row write; concurrent password
    // changes or 2FA changes must not authorize a stale approval.
    const verified=await tx.user.updateMany({where:{id:userId,status:'ACTIVE',emailVerified:true,passwordHash:credentials.passwordHash,twoFactorEnabled:credentials.twoFactorEnabled,twoFactorSecret:credentials.twoFactorSecret,OR:[{lockedUntil:null},{lockedUntil:{lte:new Date()}}]},data:{emailVerified:true}});
    if(verified.count!==1)throw new Error('Credentials changed');
    const session=await tx.session.findFirst({where:{id:sessionId,userId,expiresAt:{gt:new Date()}},select:{id:true}});
    if(!session)throw new Error('Session expired');
    const claimed=await tx.oAuthState.updateMany({where:{id:pending.id,provider:pending.provider,linkingUserId:userId,linkingSessionId:sessionId,consumedAt:{not:null},linkedAt:null,expiresAt:{gt:new Date()},verifiedLinkIdentity:{not:null}},data:{linkedAt:new Date(),verifiedLinkIdentity:null}});
    if(claimed.count!==1)throw new Error('Link request expired');
    await tx.providerAccount.create({data:{userId,provider:pending.provider,providerAccountId:pending.identity.providerAccountId,email:pending.identity.email,displayName:pending.identity.displayName,avatarUrl:pending.identity.avatarUrl,metadata:pending.identity.metadata}});
  });
}
