import { getCoinPaymentMode } from './coin-payments.config';
import { treasuryAddress } from './shop-treasury.config';
import { getBlockchainNetwork } from './blockchain-networks.config';

// Initial automatic release supports exact ERC-20/BEP-20 stablecoin sweeps.
// Native coin fee deductions and non-EVM outbound proof need separate review.
export const AUTO_TREASURY_NETWORKS = ['usdt-bep20', 'usdc-base', 'usdt-erc20'] as const;
export type AutoNetwork = typeof AUTO_TREASURY_NETWORKS[number];
export function isAutoNetwork(network: string): network is AutoNetwork {
  return AUTO_TREASURY_NETWORKS.some(n => n === network);
}
export function positiveAtomic(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9][0-9]{0,77}$/.test(value) && BigInt(value) < BigInt(2) ** BigInt(256);
}
const maxFeeKeys: Record<AutoNetwork, string> = {
  'usdt-bep20': 'VANTA_TREASURY_BSC_MAX_FEE_WEI',
  'usdc-base': 'VANTA_TREASURY_BASE_MAX_FEE_WEI',
  'usdt-erc20': 'VANTA_TREASURY_ETHEREUM_MAX_FEE_WEI',
};
export function automaticTreasuryConfig() {
  if (process.env.VANTA_TREASURY_AUTO_ENABLED !== 'true' || getCoinPaymentMode() !== 'live') return null;
  if (process.env.VANTA_TREASURY_CUSTODY_VERIFIED !== 'true') return null;
  const start = process.env.VANTA_TREASURY_AUTO_NOT_BEFORE || '';
  if (!start || !Number.isFinite(Date.parse(start)) || Date.parse(start) > Date.now()) return null;
  const policyId = process.env.VANTA_TREASURY_SIGNER_POLICY_ID || '';
  const secret = process.env.VANTA_TREASURY_SIGNER_HMAC_SECRET || '';
  const raw = process.env.VANTA_TREASURY_SIGNER_URL || '';
  const maxOrderCents = Number(process.env.VANTA_TREASURY_AUTO_MAX_ORDER_CENTS || '');
  const dailyCapCents = Number(process.env.VANTA_TREASURY_AUTO_DAILY_CAP_CENTS || '');
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(policyId) || secret.length < 32 || !Number.isSafeInteger(maxOrderCents) || maxOrderCents <= 0 || !Number.isSafeInteger(dailyCapCents) || dailyCapCents < maxOrderCents || dailyCapCents > 2147483647) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.hostname === 'localhost' || !url.hostname.includes('.')) return null;
  const enabled = (process.env.VANTA_TREASURY_AUTO_NETWORKS || '').split(',').map(n => n.trim()).filter(Boolean);
  if (!enabled.length || enabled.some(n => !isAutoNetwork(n))) return null;
  const networks: { network: AutoNetwork; destination: string; maxFeeAtomic: string }[] = [];
  for (const network of [...new Set(enabled)] as AutoNetwork[]) {
    const destination = treasuryAddress(network);
    const maxFeeAtomic = process.env[maxFeeKeys[network]];
    if (!destination || !positiveAtomic(maxFeeAtomic) || !getBlockchainNetwork(network)?.rpcUrl) return null;
    networks.push({ network, destination, maxFeeAtomic });
  }
  return { origin: url.origin, policyId, secret, maxOrderCents, dailyCapCents, networks };
}
export function automaticTreasuryPublicStatus() {
  const config = automaticTreasuryConfig();
  return { enabled: !!config, networks: config?.networks.map(n => n.network) || [], policyId: config?.policyId || null, automaticBroadcast: !!config };
}
