// VANTA LiveKit WSS bridge
// ============================================================
// Terminates TLS for the LiveKit signaling WebSocket so phones/desktops on an
// HTTPS (secure-context) page can reach the local LiveKit server without the
// browser blocking the connection as mixed content.
//
//   wss://<LAN-IP>:7443  ->  ws://127.0.0.1:7880
//
// LiveKit itself has no TLS termination flag (only TURN certs), so this tiny
// bridge is the compatibility shim for the existing HTTPS development setup.
// The actual WebRTC media still flows straight to the LiveKit RTC ports
// (tcp 7881 / udp 7882), which are already DTLS-encrypted and never pass
// through this proxy.
//
// It reuses the SAME mkcert certs as the frontend/backend HTTPS dev setup
// (frontend/.certs-dev), so whatever device/CA already trusts the VANTA dev
// HTTPS pages will trust this endpoint automatically.
//
// Endpoints:
//   WS  /rtc?access_token=...   -> forwarded to ws://127.0.0.1:7880
//   GET /healthz                -> {"ok": true, ...} (CORS enabled)
//   GET /                       -> same health payload
// ============================================================

import { createServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// `ws` ships inside frontend/node_modules (dependency of the Next.js dev server).
// Resolve it by absolute path so this script keeps working regardless of cwd.
const { WebSocketServer, WebSocket } = require('C:/VANTA/frontend/node_modules/ws');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const CERT = process.env.LIVEKIT_WSS_CERT || path.join(ROOT, 'frontend', '.certs-dev', 'vanta-local.pem');
const KEY = process.env.LIVEKIT_WSS_KEY || path.join(ROOT, 'frontend', '.certs-dev', 'vanta-local-key.pem');
const UPSTREAM = process.env.LIVEKIT_UPSTREAM_URL || 'ws://127.0.0.1:7880';
const HOST = process.env.LIVEKIT_WSS_BIND || '0.0.0.0';
const PORT = Number(process.env.LIVEKIT_WSS_PORT || 7443);
const UPSTREAM_OPEN_TIMEOUT_MS = 5000;

// Plain-HTTP target of the same LiveKit server (used to forward API calls such
// as POST /rtc/validate that clients make before the WebSocket upgrade).
const UPSTREAM_HTTP = process.env.LIVEKIT_UPSTREAM_HTTP || 'http://127.0.0.1:7880';

const cert = readFileSync(CERT);
const key = readFileSync(KEY);

const server = createServer({ cert, key }, (req, res) => {
  if (req.url === '/healthz' || req.url === '/') {
    const body = JSON.stringify({
      ok: true,
      service: 'vanta-livekit-wss',
      upstream: UPSTREAM,
      livekit_port: 7880,
    });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
    res.end(body);
    return;
  }

  // Transparent forward of non-WebSocket requests (e.g. POST /rtc/validate),
  // preserving method, path, query and JSON body.
  try {
    const upstreamUrl = new URL(req.url, UPSTREAM_HTTP);
    const headers = { ...req.headers, host: upstreamUrl.host };
    const proxyReq = httpRequest({
      method: req.method,
      hostname: upstreamUrl.hostname,
      port: upstreamUrl.port || 80,
      path: upstreamUrl.pathname + upstreamUrl.search,
      headers,
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
      }
      res.end('upstream unavailable');
    });
    req.pipe(proxyReq);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('proxy error');
  }
});

const wss = new WebSocketServer({ server });

wss.on('connection', (client, req) => {
  // Preserve the request path + query (e.g. /rtc?access_token=<jwt>) so the
  // upstream LiveKit server receives exactly what the SDK sends.
  const upstreamUrl = UPSTREAM + (req.url || '');
  let up;
  try {
    up = new WebSocket(upstreamUrl);
  } catch (err) {
    try {
      client.close(1011, 'bad upstream url');
    } catch {
      /* ignore */
    }
    return;
  }

  let opened = false;
  const queue = [];

  const closeBoth = () => {
    try {
      client.terminate();
    } catch {
      /* ignore */
    }
    try {
      up.terminate();
    } catch {
      /* ignore */
    }
  };

  const openTimer = setTimeout(() => {
    if (opened) return;
    // Upstream never opened (e.g. LiveKit is not running yet).
    try {
      client.close(1011, 'LiveKit upstream unavailable');
    } catch {
      /* ignore */
    }
    try {
      up.terminate();
    } catch {
      /* ignore */
    }
  }, UPSTREAM_OPEN_TIMEOUT_MS);

  up.on('open', () => {
    clearTimeout(openTimer);
    opened = true;
    while (queue.length) {
      const [data, isBinary] = queue.shift();
      if (up.readyState === WebSocket.OPEN) {
        try {
          up.send(data, { binary: isBinary });
        } catch {
          /* next error handler cleans up */
        }
      }
    }
  });

  client.on('message', (data, isBinary) => {
    if (opened && up.readyState === WebSocket.OPEN) {
      try {
        up.send(data, { binary: isBinary });
      } catch {
        /* ignore */
      }
    } else {
      queue.push([data, isBinary]);
    }
  });

  up.on('message', (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(data, { binary: isBinary });
      } catch {
        /* ignore */
      }
    }
  });

  client.on('close', () => {
    clearTimeout(openTimer);
    try {
      up.close();
    } catch {
      /* ignore */
    }
  });

  up.on('close', () => {
    clearTimeout(openTimer);
    try {
      client.close();
    } catch {
      /* ignore */
    }
  });

  client.on('error', closeBoth);
  up.on('error', closeBoth);
});

server.listen(PORT, HOST, () => {
  console.log(`[vanta-livekit-wss] listening on ${HOST}:${PORT} -> ${UPSTREAM}`);
});