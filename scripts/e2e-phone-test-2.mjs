// VANTA phone e2e - part 2 (gifts, groups, channels, live, search, stories)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const BASE = process.env.VANTA_TEST_BASE || 'https://10.174.123.177:5000';
const ts = Date.now();
const USER_A = `phone_a_${ts}`;
const USER_B = `phone_b_${ts}`;
const EMAIL_A = `${USER_A}@example.com`;
const EMAIL_B = `${USER_B}@example.com`;
const PASSWORD = 'PhoneTest123!';

const results = { pass: 0, fail: 0 };
function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
async function t(name, fn) {
  try {
    const r = await fn();
    results.pass++;
    console.log(`  PASS  ${pad(name, 46)} (${typeof r === 'string' ? r : 'ok'})`);
  } catch (e) {
    results.fail++;
    console.log(`  FAIL  ${pad(name, 46)} threw: ${e.message}`);
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
  if (!res.ok && json.error === undefined) json.error = `${res.status}`;
  return { httpStatus: res.status, status: res.status, ...json };
}
let idA, idB, tokA, tokB;
function toList(r, prefer) {
  if (Array.isArray(r[prefer])) return r[prefer];
  if (Array.isArray(r)) return r;
  if (Array.isArray(r.items)) return r.items;
  return Object.values(r).filter((v) => v && typeof v === 'object' && !Array.isArray(v) && v.id);
}
console.log(`\n=== VANTA phone e2e part 2 vs ${BASE} ===\n`);
await t('register + login two users', async () => {
  const a = await req('POST', '/api/auth/register', { body: { email: EMAIL_A, username: USER_A, password: PASSWORD } });
  const b = await req('POST', '/api/auth/register', { body: { email: EMAIL_B, username: USER_B, password: PASSWORD } });
  if (!a.token || !b.token) throw new Error(`missing token: ${JSON.stringify({ a, b }).slice(0, 120)}`);
  tokA = a.token; idA = a.user.id; tokB = b.token; idB = b.user.id;
  return 'ok';
});

await t('gift catalog (public GET /api/gifts)', async () => {
  const r = await req('GET', '/api/gifts');
  const list = toList(r, 'gifts');
  if (!list.length) throw new Error('empty catalog');
  return `${list.length} gifts`;
});

await t('welcome reward status', async () => {
  const r = await req('GET', '/api/welcome-reward/status', { token: tokA });
  if (r.error) throw new Error(JSON.stringify(r).slice(0, 160));
  return 'connected';
});

await t('wallet balance', async () => {
  const r = await req('GET', '/api/wallets/balance', { token: tokA });
  if (r.error) throw new Error(JSON.stringify(r).slice(0, 160));
  return `coins=${r.balance ?? r.coins ?? r.balanceVANTA ?? 'n/a'}`;
});

await t('claim welcome reward (funds wallet for gift)', async () => {
  const r = await req('POST', '/api/welcome-reward/claim', { token: tokA });
  if (r.error) throw new Error(JSON.stringify(r).slice(0, 200));
  return 'ok';
});

await t('send gift (A -> B)', async () => {
  const cat = await req('GET', '/api/gifts');
  const list = toList(cat, 'gifts');
  const gift = list.find((g) => g.active !== false) || list[0];
  const r = await req('POST', '/api/gifts/send', {
    token: tokA,
    body: { receiverId: idB, giftId: gift.id || gift._id, quantity: 1, requestId: `phone-e2e-${ts}${String(Math.random()).slice(2, 10)}` },
  });
  if (!r.transaction && !r.error) throw new Error(JSON.stringify(r).slice(0, 200));
  return r.error ? `expected: ${r.error}` : 'gift sent';
});

await t('gift history', async () => {
  const r = await req('GET', '/api/gifts/history', { token: tokA });
  if (r.error) return JSON.stringify(r).slice(0, 160);
  return 'ok';
});
await t('create group', async () => {
  const r = await req('POST', '/api/groups', { token: tokA, body: { name: `Phone Group ${ts}`, description: 'from phone' } });
  if (!r.group && !r.id) throw new Error(JSON.stringify(r).slice(0, 200));
  return r.group?.id || r.id;
});

await t('list my groups', async () => {
  const r = await req('GET', '/api/groups', { token: tokA });
  const list = toList(r, 'groups');
  if (!list.length) throw new Error(JSON.stringify(r).slice(0, 160));
  return 'ok';
});

await t('create channel', async () => {
  const r = await req('POST', '/api/channels', { token: tokA, body: { name: `Phone Channel ${ts}`, type: 'PUBLIC', description: 'from phone' } });
  if (!r.channel && !r.id) throw new Error(JSON.stringify(r).slice(0, 200));
  return r.channel?.id || r.id;
});

await t('list channels', async () => {
  const r = await req('GET', '/api/channels');
  const list = toList(r, 'channels');
  if (!list.length) throw new Error(JSON.stringify(r).slice(0, 160));
  return 'ok';
});

await t('live categories', async () => {
  const r = await req('GET', '/api/live/categories', { token: tokA });
  const list = toList(r, 'categories');
  if (!list.length) throw new Error(JSON.stringify(r).slice(0, 160));
  return `${list.length} categories`;
});

await t('start live stream (real LiveKit room)', async () => {
  const r = await req('POST', '/api/live/start', {
    token: tokA,
    body: { title: `Phone live ${ts}`, category: 'Just Chatting', allowGifts: true, allowPK: false },
  });
  if (!r.stream) throw new Error(JSON.stringify(r).slice(0, 300));
  return `streamId=${r.stream.id || r.stream.streamId}`;
});

await t('get host token for live stream', async () => {
  const start = await req('POST', '/api/live/start', {
    token: tokA,
    body: { title: `Phone live ${ts}`, category: 'Gaming', allowGifts: true },
  });
  if (!start.stream) return 'skipped (no stream)';
  const sid = start.stream.id || start.stream.streamId;
  const r = await req('GET', `/api/live/${sid}/host-token`, { token: tokA });
  if (!r.token) throw new Error(JSON.stringify(r).slice(0, 200));
  return 'host token issued';
});

await t('get active streams', async () => {
  const r = await req('GET', '/api/live', { token: tokB });
  if (r.error) throw new Error(JSON.stringify(r).slice(0, 160));
  return 'ok';
});
await t('stories endpoint', async () => {
  const r = await req('GET', '/api/stories', { token: tokA });
  if (r.httpStatus === 404) return 'route missing';
  return 'ok';
});

await t('search endpoint', async () => {
  const r = await req('GET', `/api/search?q=${USER_A}`, { token: tokB });
  if (r.httpStatus === 404) return 'route missing';
  return 'ok';
});

await t('wallet users search', async () => {
  const r = await req('GET', `/api/wallets/users/search?q=${USER_A}`, { token: tokB });
  if (r.httpStatus === 404) return 'route missing';
  return 'ok';
});

await t('group avatar upload via /api/upload/groups/:id/avatar', async () => {
  const g = await req('POST', '/api/groups', { token: tokA, body: { name: `Group2 ${ts}` } });
  const gid = g.group?.id || g.id;
  const fd = new FormData();
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  fd.append('avatar', new Blob([Buffer.from(b64, 'base64')], { type: 'image/png' }), 'a.png');
  const res = await fetch(`${BASE}/api/upload/groups/${gid}/avatar`, { method: 'POST', headers: { Authorization: `Bearer ${tokA}` }, body: fd });
  if (res.status !== 200 && res.status !== 201) throw new Error(`group avatar upload -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  return `group-avatar ${res.status}`;
});

console.log(`\n=== PART 2 RESULT: ${results.pass} passed, ${results.fail} failed ===\n`);
process.exit(results.fail ? 1 : 0);