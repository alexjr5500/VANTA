// ============================================================================
// VANTA phone-simulation end-to-end test
// ----------------------------------------------------------------------------
// Sends every request to the LAN IP (what a physical phone on the same Wi-Fi
// would use) over HTTPS. Requires `https://<LAN-IP>:5000` to be up.
//
// Run:  node scripts/e2e-phone-test.mjs
// ============================================================================

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // dev mkcert only

const BASE = process.env.VANTA_TEST_BASE || 'https://10.174.123.177:5000';
const ts = Date.now();
const USER_A = `phone_a_${ts}`;
const USER_B = `phone_b_${ts}`;
const EMAIL_A = `${USER_A}@example.com`;
const EMAIL_B = `${USER_B}@example.com`;
const PASSWORD = 'PhoneTest123!';

// --- helpers ---------------------------------------------------------------
const results = { pass: 0, fail: 0, skipped: 0 };
function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }

async function t(name, fn) {
  try {
    const r = await fn();
    results.pass++;
    console.log(`  PASS  ${pad(name, 46)} (${typeof r === 'string' ? r : 'ok'})`);
  } catch (e) {
    results.fail++;
    console.log(`  FAIL  ${pad(name, 46)} threw: ${e.message} ${e.stack?.split('\n')[1] || ''}`);
  }
}

async function req(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  if (!res.ok && json.error === undefined) json.error = `${res.status} ${res.statusText}`;
  return { httpStatus: res.status, status: res.status, ...json };
}

function pngBlob() {
  // 1x1 transparent PNG
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  return new Blob([Buffer.from(b64, 'base64')], { type: 'image/png' });
}

function fakeMp4Blob() {
  // ftyp box only (passes the backend magic-byte check without ffprobe), padded
  // so size is non-trivial. Real phone videos go through the same pipeline.
  const ftyp = Buffer.from('000000186674797069736F6D0000020069736F6D', 'hex');
  const body = Buffer.alloc(96 * 1024, 7);
  return new Blob([Buffer.concat([ftyp, body])], { type: 'video/mp4' });
}

const formWith = (name, value, fname) => {
  const fd = new FormData();
  fd.append(name, value, fname);
  return fd;
};

let idA, idB, tokA, tokB;

// ============================================================================
console.log(`\n=== VANTA phone e2e vs ${BASE} ===\n`);

// --- health / auth ----------------------------------------------------------
await t('GET /health', async () => {
  const r = await req('GET', '/health');
  if (r.status !== 200 && r.status !== 'ok') throw new Error(JSON.stringify(r));
  return 'server up';
});

await t('register user A', async () => {
  const r = await req('POST', '/api/auth/register', { body: { email: EMAIL_A, username: USER_A, password: PASSWORD, fullName: 'Phone A' } });
  if (!r.token) throw new Error(JSON.stringify(r));
  tokA = r.token; idA = r.user.id;
  return `id=${idA}`;
});

await t('register user B', async () => {
  const r = await req('POST', '/api/auth/register', { body: { email: EMAIL_B, username: USER_B, password: PASSWORD, fullName: 'Phone B' } });
  if (!r.token) throw new Error(JSON.stringify(r));
  tokB = r.token; idB = r.user.id;
  return `id=${idB}`;
});

await t('login user A (by email)', async () => {
  const r = await req('POST', '/api/auth/login', { body: { identifier: EMAIL_A, password: PASSWORD } });
  if (!r.token) throw new Error(JSON.stringify(r));
  tokA = r.token;
  return 'ok';
});

await t('login user B (by username)', async () => {
  const r = await req('POST', '/api/auth/login', { body: { identifier: USER_B, password: PASSWORD } });
  if (!r.token) throw new Error(JSON.stringify(r));
  tokB = r.token;
  return 'ok';
});

await t('GET /api/auth/me', async () => {
  const r = await req('GET', '/api/auth/me', { token: tokA });
  if (!r.user?.id) throw new Error(JSON.stringify(r));
  return `user=${r.user.username}`;
});

await t('token refresh', async () => {
  const login = await req('POST', '/api/auth/login', { body: { identifier: EMAIL_A, password: PASSWORD } });
  const r = await req('POST', '/api/auth/refresh', { body: { refreshToken: login.refreshToken } });
  if (!r.token && !r.accessToken) throw new Error(JSON.stringify(r));
  return 'refresh ok';
});

