export const VANTA_COINS_PER_USD = 100;
export const TRANSFER_FEE_RATE = 0.05;

/**
 * Share of a gift's coin value credited to the receiver.
 * Mirrors the backend rule (GIFT_RECIPIENT_SHARE) so the UI can accurately
 * communicate value: a 10-coin gift credits the receiver 7 coins.
 */
export const GIFT_RECIPIENT_SHARE = 0.7;

/** Coins the receiver actually gets for a gift priced at `price` coins. */
export function giftRecipientCoins(price: number): number {
  return Math.floor(Math.max(0, Number(price) || 0) * GIFT_RECIPIENT_SHARE);
}


export const VANTA_COIN_PACKAGES = [
  { id: 'pkg_starter', name: 'Starter', coins: 100, bonusCoins: 0, price: 1, badge: null },
  { id: 'pkg_popular', name: 'Popular', coins: 500, bonusCoins: 25, price: 5, badge: 'MOST_POPULAR' },
  { id: 'pkg_standard', name: 'Standard', coins: 1000, bonusCoins: 50, price: 10, badge: null },
  { id: 'pkg_premium', name: 'Premium', coins: 5000, bonusCoins: 250, price: 50, badge: null },
  { id: 'pkg_elite', name: 'Elite', coins: 10000, bonusCoins: 500, price: 100, badge: null },
  { id: 'pkg_ultimate', name: 'Ultimate', coins: 25000, bonusCoins: 1500, price: 250, badge: 'BEST_VALUE' },
  { id: 'pkg_legendary', name: 'Legendary', coins: 50000, bonusCoins: 3500, price: 500, badge: null },
  { id: 'pkg_1000', name: 'Signature', coins: 100000, bonusCoins: 7000, price: 1000, badge: null },
  { id: 'pkg_2500', name: 'Reserve', coins: 250000, bonusCoins: 20000, price: 2500, badge: null },
  { id: 'pkg_5000', name: 'Prestige', coins: 500000, bonusCoins: 45000, price: 5000, badge: null },
  { id: 'pkg_10000', name: 'Obsidian', coins: 1000000, bonusCoins: 100000, price: 10000, badge: null },
  { id: 'pkg_25000', name: 'Private', coins: 2500000, bonusCoins: 300000, price: 25000, badge: null },
  { id: 'pkg_50000', name: 'Sovereign', coins: 5000000, bonusCoins: 700000, price: 50000, badge: null },
  { id: 'pkg_75000', name: 'Imperial', coins: 7500000, bonusCoins: 1125000, price: 75000, badge: null },
  { id: 'pkg_100000', name: 'Founder', coins: 10000000, bonusCoins: 1600000, price: 100000, badge: 'BEST_VALUE' },
] as const;

export function coinsToUsd(coins: number): number {
  return Math.round((Math.max(0, Number(coins) || 0) / VANTA_COINS_PER_USD) * 100) / 100;
}

export function formatUsdFromCoins(coins: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(coinsToUsd(coins));
}

export function calculateTransferFee(coins: number): number {
  return Math.ceil(Math.max(0, Number(coins) || 0) * TRANSFER_FEE_RATE);
}

/**
 * Compact coin formatter for tight mobile surfaces.
 * Small values render in full (e.g. 12,450); large values compress
 * (e.g. 1.2M, 10M) so oversized balances never break the phone layout.
 */
export function formatCoinsCompact(coins: number): string {
  const n = Math.max(0, Number(coins) || 0);
  if (n < 1_000_000) return n.toLocaleString();
  return new Intl.NumberFormat('en-US', {
    notation: 'compact', maximumFractionDigits: 1,
  }).format(n);
}


