import { prisma } from '../prisma';
import { getPendingProviderLink, confirmProviderLink } from '../services/provider-link.service';
jest.mock('../prisma',()=>({prisma:{oAuthState:{findFirst:jest.fn(),updateMany:jest.fn()},user:{updateMany:jest.fn()},session:{findFirst:jest.fn()},providerAccount:{create:jest.fn()},$transaction:jest.fn()}}));
describe('provider link approval',()=>{
  beforeEach(()=>{jest.resetAllMocks();(prisma.$transaction as jest.Mock).mockImplementation(async fn=>fn(prisma));});
  test('lookup requires the original owner and original session',async()=>{
    (prisma.oAuthState.findFirst as jest.Mock).mockResolvedValue(null);
    expect(await getPendingProviderLink('owner','session','1234567890123456789012')).toBeNull();
    expect(prisma.oAuthState.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({linkingUserId:'owner',linkingSessionId:'session',linkedAt:null})}));
  });
  test('expired or already claimed link cannot create a provider credential',async()=>{
    (prisma.user.updateMany as jest.Mock).mockResolvedValue({count:1});
    (prisma.session.findFirst as jest.Mock).mockResolvedValue({id:'session'});
    (prisma.oAuthState.updateMany as jest.Mock).mockResolvedValue({count:0});
    await expect(confirmProviderLink('owner','session',{id:'pending',provider:'google',identity:{providerAccountId:'external'}},{passwordHash:'hash',emailVerified:true,status:'ACTIVE',twoFactorEnabled:false,twoFactorSecret:null})).rejects.toThrow('Link request expired');
    expect(prisma.providerAccount.create).not.toHaveBeenCalled();
  });
});