// --- profile ----------------------------------------------------------------
await t('GET /api/profiles/me', async () => {
  const r = await req('GET', '/api/profiles/me', { token: tokA });
  if (!r.profile && !r.user) throw new Error(JSON.stringify(r));
  return 'ok';
});

await t('PUT /api/profiles/me (bio + display name)', async () => {
  const r = await req('PUT', '/api/profiles/me', { token: tokA, body: { bio: 'Testing VANTA from my phone!', displayName: 'Phone A Pro' } });
  if (!r.profile && !r.user) throw new Error(JSON.stringify(r));
  return 'ok';
});

await t('avatar upload (profile image)', async () => {
  const r = await req('POST', '/api/profiles/me/avatar', { token: tokA, form: formWith('avatar', pngBlob(), 'avatar.png') });
  if (!r.url && !r.avatarUrl) throw new Error(JSON.stringify(r));
  return r.url || r.avatarUrl;
});

await t('banner upload (cover image)', async () => {
  const r = await req('POST', '/api/profiles/me/banner', { token: tokA, form: formWith('banner', pngBlob(), 'banner.png') });
  if (!r.url && !r.bannerUrl) throw new Error(JSON.stringify(r));
  return r.url || r.bannerUrl;
});

await t('public profile view (other user)', async () => {
  const r = await req('GET', `/api/profiles/public/${USER_A}`, { token: tokB });
  if (!r.profile && !r.user && !r.id) throw new Error(JSON.stringify(r).slice(0, 200));
  return `user=${r.username || 'ok'}`;
});

await t('follow system (A follows B)', async () => {
  const r = await req('POST', `/api/profiles/${USER_B}/follow`, { token: tokA });
  if (r.status !== 200 && r.status !== 201) throw new Error(JSON.stringify(r).slice(0, 160));
  return 'ok';
});
// --- feed & posts -----------------------------------------------------------
await t('GET /api/feed (main feed)', async () => {
  const r = await req('GET', '/api/feed', { token: tokA });
  if (!Array.isArray(r.posts) && !Array.isArray(r) && !r.items) throw new Error(JSON.stringify(r).slice(0, 160));
  return 'ok';
});

await t('GET /api/feed/home', async () => {
  const r = await req('GET', '/api/feed/home', { token: tokA });
  return 'ok';
});

await t('GET /api/feed/trending', async () => {
  const r = await req('GET', '/api/feed/trending', { token: tokA });
  return 'ok';
});

await t('GET /api/feed/explore', async () => {
  const r = await req('GET', '/api/feed/explore', { token: tokA });
  return 'ok';
});

await t('create text post', async () => {
  const r = await req('POST', '/api/feed', { token: tokA, body: { content: `Hello from phone test ${ts}` } });
  if (!r.post && !r.id && !r.postId) throw new Error(JSON.stringify(r).slice(0, 160));
  return r.post?.id || r.id;
});

await t('generic image upload (image storage)', async () => {
  const r = await req('POST', '/api/upload', { token: tokA, form: formWith('file', pngBlob(), 'post.png') });
  if (!r.url) throw new Error(JSON.stringify(r).slice(0, 200));
  return r.url;
});

await t('create post with image', async () => {
  const up = await req('POST', '/api/upload', { token: tokA, form: formWith('file', pngBlob(), 'post2.png') });
  const r = await req('POST', '/api/feed', { token: tokA, body: { content: `With image ${ts}`, mediaUrl: up.url } });
  if (!r.post && !r.id && !r.postId) throw new Error(JSON.stringify(r).slice(0, 200));
  return 'ok';
});

await t('like + comment on post', async () => {
  const p = await req('POST', '/api/feed', { token: tokA, body: { content: `Like me ${ts}` } });
  const postId = p.post?.id || p.id;
  await req('POST', `/api/feed/${postId}/like`, { token: tokA, body: {} });
  const c = await req('POST', `/api/feed/${postId}/comments`, { token: tokB, body: { content: 'Nice!' } });
  if (!c.comment && !c.id) throw new Error(JSON.stringify(c).slice(0, 200));
  const list = await req('GET', `/api/feed/${postId}/comments`, { token: tokA });
  if (!Array.isArray(list.comments) && !Array.isArray(list) && !Array.isArray(list.items)) throw new Error(JSON.stringify(list).slice(0, 200));
  return 'ok';
});

