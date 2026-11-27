import { getCoinPaymentMode, getCoinPaymentDepositAddress } from './coin-payments.config';
import { getBadgePaymentDepositAddress } from './verification-badge.config';

export function shopCryptoAddresses(): string[] {
  const reserved = new Set([getCoinPaymentDepositAddress()?.toLowerCase(), getBadgePaymentDepositAddress().toLowerCase(), '0x' + '0'.repeat(40)]);
  const configured = (process.env.VANTA_SHOP_CRYPTO_DEPOSIT_ADDRESSES || '').split(',').map(a => a.trim().toLowerCase()).filter(Boolean);
  // Malformed or existing shared treasury addresses disable the entire configuration.
  if (configured.some(a => !/^0x[0-9a-f]{40}$/.test(a) || reserved.has(a))) return [];
  return Array.from(new Set(configured));
}

export function shopLiveCryptoEnabled(): boolean {
  return process.env.VANTA_SHOP_LIVE_CRYPTO_ENABLED === 'true' &&
    getCoinPaymentMode() === 'live' && shopCryptoAddresses().length > 0;
}

/** Extra rails are opt-in; existing shared-wallet routes do not gain support. */
export function shopCryptoNetworks(): string[] {
  const networks = ['usdt-bep20', 'usdc-base'];
  const rpc = process.env.VANTA_ETHEREUM_RPC_URL?.trim();
  if (process.env.VANTA_SHOP_ERC20_ENABLED === 'true' && rpc) {
    try { const url = new URL(rpc); if (url.protocol === 'https:' && !url.username && !url.password) networks.push('usdt-erc20'); } catch { /* fail closed */ }
  }
  return networks;
}
