import express from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ServerReadiness } from '../services/server-lifecycle';

async function listen(app: express.Express) {
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: 'http://127.0.0.1:' + (server.address() as AddressInfo).port };
}

describe('isolated two-replica HTTP routing', () => {
  it('distributes traffic, removes draining replicas and fails closed', async () => {
    const servers: Server[] = [];
    let accepted!: () => void;
    let complete!: () => void;
    const entered = new Promise<void>(r => { accepted = r; });
    const gate = new Promise<void>(r => { complete = r; });
    const add = async (label: string) => {
      let db = true;
      const state = new ServerReadiness(async () => { if (!db) throw Error('synthetic outage'); }, () => true, 500, 0, true);
      const app = express();
      app.get('/health/ready', state.readyHandler);
      app.get('/health/live', state.liveHandler);
      app.use(state.drainMiddleware);
      app.get('/work', async (req, res) => {
        if (req.query.hold === 'yes') { accepted(); await gate; }
        res.json({ label });
      });
      const service = await listen(app);
      servers.push(service.server);
      state.markServing();
      return { ...service, state, failDb: () => { db = false; } };
    };
    try {
      const a = await add('a');
      const b = await add('b');
      const replicas = [a, b];
      const markers = await Promise.all(replicas.map(async node => {
        const response = await fetch(node.origin + '/health/ready');
        expect(response.status).toBe(200);
        await response.arrayBuffer();
        return response.headers.get('x-vanta-probe-instance');
      }));
      expect(markers.every(Boolean)).toBe(true);
      expect(new Set(markers).size).toBe(2);
      const hidden = new ServerReadiness(async () => {});
      const hiddenApp = express();
      hiddenApp.get('/health/ready', hidden.readyHandler);
      const hiddenNode = await listen(hiddenApp);
      servers.push(hiddenNode.server);
      hidden.markServing();
      const hiddenResponse = await fetch(hiddenNode.origin + '/health/ready');
      expect(hiddenResponse.headers.get('x-vanta-probe-instance')).toBeNull();
      await hiddenResponse.arrayBuffer();

      // Test-only router over fixed loopback addresses, not a production proxy.
      const edge = express();
      let cursor = 0;
      edge.get('/work', async (_req, res) => {
        const available = (await Promise.all(replicas.map(async node => {
          try {
            const probe = await fetch(node.origin + '/health/ready', { signal: AbortSignal.timeout(2000) });
            await probe.arrayBuffer();
            return probe.ok ? node : null;
          } catch { return null; }
        }))).filter((node): node is typeof a => node !== null);
        if (!available.length) { res.sendStatus(503); return; }
        try {
          const result = await fetch(available[cursor++ % available.length].origin + '/work', { signal: AbortSignal.timeout(2000) });
          res.status(result.status).type('application/json').send(await result.text());
        } catch { res.sendStatus(502); }
      });
      const router = await listen(edge);
      servers.push(router.server);
      const traffic = async (n: number) => {
        const responses = await Promise.all(Array.from({ length: n }, () => fetch(router.origin + '/work')));
        expect(responses.every(r => r.status === 200)).toBe(true);
        return Promise.all(responses.map(r => r.json()));
      };
      const initial = await traffic(20);
      expect(initial.filter(x => x.label === 'a')).toHaveLength(10);
      expect(initial.filter(x => x.label === 'b')).toHaveLength(10);
      const ongoing = fetch(a.origin + '/work?hold=yes');
      await entered;
      a.state.beginDrain();
      expect((await fetch(a.origin + '/health/ready')).status).toBe(503);
      expect((await fetch(a.origin + '/health/live')).status).toBe(200);
      expect((await fetch(a.origin + '/work')).status).toBe(503);
      expect((await traffic(12)).every(x => x.label === 'b')).toBe(true);
      complete();
      expect(await (await ongoing).json()).toEqual({ label: 'a' });
      b.failDb();
      expect((await fetch(router.origin + '/work')).status).toBe(503);
    } finally {
      complete();
      await Promise.all(servers.map(server => {
        server.closeAllConnections();
        return new Promise<void>(resolve => server.close(() => resolve()));
      }));
    }
  }, 20000);
});