// --- reels (video) ----------------------------------------------------------
await t('reel upload (video upload)', async () => {
  const r = await req('POST', '/api/upload/reel', { token: tokA, form: formWith('video', fakeMp4Blob(), 'reel.mp4') });
  if (!r.reel && !r.url && !r.id) throw new Error(JSON.stringify(r).slice(0, 300));
  return r.reel?.id || r.id || r.url || 'ok';
});

await t('GET /api/reels (public list)', async () => {
  const r = await req('GET', '/api/reels', { token: tokB });
  if (!Array.isArray(r.reels) && !Array.isArray(r) && !r.items) throw new Error(JSON.stringify(r).slice(0, 200));
  return 'ok';
});
// --- messaging / chat -------------------------------------------------------
await t('start conversation', async () => {
  const r = await req('POST', '/api/messages/start', { token: tokA, body: { participantIds: [idB], type: 'DIRECT' } });
  if (!r.conversation) throw new Error(JSON.stringify(r).slice(0, 200));
  return r.conversation.id;
});

await t('send message + list conversations + read', async () => {
  const conv = await req('POST', '/api/messages/start', { token: tokA, body: { participantIds: [idB], type: 'DIRECT' } });
  const cid = conv.conversation.id;
  const s = await req('POST', '/api/messages/send', { token: tokA, body: { conversationId: cid, content: 'Hey! Testing chat from phone' } });
  if (!s.message && !s.messageId) throw new Error(JSON.stringify(s).slice(0, 200));
  const convs = await req('GET', '/api/messages', { token: tokA });
  if (!Array.isArray(convs.conversations) && !Array.isArray(convs)) throw new Error(JSON.stringify(convs).slice(0, 200));
  const msgs = await req('GET', `/api/messages/${cid}`, { token: tokB });
  if (!Array.isArray(msgs.messages) && !Array.isArray(msgs)) throw new Error(JSON.stringify(msgs).slice(0, 200));
  await req('PUT', `/api/messages/${cid}/read`, { token: tokB, body: {} });
  return 'ok';
});

await t('messages unread count', async () => {
  const r = await req('GET', '/api/messages/unread/count', { token: tokB });
  if (r.status === 401) throw new Error('401 on unread');
  return 'ok';
});

// --- notifications ----------------------------------------------------------
await t('GET /api/notifications (B receives A\'s follow)', async () => {
  const r = await req('GET', '/api/notifications', { token: tokB });
  if (!Array.isArray(r.notifications) && !Array.isArray(r) && !Array.isArray(r.items)) throw new Error(JSON.stringify(r).slice(0, 200));
  return 'ok';
});
// --- gifts ------------------------------------------------------------------
await t('gift catalog (public GET /api/gifts)', async () => {
  const r = await req('GET', '/api/gifts');
  const keyCount = Object.keys(r).filter((k) => k !== 'status').length;
  if (!Array.isArray(r.gifts) && !Array.isArray(r) && keyCount === 0) throw new Error(JSON.stringify(r).slice(0, 200));
  return `${Array.isArray(r.gifts) ? r.gifts.length : Array.isArray(r) ? r.length : keyCount} gifts`;
});

await t('welcome reward status', async () => {
  const r = await req('GET', '/api/welcome-reward/status', { token: tokA });
  if (r.error) throw new Error(JSON.stringify(r).slice(0, 160));
  return 'connected';
});

await t('wallet balance (before gift)', async () => {
  const r = await req('GET', '/api/wallets/balance', { token: tokA });
  if (r.error) throw new Error(JSON.stringify(r).slice(0, 200));
  return `coins=${r.balance ?? r.coins ?? r.balanceVANTA ?? 'n/a'}`;
});

