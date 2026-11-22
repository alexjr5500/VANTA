import type { PrismaClient } from '@prisma/client';
import { ensureInitialAdministrator } from '../../prisma/ensure-initial-administrator';

const identity = { email: 'admin@example.test', username: 'alex', fullName: 'Admin' };

function fakeClient(existing: object | null) {
  const findFirst = jest.fn().mockResolvedValue(existing);
  const create = jest.fn().mockResolvedValue({ id: 'new-admin' });
  return { client: { user: { findFirst, create } } as unknown as Pick<PrismaClient, 'user'>, findFirst, create };
}

describe('initial administrator bootstrap', () => {
  it('never changes an existing administrator or reads the bootstrap password', async () => {
    const { client, findFirst, create } = fakeClient({ id: 'existing-admin', role: 'USER', status: 'SUSPENDED' });
    const password = jest.fn(() => 'unused-secret');
    await expect(ensureInitialAdministrator(client, identity, password)).resolves.toBe('existing');
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(password).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('creates a missing administrator with hashed credentials and verified admin role', async () => {
    const { client, create } = fakeClient(null);
    const password = jest.fn(() => 'bootstrap-password');
    await expect(ensureInitialAdministrator(client, identity, password)).resolves.toBe('created');
    expect(password).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({ email: identity.email, username: 'alex', role: 'ADMIN', status: 'ACTIVE', verified: true, emailVerified: true });
    expect(data.passwordHash).not.toBe('bootstrap-password');
    expect(data.passwordHash.startsWith('$2')).toBe(true);
  });
});
