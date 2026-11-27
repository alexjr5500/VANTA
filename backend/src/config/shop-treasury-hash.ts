import { tonHashHex } from '../services/shop-ton.service';
export function treasuryHash(network: string, input: unknown): string | null {
  if (network === 'gram-ton') return tonHashHex(input);
  if (typeof input !== 'string') return null;
  return (network === 'usdt-trc20' ? /^[0-9a-f]{64}$/i : /^0x[0-9a-f]{64}$/i).test(input) ? input.toLowerCase() : null;
}
