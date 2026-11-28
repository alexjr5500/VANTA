import type { Server } from 'socket.io';
import { observeRoomPresence, PresenceTransitions } from '../services/realtime-presence';

const room = (fetchSockets: () => Promise<unknown[]>) =>
  ({ in: () => ({ fetchSockets }) }) as unknown as Pick<Server, 'in'>;

describe('presence safety', () => {
  it('does not report offline for a local or remote connection', async () => {
    const fetch = jest.fn(async () => []);
    await expect(observeRoomPresence(room(fetch), 'u1', () => false, () => 1)).resolves.toBe('online');
    expect(fetch).not.toHaveBeenCalled();
    await expect(observeRoomPresence(room(async () => [{ id: 'remote' }]), 'u1', () => true, () => 0)).resolves.toBe('online');
  });
  it('treats failed lookup and dependency loss as unknown', async () => {
    await expect(observeRoomPresence(room(async () => { throw Error('timeout'); }), 'u1', () => true, () => 0)).resolves.toBe('unknown');
    let ready = true;
    await expect(observeRoomPresence(room(async () => { ready = false; return []; }), 'u1', () => ready, () => 0)).resolves.toBe('unknown');
    await expect(observeRoomPresence(room(async () => []), 'u1', () => true, () => 0)).resolves.toBe('offline');
  });
  it('rechecks local connections after an async cluster lookup', async () => {
    let local = 0;
    await expect(observeRoomPresence(room(async () => { local = 1; return []; }), 'u1', () => true, () => local)).resolves.toBe('online');
  });
  it('serializes local transitions per user and recovers from rejected work', async () => {
    const coordinator = new PresenceTransitions();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const one = coordinator.run('u1', async () => { order.push('first'); await gate; throw Error('failed'); });
    const handled = one.catch(() => undefined);
    const two = coordinator.run('u1', async () => { order.push('second'); });
    await coordinator.run('u2', async () => { order.push('independent'); });
    expect(order).toEqual(['first', 'independent']);
    release();
    await Promise.all([handled, two]);
    expect(order).toEqual(['first', 'independent', 'second']);
  });
});
