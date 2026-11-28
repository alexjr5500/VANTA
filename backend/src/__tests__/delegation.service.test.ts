import {prisma} from '../prisma';
import {endDelegation,inviteDelegate,readDelegatedAnalytics,respondToDelegation} from '../services/delegation.service';
jest.mock('../prisma',()=>({prisma:{$transaction:jest.fn(),$queryRaw:jest.fn(),accountDelegation:{findFirst:jest.fn(),updateMany:jest.fn()},user:{count:jest.fn(),updateMany:jest.fn(),findFirst:jest.fn()},blockedUser:{findFirst:jest.fn()},follow:{count:jest.fn()},post:{aggregate:jest.fn()},video:{aggregate:jest.fn()},postLike:{count:jest.fn()},videoLike:{count:jest.fn()},postComment:{count:jest.fn()},videoComment:{count:jest.fn()}}}));
describe('scoped delegation',()=>{
  beforeEach(()=>{jest.resetAllMocks();(prisma.$transaction as jest.Mock).mockImplementation(async fn=>fn(prisma));});
  test('invitation refuses changed credentials and a revoked session before looking up a delegate',async()=>{
    const approval={sessionId:'session',passwordHash:'hash',twoFactorEnabled:true,twoFactorSecret:'secret'};
    (prisma.user.updateMany as jest.Mock).mockResolvedValueOnce({count:0});
    await expect(inviteDelegate('owner','target',approval)).rejects.toThrow('Credentials changed');
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    (prisma.user.updateMany as jest.Mock).mockResolvedValueOnce({count:1});
    (prisma.$queryRaw as jest.Mock).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await expect(inviteDelegate('owner','target',approval)).rejects.toThrow('Session expired');
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(prisma.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({id:'owner',passwordHash:'hash',twoFactorEnabled:true,twoFactorSecret:'secret'})}));
  });
  test('unknown, revoked, expired or foreign grant never reads analytics',async()=>{
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
    await expect(readDelegatedAnalytics('delegate','grant')).rejects.toThrow('unavailable');
    expect(prisma.post.aggregate).not.toHaveBeenCalled();
    expect((prisma.$queryRaw as jest.Mock).mock.calls[0].slice(1)).toEqual(['grant','delegate']);
  });
  test('grant recipient alone can accept and revocation is scoped to either party',async()=>{
    (prisma.accountDelegation.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(respondToDelegation('wrong','grant',true)).rejects.toThrow('unavailable');
    expect(prisma.accountDelegation.updateMany).not.toHaveBeenCalled();
    (prisma.accountDelegation.updateMany as jest.Mock).mockResolvedValue({count:0});
    expect(await endDelegation('wrong','grant')).toBe(false);
    expect(prisma.accountDelegation.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:{id:'grant',OR:[{ownerId:'wrong'},{delegateId:'wrong'}],status:{in:['PENDING','ACTIVE']}}}));
  });
  test('active grant only reads the authorized owner and published nonremoved content',async()=>{
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{id:'grant',ownerId:'owner'}]);
    (prisma.user.count as jest.Mock).mockResolvedValue(2);
    (prisma.blockedUser.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.follow.count as jest.Mock).mockResolvedValue(5);
    (prisma.post.aggregate as jest.Mock).mockResolvedValue({_count:{_all:2},_sum:{views:10,shareCount:1}});
    (prisma.video.aggregate as jest.Mock).mockResolvedValue({_count:{_all:3},_sum:{views:20}});
    for(const model of [prisma.postLike,prisma.videoLike,prisma.postComment,prisma.videoComment])(model.count as jest.Mock).mockResolvedValue(1);
    expect(await readDelegatedAnalytics('delegate','grant')).toEqual({followers:5,posts:2,reels:3,postViews:10,reelViews:20,likes:2,comments:2,postShares:1});
    expect(prisma.video.aggregate).toHaveBeenCalledWith(expect.objectContaining({where:{creatorId:'owner',publishStatus:'PUBLISHED',moderationRemovedAt:null,videoUrl:{not:null}}}));
  });
});