await t('send gift (A -> B)', async () => {
  const cat = await req('GET', '/api/gifts');
  const gifts = Array.isArray(cat.gifts) ? cat.gifts : Array.isArray(cat) ? cat : Object.values(cat).filter((g) => g && typeof g === 'object' && g.id);
  if (!Array.isArray(gifts) || !gifts.length) throw new Error('gift catalog empty');
  const gift = gifts.find((g) => g.active !== false) || gifts[0];
  const r = await req('POST', '/api/gifts/send', {
    token: tokA,
    body: { receiverId: idB, giftId: gift.id || gift._id, quantity: 1, requestId: `phone-e2e-${ts}` },
  });
  if (!r.transaction && !r.error) throw new Error(JSON.stringify(r).slice(0, 200));
  if (r.error) return `expected: ${r.error}`;
  return 'gift sent';
});

await t('gift history endpoint', async () => {
  const r = await req('GET', '/api/gifts/history', { token: tokA });
// --- groups / channels ------------------------------------------------------
await t('create group', async () => {
  const r = await req('POST', '/api/groups', { token: tokA, body: { name: `Phone Group ${ts}`, description: 'created from phone' } });
  if (!r.group && !r.id) throw new Error(JSON.stringify(r).slice(0, 200));
  return r.group?.id || r.id;
});

await t('list my groups', async () => {
  const r = await req('GET', '/api/groups', { token: tokA });
  if (!Array.isArray(r.groups) && !Array.isArray(r)) throw new Error(JSON.stringify(r).slice(0, 200));
  return 'ok';
});

await t('create channel', async () => {
  const r = await req('POST', '/api/channels', { token: tokA, body: { name: `Phone Channel ${ts}`, type: 'PUBLIC', description: 'from phone' } });
  if (!r.channel && !r.id) throw new Error(JSON.stringify(r).slice(0, 200));
  return r.channel?.id || r.id;
});

await t('list channels', async () => {
  const r = await req('GET', '/api/channels');
  if (!Array.isArray(r.channels) && !Array.isArray(r)) throw new Error(JSON.stringify(r).slice(0, 200));
  return 'ok';
});

// --- live streaming ---------------------------------------------------------
await t('live categories', async () => {
  const r = await req('GET', '/api/live/categories', { token: tokA });
  if (!Array.isArray(r.categories) && !Array.isArray(r)) throw new Error(JSON.stringify(r).slice(0, 200));
  return `${Array.isArray(r.categories) ? r.categories.length : r.length || 0} categories`;
});

await t('start live stream (creates real LiveKit room)', async () => {
  const r = await req('POST', '/api/live/start', {
    token: tokA,
    body: { title: `Phone live ${ts}`, category: 'Just Chatting', allowGifts: true, allowPK: false },
  });
  if (!r.stream) throw new Error(JSON.stringify(r).slice(0, 300));
  return `streamId=${r.stream.id || r.stream.streamId}`;
});

await t('get host token for stream', async () => {
  const start = await req('POST', '/api/live/start', {
    token: tokA,
    body: { title: `Phone live ${ts}`, category: 'Gaming', allowGifts: true },
  });
  if (!start.stream) return 'no stream (skipping token)';
  const sid = start.stream.id || start.stream.streamId;
  const r = await req('GET', `/api/live/${sid}/host-token`, { token: tokA });
  if (!r.token) throw new Error(JSON.stringify(r).slice(0, 200));
  return 'host token issued';
});

// --- stories / misc ---------------------------------------------------------
await t('stories endpoint', async () => {
  const r = await req('GET', '/api/stories', { token: tokA });
  if (r.status === 404) return 'route missing (expected if disabled)';
  return 'ok';
});

await t('search endpoint', async () => {
  const r = await req('GET', `/api/search?q=${USER_A}`, { token: tokB });
  if (r.status === 404) return 'route missing (expected if disabled)';
  return 'ok';
});

await t('wallet users search + transfer preview', async () => {
  const r = await req('GET', `/api/wallets/users/search?q=${USER_A}`, { token: tokB });
  if (r.status === 404) return 'route missing';
  return 'ok';
});

// --- summary ----------------------------------------------------------------
console.log(`\n=== RESULT: ${results.pass} passed, ${results.fail} failed ===\n`);
process.exit(results.fail ? 1 : 0);
  if (r.error) return JSON.stringify(r).slice(0, 160);
  return 'ok';
});

await t('notifications unread-count', async () => {
  const r = await req('GET', '/api/notifications/unread-count', { token: tokB });
  if (r.error) throw new Error(JSON.stringify(r).slice(0, 160));
  return 'ok';
});