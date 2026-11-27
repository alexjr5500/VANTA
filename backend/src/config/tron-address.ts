import { createHash, timingSafeEqual } from 'crypto';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const TRON_USDT_ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const sha = (b: Buffer) => createHash('sha256').update(b).digest();

/** Decode canonical mainnet TRON Base58Check into its 21-byte 41-prefixed hex. */
export function tronAddressHex(address: unknown): string | null {
  if (typeof address !== 'string' || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return null;
  let n = BigInt(0);
  for (const char of address) n = n * BigInt(58) + BigInt(ALPHABET.indexOf(char));
  const raw = n.toString(16);
  const bytes = Buffer.from(raw.length % 2 ? '0' + raw : raw, 'hex');
  if (bytes.length !== 25 || bytes[0] !== 0x41) return null;
  const payload = bytes.subarray(0, 21);
  if (!timingSafeEqual(bytes.subarray(21), sha(sha(payload)).subarray(0, 4))) return null;
  return payload.toString('hex');
}
export function normalizeTronHex(address: unknown): string | null {
  if (typeof address !== 'string') return null;
  if (/^41[0-9a-f]{40}$/i.test(address)) return address.toLowerCase();
  if (/^[0-9a-f]{40}$/i.test(address)) return '41' + address.toLowerCase();
  return tronAddressHex(address);
}
export function shopTronAddresses(): string[] {
  const addresses = (process.env.VANTA_SHOP_TRON_DEPOSIT_ADDRESSES || '').split(',').map(v => v.trim()).filter(Boolean);
  // Preserve case. Reject malformed addresses, token contract, and zero payload.
  if (addresses.some(v => !tronAddressHex(v) || v === TRON_USDT_ADDRESS || tronAddressHex(v) === '41' + '0'.repeat(40))) return [];
  return [...new Set(addresses)];
}
