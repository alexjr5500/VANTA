/**
 * VANTA - Development Wallet Seed
 *
 * Seeds the Admin/CEO account with 1,000,000 VANTA Coins for development/testing.
 *
 * ⚠️ DEVELOPMENT ONLY - Never runs in production.
 * Guarded by NODE_ENV === "development" (or explicit SEED_DEV_WALLET=true).
 *
 * Usage:
 *   npx ts-node --transpile-only prisma/seed-dev-wallet.ts
 *
 * Or automatically on server startup in development mode.
 */
declare function isDevelopment(): boolean;
declare function seedDevWallet(): Promise<void>;
export { seedDevWallet, isDevelopment };
//# sourceMappingURL=seed-dev-wallet.d.ts.map