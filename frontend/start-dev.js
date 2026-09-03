// Start Next.js dev server with LAN HTTPS configuration (delegates to the
// shared LAN wrapper so behavior is identical to `npm run dev:lan`).
const { spawn } = require('node:child_process');
const path = require('node:path');

const child = spawn(process.execPath, [path.join(__dirname, 'scripts', 'dev-lan.mjs')], {
  cwd: __dirname,
  stdio: 'inherit',
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));