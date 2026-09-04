// VANTA live-streaming focused e2e (start stream -> host token -> viewer token -> end)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const BASE = process.env.VANTA_TEST_BASE || 'https://10.174.123.177:5000';
const ts = Date.now();
const USER = `live_${ts}`;
const PASSWORD = 'PhoneTest123!';

const results = { pass: 0, fail: 0 };
async function t(name, fn) {
  try {
    const r = await fn();
    results.pass++;
    console.log(`  PASS  ${name.padEnd(44)} (${typeof r === 'string' ? r : 'ok'})`);
  } catch (e) {
    results.fail++;
    console.log(`  FAIL  ${name.padEnd(44)} ${e.message}`);
  }
}
async function req(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  if (!res.ok && json.error === undefined) json.error = `${res.status} ${res.statusText}`;
  return { httpStatus: res.status, ...json };
}

console.log(`\n=== VANTA live e2e vs ${BASE} ===\n`);

await t('register live host user', async () => {
  const r = await req('POST', '/api/auth/register', { body: { email: `${USER}@example.com`, username: USER, password: PASSWORD } });
  if (!r.token) throw new Error('no token: ' + JSON.stringify(r).slice(0, 120));
  globalThis.tok = r.token; globalThis.uid = r.user.id;
  return 'ok';
});

await t('start live stream (real LiveKit room)', async () => {
  const r = await req('POST', '/api/live/start', {
    token: globalThis.tok,
    body: { title: `Phone live ${ts}`, category: 'Just Chatting', allowGifts: true, allowPK: false },
  });
  if (!r.stream) throw new Error('no stream: ' + JSON.stringify(r).slice(0, 300));
  globalThis.sid = r.stream.id || r.stream.streamId;
  return `streamId=${globalThis.sid}`;
});

await t('get host token for stream', async () => {
  const r = await req('GET', `/api/live/${globalThis.sid}/host-token`, { token: globalThis.tok });
  if (!r.token) throw new Error('no host token: ' + JSON.stringify(r).slice(0, 200));
  globalThis.hostTok = r.token;
  return 'host token issued (length ' + r.token.length + ')';
});

await t('get viewer token for stream', async () => {
  const r = await req('GET', `/api/live/${globalThis.sid}/viewer-token`, { token: globalThis.tok });
  if (!r.token) throw new Error('no viewer token: ' + JSON.stringify(r).slice(0, 200));
  globalThis.viewerTok = r.token;
  return 'viewer token issued (length ' + r.token.length + ')';
});

await t('get active streams (contains our stream)', async () => {
  const r = await req('GET', '/api/live', { token: globalThis.tok });
  const list = Array.isArray(r.streams) ? r.streams : Array.isArray(r) ? r : Array.isArray(r.items) ? r.items : Object.values(r).filter((v) => v && typeof v === 'object' && v.id);
  const found = list.some((s) => (s.id || s.streamId) === globalThis.sid);
  if (!found) throw new Error('stream not in active list: ' + JSON.stringify(r).slice(0, 200));
  return 'found in active list';
});

await t('get stream detail', async () => {
  const r = await req('GET', `/api/live/${globalThis.sid}`, { token: globalThis.tok });
  if (r.error) throw new Error(JSON.stringify(r).slice(0, 200));
  return 'ok';
});

await t('stream chat send + list', async () => {
  const s = await req('POST', `/api/live/${globalThis.sid}/message`, { token: globalThis.tok, body: { message: 'Hello from phone test!' } });
  const c = await req('GET', `/api/live/${globalThis.sid}/chat`, { token: globalThis.tok });
  if (s.httpStatus !== 200 && s.httpStatus !== 201 && !s.message) throw new Error('chat send failed: ' + JSON.stringify(s).slice(0, 200));
  if (c.httpStatus !== 200 && c.httpStatus !== 201) throw new Error('chat list failed: ' + JSON.stringify(c).slice(0, 200));
  return 'ok';
});

await t('cleanup: end live stream', async () => {
  const r = await req('POST', `/api/live/${globalThis.sid}/end`, { token: globalThis.tok });
  if (r.error && !/not found|already ended|inactive/i.test(r.error)) throw new Error(JSON.stringify(r).slice(0, 200));
  return 'ok';
});

console.log(`\n=== LIVE RESULT: ${results.pass} passed, ${results.fail} failed ===\n`);
process.exit(results.fail ? 1 : 0);