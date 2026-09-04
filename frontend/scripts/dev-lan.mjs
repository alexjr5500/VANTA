// ============================================================================
// VANTA LAN development server
// ----------------------------------------------------------------------------
// Runs `next dev` so the app is usable from a physical phone on the same Wi-Fi:
//   - binds to 0.0.0.0 (all interfaces) on port 3000
//   - serves HTTPS using the mkcert dev certificate in ../.certs-dev which
//     contains SANs for localhost, 127.0.0.1 and the LAN IP (10.174.123.177)
//   - prints Local + Network URLs up front
//
// Usage:
//   npm run dev:lan        (inside frontend/)
//   npm run dev            (from the repo root -> frontend dev:https -> this)
// ============================================================================
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 3000;
const host = '0.0.0.0';

// ---------------------------------------------------------------------------
// LAN address detection
// ---------------------------------------------------------------------------
function getLanIPv4() {
  const nets = networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        candidates.push({ name, address: net.address });
      }
    }
  }
  // Prefer a private-range address reachable from the phone (10.x, 172.16-31.x,
  // 192.168.x). Fall back to the first non-internal IPv4, then loopback.
  const privateRe = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
  const preferred = candidates.find((c) => privateRe.test(c.address));
  return (preferred || candidates[0])?.address || '127.0.0.1';
}

const lanIp = getLanIPv4();
console.log('');
console.log('  VANTA LAN development server (HTTPS)');
console.log(`  Local:   https://localhost:${port}`);
console.log(`  Network: https://${lanIp}:${port}`);
console.log('');
console.log(`  Bind address: ${host}:${port} (all interfaces)`);
console.log('  Phone must trust the mkcert root CA: frontend/.certs-dev/rootCA.pem');
console.log('');

// ---------------------------------------------------------------------------
// Client endpoint injection (phone never sees `localhost`)
// ---------------------------------------------------------------------------
// The phone's own `localhost` is the phone, not this laptop, so every
// client-side endpoint the browser inlines must point at THIS machine's LAN IP.
// Env vars set in the launching shell still win (pinning is possible); otherwise
// the values below are derived from the detected LAN IP at startup and take
// precedence over frontend/.env* so a DHCP address change can never silently
// leave the app pointing at a stale IP. The LIVEKIT URL intentionally uses the
// WSS bridge (port 7443) which terminates TLS with the same mkcert certs.
const effectiveApiUrl   = process.env.NEXT_PUBLIC_API_URL     || `https://${lanIp}:5000`;
const effectiveSockUrl  = process.env.NEXT_PUBLIC_SOCKET_URL  || `https://${lanIp}:5000`;
const effectiveAppUrl   = process.env.NEXT_PUBLIC_APP_URL     || `https://${lanIp}:3000`;
const effectiveLivekit  = process.env.NEXT_PUBLIC_LIVEKIT_URL || `wss://${lanIp}:7443`;
console.log('  Endpoints injected into the browser build:');
console.log(`    NEXT_PUBLIC_API_URL       ${effectiveApiUrl}`);
console.log(`    NEXT_PUBLIC_SOCKET_URL    ${effectiveSockUrl}`);
console.log(`    NEXT_PUBLIC_APP_URL       ${effectiveAppUrl}`);
console.log(`    NEXT_PUBLIC_LIVEKIT_URL   ${effectiveLivekit}`);
console.log('');

// ---------------------------------------------------------------------------
// Certificate validation (fail fast instead of silently serving broken HTTPS)
// ---------------------------------------------------------------------------
const certDir = path.join(frontendRoot, '.certs-dev');
const requiredFiles = [
  ['key', path.join(certDir, 'vanta-local-key.pem')],
  ['cert', path.join(certDir, 'vanta-local.pem')],
  ['ca', path.join(certDir, 'rootCA.pem')],
];
for (const [label, file] of requiredFiles) {
  if (!fs.existsSync(file)) {
    console.error(`[dev-lan] Missing HTTPS ${label}: ${file}`);
    console.error('[dev-lan] Regenerate with mkcert, e.g.:');
    console.error(`  mkcert -ecdsa -key-file .certs-dev/vanta-local-key.pem ` +
      `-cert-file .certs-dev/vanta-local.pem localhost 127.0.0.1 10.174.123.177`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Launch next dev
// ---------------------------------------------------------------------------
const nextBin = path.join(frontendRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
const args = [
  nextBin,
  'dev',
  '--hostname', host,
  '--port', String(port),
  '--experimental-https',
  '--experimental-https-key', path.join(certDir, 'vanta-local-key.pem'),
  '--experimental-https-cert', path.join(certDir, 'vanta-local.pem'),
  '--experimental-https-ca', path.join(certDir, 'rootCA.pem'),
];

const child = spawn(process.execPath, args, {
  cwd: frontendRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED || '1',
    // Phone-reachable client endpoints (see injection comment above).
    NEXT_PUBLIC_API_URL: effectiveApiUrl,
    NEXT_PUBLIC_SOCKET_URL: effectiveSockUrl,
    NEXT_PUBLIC_APP_URL: effectiveAppUrl,
    NEXT_PUBLIC_LIVEKIT_URL: effectiveLivekit,
  },
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (!child.killed) child.kill(sig);
  });
}

child.on('error', (err) => {
  console.error('[dev-lan] Failed to start next dev:', err);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});