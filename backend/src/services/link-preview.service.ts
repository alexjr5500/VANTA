import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import * as http from 'node:http';
import * as https from 'node:https';

export type LinkPreview = { title?: string; description?: string; siteName?: string; image?: string };
const HTML_LIMIT = 256 * 1024;
const IMAGE_LIMIT = 384 * 1024;
const TIME_LIMIT = 8000;
const REDIRECT_LIMIT = 3;

// Only ordinary public IPv4 unicast addresses. IPv6 and IP-literal URLs are
// deliberately not supported, avoiding alternate encodings and mapped addresses.
export function isPublicIPv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a,b,c] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

export function previewUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.port || !host.includes('.') || host.endsWith('.') || isIP(host) ||
        /(?:^|\.)(localhost|local|internal|lan|home|test|invalid|onion|example)$/.test(host)) return null;
    // Never prefetch common credential-bearing, recovery or signed URLs.
    if (/(?:^|\/)(?:reset-password|verify-email|magic-link|oauth|password-reset|private|invite|invites|unsubscribe|confirm-email)(?:\/|$)/i.test(url.pathname)) return null;
    for (const key of url.searchParams.keys()) {
      if (/(?:token|secret|password|signature|credential|session|auth|api[_-]?key|access[_-]?key|^key$|^code$|^sig$|^x-amz-|^x-goog-)/i.test(key)) return null;
    }
    url.hash = '';
    return url;
  } catch { return null; }
}

async function withDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('Preview deadline');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Preview deadline')), remaining);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

type Download = { body: Buffer; mime: string; url: URL };
async function fetchPublic(raw: string, kind: 'html' | 'image', deadline: number, redirects = 0): Promise<Download> {
  const url = previewUrl(raw);
  if (!url || redirects > REDIRECT_LIMIT) throw new Error('Invalid preview URL');
  const addresses = await withDeadline(lookup(url.hostname + '.', { family: 4, all: true }), deadline);
  if (!addresses.length || addresses.some(a => !isPublicIPv4(a.address))) throw new Error('Non-public address');
  // Connect to the exact validated IP. No second DNS lookup, no proxy, no
  // cookies, auth headers or viewer IP. Preserve HTTP Host and TLS SNI.
  const limit = kind === 'html' ? HTML_LIMIT : IMAGE_LIMIT;
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('Preview deadline');
  const result = await new Promise<{ body?: Buffer; mime?: string; redirect?: string }>((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    let timer: ReturnType<typeof setTimeout>;
    const options: https.RequestOptions = {
      hostname: addresses[0].address,
      port: url.protocol === 'https:' ? 443 : 80,
      servername: url.hostname,
      method: 'GET', path: url.pathname + url.search,
      agent: false,
      headers: { Host: url.hostname, 'User-Agent': 'VANTA-LinkPreview/1.0', Accept: kind === 'html' ? 'text/html,application/xhtml+xml' : 'image/jpeg,image/png,image/webp', 'Accept-Encoding': 'identity' },
    };
    const req = transport.request(options, res => {
      const status = res.statusCode || 0;
      if ([301,302,303,307,308].includes(status) && res.headers.location) {
        resolve({ redirect: res.headers.location }); res.destroy(); return;
      }
      const mime = (res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const allowed = kind === 'html' ? ['text/html','application/xhtml+xml'] : ['image/jpeg','image/png','image/webp'];
      if (status !== 200 || !allowed.includes(mime) ||
          (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') ||
          Number(res.headers['content-length'] || 0) > limit) {
        res.destroy(); reject(new Error('Unsupported preview response')); return;
      }
      let size = 0;
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > limit) { res.destroy(); reject(new Error('Preview too large')); return; }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ body: Buffer.concat(chunks), mime }));
      res.on('error', reject);
      res.on('aborted', () => reject(new Error('Preview aborted')));
    });
    timer = setTimeout(() => req.destroy(new Error('Preview deadline')), remaining);
    req.on('error', reject);
    req.on('close', () => clearTimeout(timer));
    req.end();
  });
  if (result.redirect) return fetchPublic(new URL(result.redirect, url).href, kind, deadline, redirects + 1);
  if (!result.body || !result.mime) throw new Error('Empty preview');
  return { body: result.body, mime: result.mime, url };
}

const entities: Record<string,string> = { amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' ' };
function decode(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (whole, entity: string) => {
    if (entity[0] !== '#') return entities[entity.toLowerCase()] || whole;
    const n = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2),16) : parseInt(entity.slice(1),10);
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
  });
}
function clean(value: string | undefined, limit: number): string | undefined {
  const text = decode(value || '').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim().slice(0,limit);
  return text || undefined;
}

export function parsePreview(html: string): LinkPreview & { imageUrl?: string } {
  // Only head metadata; ignore comments and script/style contents. All strings
  // are returned as text, not HTML, and are bounded before rendering.
  const head = html.split(/<\/head\s*>|<body(?:\s|>)/i,1)[0]
    .replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
  const meta = new Map<string,string>();
  for (const tag of head.match(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) || []) {
    const attrs: Record<string,string> = {};
    const pattern = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+))/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(tag))) attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4];
    const key = (attrs.property || attrs.name || '').toLowerCase();
    if (key && attrs.content && !meta.has(key)) meta.set(key, attrs.content);
  }
  return {
    title: clean(meta.get('og:title') || meta.get('twitter:title') || head.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1], 180),
    description: clean(meta.get('og:description') || meta.get('twitter:description') || meta.get('description'), 300),
    siteName: clean(meta.get('og:site_name'), 80),
    imageUrl: clean(meta.get('og:image:secure_url') || meta.get('og:image') || meta.get('twitter:image') || meta.get('twitter:image:src'), 2048),
  };
}

export function rasterMatches(body: Buffer, mime: string): boolean {
  return (mime === 'image/jpeg' && body.length >= 3 && body[0] === 255 && body[1] === 216 && body[2] === 255) ||
    (mime === 'image/png' && body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ||
    (mime === 'image/webp' && body.length >= 12 && body.toString('ascii',0,4) === 'RIFF' && body.toString('ascii',8,12) === 'WEBP');
}

export async function loadLinkPreview(raw: string): Promise<LinkPreview> {
  const deadline = Date.now() + TIME_LIMIT;
  const page = await fetchPublic(raw, 'html', deadline);
  const { imageUrl, ...preview } = parsePreview(page.body.toString('utf8'));
  if (imageUrl) {
    try {
      const image = await fetchPublic(new URL(imageUrl,page.url).href,'image',deadline);
      // Never return remote image URLs, SVG, HTML or arbitrary proxy bytes.
      if (rasterMatches(image.body,image.mime)) preview.image = 'data:' + image.mime + ';base64,' + image.body.toString('base64');
    } catch { /* Text metadata remains usable if an image is blocked. */ }
  }
  return preview;
}
