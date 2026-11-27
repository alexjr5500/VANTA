// Canonical raw workchain-0 address; friendly encoding uses CRC16-XMODEM.
function crc16(data: Buffer): number {
  let crc = 0;
  for (const b of data) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = ((crc << 1) ^ ((crc & 0x8000) ? 0x1021 : 0)) & 0xffff;
  }
  return crc;
}
export function tonRawAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (/^0:[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();
  if (!/^[A-Za-z0-9_-]{48}$/.test(value)) return null;
  const data = Buffer.from(value, 'base64url');
  if (data.length !== 36 || ![0x11, 0x51].includes(data[0]) || data[1] !== 0 || crc16(data.subarray(0, 34)) !== data.readUInt16BE(34)) return null;
  return '0:' + data.subarray(2, 34).toString('hex');
}
export function tonFriendlyAddress(raw: string): string {
  if (!/^0:[0-9a-f]{64}$/.test(raw)) throw new Error('Invalid TON address');
  const data = Buffer.alloc(36);
  data[0] = 0x51; // mainnet non-bounceable
  Buffer.from(raw.slice(2), 'hex').copy(data, 2);
  data.writeUInt16BE(crc16(data.subarray(0, 34)), 34);
  return data.toString('base64url');
}
export function shopTonAddresses(): string[] {
  const raw = (process.env.VANTA_SHOP_TON_DEPOSIT_ADDRESSES || '').split(',').map(s => s.trim()).filter(Boolean).map(tonRawAddress);
  if (raw.some(a => !a || a === '0:' + '0'.repeat(64))) return [];
  return [...new Set(raw as string[])];
}
