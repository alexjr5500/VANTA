/** Canonical VANTA Wallet monetary rules. Never duplicate these values. */
export const VANTA_COINS_PER_USD = 100;
export const MIN_COIN_PURCHASE_USD = 1;
export const MAX_COIN_PURCHASE_USD = 100_000;
export const GIFT_RECIPIENT_SHARE = 0.7;
export const TRANSFER_FEE_RATE = 0.05;
export const WITHDRAWAL_FEE_RATE = 0.10;
export const MIN_WITHDRAWAL_AMOUNT = 10;

/**
 * VANTA purchase packages.
 *
 * This is the approved customer-facing purchase catalog. Keep package IDs,
 * quantities, and prices aligned with the frontend fallback.
 *
 * NOTE: Coins are NEVER awarded above the package amount. A user who buys a
 * package always receives EXACTLY `package.coinAmount` coins — there are no
 * bonus/extra/promotional coins on VANTA Coin purchases.
 */
export const VANTA_COIN_PACKAGES = [
  { id: 'pkg_starter', name: 'Starter', coins: 100, price: 1, badge: null },
  { id: 'pkg_popular', name: 'Popular', coins: 500, price: 5, badge: 'MOST_POPULAR' },
  { id: 'pkg_standard', name: 'Standard', coins: 1000, price: 10, badge: null },
  { id: 'pkg_premium', name: 'Premium', coins: 5000, price: 50, badge: null },
  { id: 'pkg_elite', name: 'Elite', coins: 10000, price: 100, badge: null },
  { id: 'pkg_ultimate', name: 'Ultimate', coins: 25000, price: 250, badge: 'BEST_VALUE' },
  { id: 'pkg_legendary', name: 'Legendary', coins: 50000, price: 500, badge: 'LIMITED_OFFER' },
  { id: 'pkg_1000', name: 'Signature', coins: 100000, price: 1000, badge: null },
  { id: 'pkg_2500', name: 'Reserve', coins: 250000, price: 2500, badge: null },
  { id: 'pkg_5000', name: 'Prestige', coins: 500000, price: 5000, badge: null },
  { id: 'pkg_10000', name: 'Obsidian', coins: 1000000, price: 10000, badge: null },
  { id: 'pkg_25000', name: 'Private', coins: 2500000, price: 25000, badge: null },
  { id: 'pkg_50000', name: 'Sovereign', coins: 5000000, price: 50000, badge: null },
  { id: 'pkg_75000', name: 'Imperial', coins: 7500000, price: 75000, badge: null },
  { id: 'pkg_100000', name: 'Founder', coins: 10000000, price: 100000, badge: 'BEST_VALUE' },
] as const;

export function coinsToUsd(coins: number): number {
  return Math.round((Math.max(0, coins) / VANTA_COINS_PER_USD) * 100) / 100;
}

export function calculateGiftRecipientCoins(giftCoinValue: number): number {
  return Math.floor(Math.max(0, giftCoinValue) * GIFT_RECIPIENT_SHARE);
}

export function calculateTransferFee(coins: number): number {
  return Math.ceil(Math.max(0, coins) * TRANSFER_FEE_RATE);
}

// ============================================================================
// VANTA GIVE — fundraiser donation rules
// ============================================================================

/** Platform fee (fraction) withheld from the beneficiary's proceeds for donations. */
export const FUNDRAISER_PLATFORM_FEE_RATE = 0.05;
/** Coins earned per 1 currency unit of the fundraiser's currency (USD-aligned). */
export const FUNDRAISER_COINS_PER_UNIT = VANTA_COINS_PER_USD;
/** Minimum donation in coins. */
export const MIN_FUNDRAISER_DONATION_COINS = 100;

/** Convert a currency amount (fundraiser currency) into VANTA coins for settlement. */
export function currencyToCoins(amount: number, coinsPerUnit: number = FUNDRAISER_COINS_PER_UNIT): number {
  return Math.floor(Math.max(0, amount) * coinsPerUnit);
}

/** Platform fee in coins for a donation's coin value. */
export function calculateFundraiserFeeCoins(coins: number): number {
  return Math.ceil(Math.max(0, coins) * FUNDRAISER_PLATFORM_FEE_RATE);
}