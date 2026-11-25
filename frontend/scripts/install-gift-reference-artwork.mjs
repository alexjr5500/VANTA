import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { initialGiftCatalog } = require('../../backend/prisma/gift-catalog.data.js');
const expected = new Set(initialGiftCatalog.map(g => g.slug));
const archive = path.join(root, 'assets', 'vanta-gift-reference-artwork.zip');
const output = path.join(root, 'public', 'gifts', 'reference');
if (expected.size !== 70 || !fs.existsSync(archive)) {
  throw Error('The approved 70-gift reference artwork archive must be installed before building.');
}
const zip = fs.readFileSync(archive);
if (zip.length > 8 * 1024 * 1024 || zip.length < 22) throw Error('Invalid gift archive size');
let end = zip.length - 22;
while (end >= Math.max(0, zip.length - 65557) && zip.readUInt32LE(end) !== 0x06054b50) end--;
if (end < Math.max(0, zip.length - 65557)) throw Error('Invalid gift ZIP directory');
const count = zip.readUInt16LE(end + 10);
let cursor = zip.readUInt32LE(end + 16);
if (count > 100) throw Error('Too many ZIP entries');
const assets = new Map();
for (let i = 0; i < count; i++) {
  if (cursor + 46 > zip.length || zip.readUInt32LE(cursor) !== 0x02014b50) throw Error('Invalid ZIP entry');
  const method = zip.readUInt16LE(cursor + 10);
  const compressed = zip.readUInt32LE(cursor + 20);
  const expanded = zip.readUInt32LE(cursor + 24);
  const nameLen = zip.readUInt16LE(cursor + 28);
  const extraLen = zip.readUInt16LE(cursor + 30);
  const commentLen = zip.readUInt16LE(cursor + 32);
  const offset = zip.readUInt32LE(cursor + 42);
  const name = zip.toString('utf8', cursor + 46, cursor + 46 + nameLen);
  cursor += 46 + nameLen + extraLen + commentLen;
  const match = /^artwork\/([a-z0-9]+(?:-[a-z0-9]+)*)\.webp$/.exec(name);
  if (!match) continue;
  const slug = match[1];
  if (!expected.has(slug) || assets.has(slug) || expanded < 12 || expanded > 256 * 1024 || offset + 30 > zip.length || zip.readUInt32LE(offset) !== 0x04034b50) throw Error('Invalid gift asset: ' + slug);
  const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
  if (start + compressed > zip.length) throw Error('Truncated gift asset');
  const raw = zip.subarray(start, start + compressed);
  const bytes = method === 0 ? raw : method === 8 ? inflateRawSync(raw, { maxOutputLength: 256 * 1024 }) : null;
  if (!bytes || bytes.length !== expanded || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') throw Error('Invalid WebP: ' + slug);
  assets.set(slug, bytes);
}
if (assets.size !== expected.size) throw Error('All 70 reference gifts are required');
fs.mkdirSync(output, { recursive: true });
for (const [slug, bytes] of assets) fs.writeFileSync(path.join(output, slug + '.webp'), bytes);
console.log('Installed ' + assets.size + ' approved reference gift artworks.');
