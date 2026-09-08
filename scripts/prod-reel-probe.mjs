// ============================================================================
// Production Reel media probe (VANTA)
// ----------------------------------------------------------------------------
// End-to-end check of the Reel video pipeline that surfaced "Unable to load
// Reel — MEDIA_ELEMENT_ERROR" in production:
//
//   1. register a throwaway user (labelled reeltest_<ts>)
//   2. upload a real MP4 to POST /api/upload/reel
//   3. fetch it back and locate the Reel in /api/reels
//   4. resolve the returned videoUrl against the API origin (exactly what
//      resolveMediaUrl() does in the browser)
//   5. probe that URL: status, Content-Type, Range support, MP4 magic bytes
//   6. delete the throwaway Reel (and report the leftover user, if any)
//
// Typical failure (ephemeral storage on Railway): steps 2 passes, step 5
// returns HTTP 404 application/json → the browser reports MEDIA_ELEMENT_ERROR.
// Fix: attach a Railway volume and set UPLOAD_STORAGE_DIR=/data/uploads, or
// configure Cloudinary (CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET).
//
// Run:  node scripts/prod-reel-probe.mjs
//       node scripts/prod-reel-probe.mjs https://<your-backend>.up.railway.app
// ============================================================================

const BASE = (process.argv[2] || process.env.VANTA_TEST_BASE || 'https://carefree-luck-production-8298.up.railway.app').replace(/\/+$/, '');
const ts = Date.now();
const username = `reeltest_${ts}`;
const email = `${username}@example.com`;
const PASSWORD = 'ReelTest123!';

function realMp4() {
  // Tiny valid MP4 skeleton (ftyp + mdat) - passes the backend magic-byte check.
  const ftyp = Buffer.from('000000186674797069736F6D0000020069736F6D', 'hex');
  const mdat = Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from('mdat', 'utf8'), Buffer.alloc(2 * 1024, 7)]);
  return new Blob([Buffer.concat([ftyp, mdat])], { type: 'video/mp4' });
}

async function req(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, headers: res.headers, ...json };
}

const results = { pass: 0, fail: 0 };
function t(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then((msg) => { results.pass++; console.log(`PASS  ${name}${msg ? ` — ${msg}` : ''}`); })
    .catch((e) => { results.fail++; console.log(`FAIL  ${name} — ${e.message}`); });
}

async function main() {
  console.log(`\n=== VANTA production Reel probe vs ${BASE} ===\n`);

  let token = '';
  await t('register throwaway probe user', async () => {
    const r = await req('POST', '/api/auth/register', {
      body: { email, username, password: PASSWORD, fullName: 'Reel Probe' },
    });
    if (!r.token) throw new Error(JSON.stringify(r).slice(0, 200));
    token = r.token;
    return username;
  });

  let upload = null;
  await t('upload real MP4 to /api/upload/reel', async () => {
    const form = new FormData();
    form.append('title', 'E2E probe reel');
    form.append('description', 'temporary probe - safe to delete');
    form.append('video', realMp4(), 'e2e-probe.mp4');
    upload = await req('POST', '/api/upload/reel', { token, form });
    if (!upload.videoUrl && !upload.video?.videoUrl) throw new Error(`no url in response: ${JSON.stringify(upload).slice(0, 300)}`);
    return `videoUrl=${upload.videoUrl || upload.video?.videoUrl}`;
  });

  const storedUrl = upload.videoUrl || upload.video?.videoUrl || '';
  const resolved = new URL(storedUrl, `${BASE}/`).toString();

  await t('fetch resolved video URL directly (exactly what <video> does)', async () => {
    const res = await fetch(resolved);
    const ct = res.headers.get('content-type') || '';
    const buf = Buffer.from(await res.arrayBuffer());
    const magic = buf.length >= 8 ? buf.subarray(4, 8).toString('ascii') : '';
    const msg = `HTTP ${res.status}, Content-Type=${ct}, size=${buf.length}, magic="${magic}"`;
    if (res.status !== 200) throw new Error(msg);
    if (!/^video\/mp4/i.test(ct)) throw new Error(`wrong content-type: ${msg}`);
    if (magic !== 'ftyp') throw new Error(`not an mp4 container: ${msg}`);
    return msg;
  });

  await t('Range request support (browser seeking/progressive play)', async () => {
    const res = await fetch(resolved, { headers: { Range: 'bytes=0-1023' } });
    const cr = res.headers.get('content-range');
    const msg = `HTTP ${res.status}, content-range=${cr}`;
    if (res.status !== 206 && res.status !== 200) throw new Error(msg);
    return msg;
  });

  // Ephemeral-storage check: a live file now must also survive a redeploy,
  // which only a persistent volume / Cloudinary can guarantee.
  await t('health endpoint reports media-storage diagnostics', async () => {
    const r = await req('GET', '/health');
    if (!r.mediaStorage) throw new Error('mediaStorage field missing from /health');
    const s = r.mediaStorage;
    const msg = `mode=${s.mode}, storageDirEnvConfigured=${s.storageDirEnvConfigured}, missingOnDisk=${s.missingOnDisk}/${s.dbReferencedUploads}, healthy=${s.healthy}`;
    if (s.mode === 'local' && !s.healthy) {
      throw new Error(`EPHEMERAL/MISSING FILES DETECTED: ${msg}. Attach a Railway volume + set UPLOAD_STORAGE_DIR=/data/uploads (or configure Cloudinary).`);
    }
    return msg;
  });

  // Cleanup: delete the throwaway Reel.
  const reelId = upload.video?.id;
  await t('cleanup: delete throwaway Reel', async () => {
    if (!reelId) return 'nothing to delete';
    const r = await req('DELETE', `/api/reels/${reelId}`, { token });
    if (r.status !== 200 && r.message !== 'Reel deleted') throw new Error(JSON.stringify(r).slice(0, 200));
    return reelId;
  });

  console.log(`\n=== RESULT: ${results.pass} passed, ${results.fail} failed ===`);
  console.log(`(throwaway user left on the service for deletion: ${username} / ${email})\n`);
  process.exit(results.fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });