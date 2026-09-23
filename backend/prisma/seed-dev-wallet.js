"use strict";
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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDevelopment = void 0;
exports.seedDevWallet = seedDevWallet;
const client_1 = require("@prisma/client");
const admin_dev_wallet_service_1 = require("../src/services/admin-dev-wallet.service");
Object.defineProperty(exports, "isDevelopment", { enumerable: true, get: function () { return admin_dev_wallet_service_1.isAdminDevEnvironment; } });
const prisma = new client_1.PrismaClient();
/**
 * Seed the CEO/Admin initial allocation. Idempotent and database-gated.
 * Returns the service result for programmatic/observability use.
 */
function seedDevWallet() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const result = yield (0, admin_dev_wallet_service_1.seedAdminDevWallet)(prisma);
        switch (result.action) {
            case 'disabled':
                console.log('⏭️  CEO/Admin allocation disabled by configuration.');
                break;
            case 'admin-not-found':
                console.log('⚠️  No CEO/Admin account found. Run `npx prisma db seed` first to create the admin.');
                break;
            case 'seed-already-available':
                console.log(`✓ CEO/Admin initial allocation already present. ${((_a = result.admin) === null || _a === void 0 ? void 0 : _a.email) || ((_b = result.admin) === null || _b === void 0 ? void 0 : _b.username)} has ${result.balanceAfter.toLocaleString()} VANTA Coins.`);
                break;
            case 'granted':
                console.log('✓ CEO/Admin initial allocation applied.');
                console.log(`Admin (${((_c = result.admin) === null || _c === void 0 ? void 0 : _c.email) || ((_d = result.admin) === null || _d === void 0 ? void 0 : _d.username)}) credited with ${result.credited.toLocaleString()} VANTA Coins`);
                console.log(`  - Available Balance: ${result.balanceAfter.toLocaleString()} VANTA Coins`);
                console.log(`  - Transaction: ${admin_dev_wallet_service_1.ADMIN_DEV_TX_TYPE} (${admin_dev_wallet_service_1.ADMIN_DEV_TX_REFERENCE})`);
                break;
        }
        return result;
    });
}
// ============================================================================
// RUN (when executed directly as a script)
// ============================================================================
// Only auto-run when executed directly (not when imported)
if (require.main === module) {
    seedDevWallet()
        .catch((e) => {
        console.error('❌ Development wallet seed failed:', e);
        process.exit(1);
    })
        .finally(() => __awaiter(void 0, void 0, void 0, function* () {
        yield prisma.$disconnect();
    }));
}
//# sourceMappingURL=seed-dev-wallet.js.map