import { shopTonAddresses } from './ton-address';
import { shopTronAddresses } from './tron-address';
import { getCoinPaymentMode, getCoinPaymentDepositAddress } from './coin-payments.config';
import { getBadgePaymentDepositAddress } from './verification-badge.config';

export function shopCryptoAddresses(network?: string): string[] {
  if (network === 'gram-ton') return shopTonAddresses();
  if (network === 'usdt-trc20') return shopTronAddresses();
  const reserved = new Set([getCoinPaymentDepositAddress()?.toLowerCase(), getBadgePaymentDepositAddress().toLowerCase(), '0x' + '0'.repeat(40)]);
  const configured = (process.env.VANTA_SHOP_CRYPTO_DEPOSIT_ADDRESSES || '').split(',').map(a => a.trim().toLowerCase()).filter(Boolean);
  // Malformed or existing shared treasury addresses disable the entire configuration.
  if (configured.some(a => !/^0x[0-9a-f]{40}$/.test(a) || reserved.has(a))) return [];
  return Array.from(new Set(configured));
}

export function shopLiveCryptoEnabled(): boolean {
  return process.env.VANTA_SHOP_LIVE_CRYPTO_ENABLED === 'true' &&
    getCoinPaymentMode() === 'live' && (shopCryptoAddresses().length > 0 || (process.env.VANTA_SHOP_TRC20_ENABLED === 'true' && shopTronAddresses().length > 0) || (process.env.VANTA_SHOP_TON_ENABLED === 'true' && shopTonAddresses().length > 0 && !!process.env.VANTA_TONCENTER_API_KEY && !!process.env.VANTA_COINGECKO_DEMO_API_KEY));
}

/** Extra rails are opt-in; existing shared-wallet routes do not gain support. */
export function shopCryptoNetworks(): string[] {
  const networks = shopCryptoAddresses().length > 0 ? ['usdt-bep20', 'usdc-base'] : [];
  if (process.env.VANTA_SHOP_TRC20_ENABLED === 'true' && shopTronAddresses().length > 0) networks.push('usdt-trc20');
  if (process.env.VANTA_SHOP_TON_ENABLED === 'true' && shopTonAddresses().length > 0 && process.env.VANTA_TONCENTER_API_KEY && process.env.VANTA_COINGECKO_DEMO_API_KEY) networks.push('gram-ton');
  const rpc = process.env.VANTA_ETHEREUM_RPC_URL?.trim();
  if (rpc && shopCryptoAddresses().length > 0) {
    try { const url = new URL(rpc); if (url.protocol === 'https:' && !url.username && !url.password) {
      if (process.env.VANTA_SHOP_ERC20_ENABLED === 'true') networks.push('usdt-erc20');
      if (process.env.VANTA_SHOP_NATIVE_ETH_ENABLED === 'true') networks.push('eth-erc20');
    } } catch { /* fail closed */ }
  }
  return networks;
}
