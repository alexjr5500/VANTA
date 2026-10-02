jest.mock('../prisma', () => ({ prisma: {
  group: { findUnique: jest.fn(), update: jest.fn() },
  groupMember: { findUnique: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
  participant: { updateMany: jest.fn(), findUnique: jest.fn(), upsert: jest.fn() },
  conversation: { findUnique: jest.fn(), update: jest.fn() },
  groupMessage: { findMany: jest.fn() },
  $transaction: jest.fn(),
} }));
jest.mock('../security/auditLog', () => ({ auditLog: { log: jest.fn().mockResolvedValue(undefined) } }));

import { prisma } from '../prisma';
import { GroupService } from '../services/group.service';

const db = prisma as jest.Mocked<typeof prisma>;
const service = new GroupService();

const makeGroup = (overrides: any = {}) => ({
  id: 'group-1',
  name: 'Test Group',
  description: 'desc',
  ownerId: 'owner-1',
  conversationId: 'conversation-1',
  members: [
    { userId: 'owner-1', role: 'ADMIN' },
    { userId: 'member-1', role: 'MEMBER' },
  ],
  ...overrides,
});

describe('GroupService ownership transfer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (db.$transaction as jest.Mock).mockImplementation((callback: any) => callback(db));
    (db.conversation.findUnique as jest.Mock).mockResolvedValue({ permissions: null });
  });

  it('transfers ownership atomically and promotes the new owner', async () => {
    (db.group.findUnique as jest.Mock)
      .mockResolvedValueOnce(makeGroup())
      .mockResolvedValueOnce(makeGroup({ ownerId: 'member-1' }));
    (db.group.update as jest.Mock).mockResolvedValue({});
    (db.groupMember.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (db.participant.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

    const result = await service.transferOwnership('group-1', 'owner-1', 'member-1');

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.group.update).toHaveBeenCalledWith({
      where: { id: 'group-1' },
      data: { ownerId: 'member-1' },
    });
    expect(db.groupMember.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { groupId: 'group-1', userId: 'member-1' }, data: { role: 'ADMIN' } })
    );
    expect(result.ownerId).toBe('member-1');
  });

  it('rejects a non-owner who tries to transfer ownership', async () => {
    (db.group.findUnique as jest.Mock).mockResolvedValue(makeGroup());
    await expect(service.transferOwnership('group-1', 'member-1', 'owner-1')).rejects.toThrow(
      'Only the group owner can transfer ownership'
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('rejects transferring to a user who is not a member', async () => {
    (db.group.findUnique as jest.Mock).mockResolvedValue(makeGroup());
    await expect(service.transferOwnership('group-1', 'owner-1', 'outsider-1')).rejects.toThrow(
      'The selected member is no longer part of this group'
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('rejects transferring to yourself', async () => {
    (db.group.findUnique as jest.Mock).mockResolvedValue(makeGroup());
    await expect(service.transferOwnership('group-1', 'owner-1', 'owner-1')).rejects.toThrow(
      'You are already the owner of this group'
    );
  });
});

describe('GroupService member permissions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (db.$transaction as jest.Mock).mockImplementation((callback: any) => callback(db));
    (db.conversation.findUnique as jest.Mock).mockResolvedValue({ permissions: '{}' });
  });

  it('allows a member to add people only when addMembers is enabled', async () => {
    // Permission ON: member may add.
    (db.group.findUnique as jest.Mock).mockResolvedValue(makeGroup());
    (db.conversation.findUnique as jest.Mock).mockResolvedValue({ permissions: '{"addMembers":true}' });
    (db.groupMember.findUnique as jest.Mock)
      .mockResolvedValueOnce({ id: 'req', role: 'MEMBER', userId: 'member-1' })
      .mockResolvedValueOnce(null); // target not already a member
    (db.groupMember.create as jest.Mock).mockResolvedValue({ id: 'added', groupId: 'group-1', userId: 'newbie' });
    (db.participant.upsert as jest.Mock).mockResolvedValue({});
    const added = await service.addMember('group-1', 'newbie', 'member-1');
    expect(added.id).toBe('added');

    // Permission OFF: member is rejected at the backend, even if the UI hid it.
    jest.clearAllMocks();
    (db.conversation.findUnique as jest.Mock).mockResolvedValue({ permissions: '{}' });
    (db.group.findUnique as jest.Mock).mockResolvedValue(makeGroup());
    (db.groupMember.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'req', role: 'MEMBER', userId: 'member-1' });
    await expect(service.addMember('group-1', 'newbie', 'member-1')).rejects.toThrow('Unauthorized');
    expect(db.groupMember.create).not.toHaveBeenCalled();
  });

  it('blocks members from editing group info without changeGroupInfo', async () => {
    (db.group.findUnique as jest.Mock).mockResolvedValue(makeGroup());
    (db.conversation.findUnique as jest.Mock).mockResolvedValue({ permissions: '{}' });
    await expect(
      service.updateGroup('group-1', 'member-1', { name: 'Hacked Name' })
    ).rejects.toThrow("You do not have permission to edit this group's information");
  });

  it('allows a member with changeGroupInfo to edit the name', async () => {
    (db.group.findUnique as jest.Mock).mockResolvedValue(makeGroup());
    (db.conversation.findUnique as jest.Mock)
      .mockResolvedValueOnce({ permissions: '{"changeGroupInfo":true}' })
      .mockResolvedValue({ permissions: null });
    (db.group.update as jest.Mock).mockResolvedValue({ id: 'group-1', name: 'Edited' });
    const result = await service.updateGroup('group-1', 'member-1', { name: 'Edited' });
    expect(result.name).toBe('Edited');
  });
});

describe('GroupService message access', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects reading messages for non-members', async () => {
    (db.groupMember.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(service.getMessages('group-1', 'outsider-1')).rejects.toThrow(
      'Not a member of this group'
    );
    expect(db.groupMessage.findMany).not.toHaveBeenCalled();
  });

  it('allows members to read messages', async () => {
    (db.groupMember.findUnique as jest.Mock).mockResolvedValue({ id: 'gm' });
    (db.groupMessage.findMany as jest.Mock).mockResolvedValue([]);
    const result = await service.getMessages('group-1', 'member-1', undefined, 20);
    expect(result.items).toEqual([]);
    expect(db.groupMessage.findMany).toHaveBeenCalledTimes(1);
  });
});