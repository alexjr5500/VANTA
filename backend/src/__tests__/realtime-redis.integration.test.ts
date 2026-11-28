import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import { Server } from 'socket.io';
import { io as connect, Socket } from 'socket.io-client';
import { RealtimeRedisAdapter, realtimeRedisConfig } from '../services/realtime-redis-adapter';
import { observeRoomPresence } from '../services/realtime-presence';

describe('realtime adapter configuration', () => {
  it('keeps the default local adapter and rejects incomplete or unsafe configuration', () => {
    expect(realtimeRedisConfig({})).toBeNull();
    const env = { VANTA_SOCKET_REDIS_ENABLED: 'true', VANTA_SOCKET_REDIS_URL: 'redis://127.0.0.1:6379',
      VANTA_SOCKET_REDIS_PREFIX: 'vanta:ci:socket', VANTA_SOCKET_REDIS_TRANSPORT: 'websocket' };
    expect(realtimeRedisConfig(env)?.transport).toBe('websocket');
    expect(() => realtimeRedisConfig({ ...env, VANTA_SOCKET_REDIS_PREFIX: 'socket.io' })).toThrow();
    expect(() => realtimeRedisConfig({ ...env, VANTA_SOCKET_REDIS_TRANSPORT: 'polling' })).toThrow();
    expect(() => realtimeRedisConfig({ ...env, VANTA_SOCKET_REDIS_URL: 'https://example.com' })).toThrow();
  });
});

const url = process.env.VANTA_CI_REDIS_URL;
const suite = url ? describe : describe.skip;
suite('two independent Socket.IO servers over isolated Redis', () => {
  const channelPrefix = 'vanta:ci-' + randomUUID() + ':socket';
  const adapters: RealtimeRedisAdapter[] = [];
  const servers: Server[] = [];
  const sockets: Socket[] = [];
  const bases: string[] = [];
  async function addServer() {
    const http = createServer();
    const server = new Server(http, { transports: ['websocket'] });
    servers.push(server);
    const adapter = new RealtimeRedisAdapter({ url: url!, channelPrefix, transport: 'websocket' });
    adapters.push(adapter);
    await adapter.start(server);
    // Test-only identity mapping; real application authorization is unchanged.
    server.use((socket, next) => {
      const identity = socket.handshake.auth.identity;
      if (identity !== 'alice' && identity !== 'bob' && identity !== 'carol') return next(new Error('unauthorized'));
      socket.data.userId = identity;
      next();
    });
    server.on('connection', socket => {
      void Promise.resolve(socket.join('user_' + socket.data.userId)).then(() => socket.emit('joined'));
    });
    await new Promise<void>(resolve => { http.listen(0, '127.0.0.1', resolve); });
    bases.push('http://127.0.0.1:' + (http.address() as AddressInfo).port);
  }
  async function client(index: number, identity: string): Promise<Socket> {
    const socket = connect(bases[index], { transports: ['websocket'], auth: { identity },
      autoConnect: false, reconnection: false, timeout: 3000 });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('client join timeout')), 4000);
      socket.once('connect_error', error => { clearTimeout(timer); reject(error); });
      socket.once('joined', () => { clearTimeout(timer); resolve(); });
      socket.connect();
    });
    return socket;
  }
  beforeAll(async () => { await addServer(); await addServer(); }, 20000);
  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    await Promise.all(servers.map(server => new Promise<void>(resolve => { void server.close(() => resolve()); })));
    adapters.forEach(adapter => adapter.close());
  }, 15000);
  it('delivers a targeted event to a remote room, not another user, and resolves remote socket lookup', async () => {
    const alice = await client(1, 'alice');
    const bob = await client(0, 'bob');
    const unwanted = jest.fn();
    bob.on('private-event', unwanted);
    // The first distributed lookup also confirms the adapter's subscriptions.
    const remote = await servers[0].in('user_alice').fetchSockets();
    expect(remote.map(socket => socket.id)).toContain(alice.id);
    const delivered = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('cross-server delivery timeout')), 4000);
      alice.once('private-event', payload => { clearTimeout(timer); resolve(payload); });
    });
    servers[0].to('user_alice').emit('private-event', { messageId: 'synthetic-1' });
    await expect(delivered).resolves.toEqual({ messageId: 'synthetic-1' });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(unwanted).not.toHaveBeenCalled();
    expect(adapters.every(adapter => adapter.ready)).toBe(true);
  }, 12000);
  it('keeps a user online when a second server still holds their socket', async () => {
    const first = await client(0, 'carol');
    const second = await client(1, 'carol');
    const leave = async (socket: Socket, server: Server) => {
      const remote = server.sockets.sockets.get(socket.id!);
      if (!remote) throw new Error('Missing local test socket');
      const disconnected = new Promise<void>(resolve => { remote.once('disconnect', () => resolve()); });
      socket.disconnect();
      await disconnected;
    };
    await leave(first, servers[0]);
    await expect(observeRoomPresence(servers[0], 'carol', () => adapters[0].ready, () => 0)).resolves.toBe('online');
    await leave(second, servers[1]);
    await expect(observeRoomPresence(servers[0], 'carol', () => adapters[0].ready, () => 0)).resolves.toBe('offline');
    await expect(observeRoomPresence(servers[0], 'carol', () => false, () => 0)).resolves.toBe('unknown');
  }, 12000);
});
