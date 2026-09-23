/**
 * VANTA - CEO/Admin initial allocation seed (thin wrapper)
 *
 * Seeds the designated CEO/Admin account (ceo@vanta.app) with its one-time
 * initial allocation of EXACTLY 1,000,000 VANTA Coins using the shared
 * `admin-dev-wallet` service (src/services/admin-dev-wallet.service.ts).
 *
 * The allocation is REAL, database-backed, idempotent, and issued in every
 * environment — including production. Re-running this script (or the main
 * seed, or a server restart) can never add a duplicate allocation: the grant
 * is gated by a persistent `Wallet.ceoAllocationGrantedAt` marker claimed with
 * an atomic conditional update, and the wallet ledger is checked for an
 * existing allocation transaction first.
 *
 * Usage:
 *   npx ts-node --transpile-only prisma/seed-dev-wallet.ts
 *   npm run seed:dev-wallet
 *
 * Or automatically on server startup.
 */
import { isAdminDevEnvironment, seedAdminDevWallet } from '../src/services/admin-dev-wallet.service';
export { isAdminDevEnvironment as isDevelopment };
/**
 * Seed the CEO/Admin initial allocation. Idempotent and database-gated.
 * Returns the service result for programmatic/observability use.
 */
export declare function seedDevWallet(): Promise<ReturnType<typeof seedAdminDevWallet>>;
//# sourceMappingURL=seed-dev-wallet.d.ts.map