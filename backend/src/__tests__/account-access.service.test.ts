import { prisma } from '../prisma';
import { activeAccountSessions, revokeOtherAccountSessions, connectedIdentities, removeTrustedDeviceRecord } from '../services/account-access.service';

jest.mock('../prisma', () => ({ prisma: {
  session: { findMany: jest.fn(), deleteMany: jest.fn() },
  providerAccount: { findMany: jest.fn() },
  trustedDevice: { deleteMany: jest.fn() },
} }));
describe('account access settings', () => {
  beforeEach(() => jest.resetAllMocks());
  test('preserves the current session when signing out others', async () => {
    (prisma.session.deleteMany as jest.Mock).mockResolvedValue({ count: 2 });
    expect(await revokeOtherAccountSessions('owner','current')).toBe(2);
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'owner', id: { not: 'current' } } });
    await expect(revokeOtherAccountSessions('owner','')).rejects.toThrow();
  });
  test('marks current session without selecting credentials', async () => {
    (prisma.session.findMany as jest.Mock).mockResolvedValue([{ id: 'current' }, { id: 'other' }]);
    expect(await activeAccountSessions('owner','current')).toEqual([{ id:'current',isCurrent:true }, {id:'other',isCurrent:false}]);
    expect((prisma.session.findMany as jest.Mock).mock.calls[0][0].select.token).toBeUndefined();
    expect((prisma.session.findMany as jest.Mock).mock.calls[0][0].select.refreshToken).toBeUndefined();
  });
  test('provider identity list and trust removal are scoped to the authenticated account', async () => {
    (prisma.providerAccount.findMany as jest.Mock).mockResolvedValue([]);
    await connectedIdentities('owner');
    const query = (prisma.providerAccount.findMany as jest.Mock).mock.calls[0][0];
    expect(query.where).toEqual({userId:'owner'});
    expect(query.select.providerAccountId).toBeUndefined();
    (prisma.trustedDevice.deleteMany as jest.Mock).mockResolvedValue({count:0});
    expect(await removeTrustedDeviceRecord('owner','another-device')).toBe(false);
    expect(prisma.trustedDevice.deleteMany).toHaveBeenCalledWith({where:{userId:'owner',id:'another-device'}});
  });
});
