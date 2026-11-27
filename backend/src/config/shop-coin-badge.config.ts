import { shopSandboxEnabled } from './shop-sandbox.config';
import { VANTA_COINS_PER_USD } from './wallet.config';

export function shopCoinBadgeEnabled(): boolean {
  return shopSandboxEnabled() && process.env.VANTA_SHOP_COIN_BADGE_ENABLED === 'true';
}
export function badgeCoinCost(usd: number): number {
  const coins = Math.round(usd * VANTA_COINS_PER_USD);
  if (!Number.isSafeInteger(coins) || coins <= 0 || Math.abs(coins / VANTA_COINS_PER_USD - usd) > 1e-8) throw new Error('Invalid badge coin price');
  return coins;
}
