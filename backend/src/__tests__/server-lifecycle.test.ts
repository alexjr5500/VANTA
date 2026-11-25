import express from 'express';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { ServerReadiness, BackgroundDrain, shutdownWithin } from '../services/server-lifecycle';

describe('server traffic readiness', () => {
  it('reports startup, database failure, redis failure and irreversible draining', async () => {
    let db = false;
    let redis = true;
    const state = new ServerReadiness(async () => { if (!db) throw Error('private connection details'); }, () => redis, 20, 0);
    expect(await state.readiness()).toEqual({ status: 'not_ready', reason: 'starting' });
    state.markServing();
    expect(await state.readiness()).toEqual({ status: 'not_ready', reason: 'database' });
    db = true;
    redis = false;
    expect(await state.readiness()).toEqual({ status: 'not_ready', reason: 'redis' });
    redis = true;
    expect(await state.readiness()).toEqual({ status: 'ready' });
    state.beginDrain();
    state.markServing();
    expect(await state.readiness()).toEqual({ status: 'not_ready', reason: 'draining' });
  });
  it('bounds slow probe responses without creating additional outstanding queries', async () => {
    let finish!: () => void;
    const probe = jest.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const state = new ServerReadiness(probe, () => true, 10, 1000);
    state.markServing();
    const results = await Promise.all(Array.from({ length: 12 }, () => state.readiness()));
    expect(results.every(r => r.status === 'not_ready')).toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(await state.readiness()).toEqual({ status: 'not_ready', reason: 'database' });
    finish();
    await new Promise<void>(resolve => setImmediate(resolve));
    await expect(state.readiness()).resolves.toEqual({ status: 'ready' });
    expect(probe).toHaveBeenCalledTimes(1);
  });
  it('serves real HTTP readiness and liveness and rejects new work while allowing accepted work to finish', async () => {
    const state = new ServerReadiness(async () => {});
    const app = express();
    app.get('/health/live', state.liveHandler);
    app.get('/health/ready', state.readyHandler);
    app.use(state.drainMiddleware);
    let accepted!: () => void;
    let finish!: () => void;
    const entered = new Promise<void>(r => { accepted = r; });
    const gate = new Promise<void>(r => { finish = r; });
    app.get('/work', async (_req, res) => { accepted(); await gate; res.send('done'); });
    const server = createServer(app);
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
    const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
    try {
      expect((await fetch(base + '/health/ready')).status).toBe(503);
      state.markServing();
      expect((await fetch(base + '/health/ready')).status).toBe(200);
      const inFlight = fetch(base + '/work');
      await entered;
      state.beginDrain();
      expect((await fetch(base + '/health/live')).status).toBe(200);
      expect((await fetch(base + '/health/ready')).status).toBe(503);
      expect((await fetch(base + '/work')).status).toBe(503);
      finish();
      expect(await (await inFlight).text()).toBe('done');
    } finally {
      finish();
      server.closeAllConnections();
      await new Promise<void>(resolve => { server.close(() => resolve()); });
    }
  });
});

describe('bounded shutdown', () => {
  it('stops repeated tasks and waits for one already-running task', async () => {
    const drain = new BackgroundDrain();
    let finish!: () => void;
    const task = jest.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    drain.schedule(task, 5);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(task).toHaveBeenCalledTimes(1);
    const stopping = drain.stop();
    drain.schedule(task, 5);
    finish();
    await stopping;
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(task).toHaveBeenCalledTimes(1);
  });
  it('bounds hangs and reports errors rather than claiming successful shutdown', async () => {
    await expect(shutdownWithin(async () => {}, 50)).resolves.toBe(true);
    await expect(shutdownWithin(async () => { throw Error('failed'); }, 50)).resolves.toBe(false);
    await expect(shutdownWithin(() => new Promise<void>(() => {}), 10)).resolves.toBe(false);
  });
});
