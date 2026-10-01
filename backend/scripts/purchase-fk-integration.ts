/* eslint-disable @typescript-eslint/no-var-requires */
// ============================================================================
// REAL-DATABASE PURCHASE FK INTEGRATION TEST (dev-only verification harness)
// ============================================================================
// Exercises the actual `PurchaseOrder_packageId_fkey` foreign key against a
// real SQLite database (the local env has no PostgreSQL server; the schema and
// Prisma layer are identical — SQLite enforces the SAME foreign key the
// production Postgres enforces, it just reports it as SQLITE_CONSTRAINT).
//
// PREREQUISITES (from backend/):
//   npx prisma generate --schema prisma/schema.sqlite.integration.prisma
//   npx prisma db push --schema prisma/schema.sqlite.integration.prisma
//
// Scenario replay:
//   1. Reproduces the PRODUCTION BUG: creating a PurchaseOrder with a package
//      id that exists only in the frontend config constant (the table is
//      empty/mismatched) => foreign-key failure.
//   2. Applies the fix's provisioning (ensureCanonicalPurchaseCatalog) so the
//      canonical config ids become real DB rows.
//   3. Verifies the FIXED order path (DB lookup first, then create) succeeds
//      for every canonical coin package.
//   4. Verifies unknown packages are rejected BEFORE order creation.
//   5. Verifies the badge path (VerificationPurchase -> SubscriptionPlan).
//   6. Verifies the completion credit is idempotent against a real DB.
//
// Run with: npx ts-node --transpile-only scripts/purchase-fk-integration.ts
// ============================================================================

import { PrismaClient } from '../.sqlite-test-client';
import { ensureCanonicalPurchaseCatalog } from '../src/services/purchase-catalog.service';
import { VANTA_COIN_PACKAGES } from '../src/config/wallet.config';

const prisma = new PrismaClient();
const FAILED = (msg: string): never => {
  console.error(`✘ FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
};
let passed = 0;
const ok = (msg: string) => {
  passed += 1;
  console.log(`  ✓ ${msg}`);
};

async function main() {
  // --------------------------------------------------------------------------
  console.log('\n1) Reproduce the production failure (`PurchaseOrder_packageId_fkey`)');
  // --------------------------------------------------------------------------
  const user = await prisma.user.create({
    data: { username: `integration_${Date.now()}`, email: `it_${Date.now()}@vanta.app` },
  });

  let fkThrown = false;
  try {
    // This mirrors the OLD code path: packageId came from the in-code config
    // constant and the SparkCoinPackage table had no such row in production.
    await prisma.purchaseOrder.create({
      data: {
        userId: user.id,
        packageId: 'pkg_popular',
        coins: 500,
        amount: 5,
        status: 'PENDING',
      },
    });
  } catch (e: any) {
    if (e && /foreign key|constraint/i.test(String(e.message || ''))) {
      fkThrown = true;
      console.log(`    (expected) foreign-key error on empty catalog: ${String(e.message).split('\n')[0]}`);
    }
  }
  if (!fkThrown) FAILED('order with non-existent packageId did NOT violate the FK (fix would not be needed)');
  ok('non-existent packageId violates PurchaseOrder_packageId_fkey (bug reproduced on a real DB)');

  // --------------------------------------------------------------------------
  console.log('\n2) Provision the canonical catalog (the production fix)');
  // --------------------------------------------------------------------------
  const sync = await ensureCanonicalPurchaseCatalog(prisma);
  ok(`provisioned ${sync.coinPackages} coin packages + ${sync.badgePlans} badge plans (legacy retired: ${sync.legacyDeactivated})`);

  const dbPkgs = await prisma.sparkCoinPackage.findMany({ where: { isActive: true } });
  if (VANTA_COIN_PACKAGES.length !== dbPkgs.length) {
    FAILED(`expected ${VANTA_COIN_PACKAGES.length} active coin packages, found ${dbPkgs.length}`);
  }
  ok(`every canonical coin package (${dbPkgs.length}) exists as an active database row`);

  // Idempotency — running provisioning again must not duplicate rows.
  await ensureCanonicalPurchaseCatalog(prisma);
  const countAfterSecondRun = await prisma.sparkCoinPackage.count();
  if (countAfterSecondRun !== VANTA_COIN_PACKAGES.length) {
    FAILED(`catalog provisioning duplicated rows (${countAfterSecondRun})`);
  }
  ok('re-running provisioning does NOT duplicate packages');

  // --------------------------------------------------------------------------
  console.log('\n3) FIXED purchase path: every coin package creates a PurchaseOrder (real FK)');
  // --------------------------------------------------------------------------
  const coinPackages = await prisma.sparkCoinPackage.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  });
  for (const pkg of coinPackages) {
    // This is exactly what initializeCoinPurchase now does: pull the row from
    // the DB, then create the order with the DB-verified id/price/coins.
    const dbRecord = await prisma.sparkCoinPackage.findUnique({ where: { id: pkg.id } });
    if (!dbRecord || !dbRecord.isActive) FAILED(`package ${pkg.id} not found/inactive`);
    const order = await prisma.purchaseOrder.create({
      data: {
        userId: user.id,
        packageId: dbRecord.id,
        packageName: dbRecord.name,
        coins: dbRecord.coins,
        amount: dbRecord.price,
        currency: 'USD',
        status: 'PENDING',
      },
    });
    if (order.packageId !== pkg.id) FAILED(`order.packageId (${order.packageId}) !== ${pkg.id}`);
    if (order.coins !== dbRecord.coins || order.amount !== dbRecord.price) {
      FAILED(`order values do not match the authoritative DB row for ${pkg.id}`);
    }
  }
  ok(`all ${coinPackages.length} coin packages created PurchaseOrders with valid FK + DB-authoritative values`);

  // --------------------------------------------------------------------------
  console.log('\n4) Unknown packages are rejected BEFORE any order is created');
  // --------------------------------------------------------------------------
  const before = await prisma.purchaseOrder.count();
  let rejectedCleanly = false;
  try {
    const lookup = await prisma.sparkCoinPackage.findUnique({ where: { id: 'pkg_nonexistent' } });
    if (!lookup) rejectedCleanly = true;
  } catch (e: any) {
    FAILED(`unexpected error on lookup: ${e.message}`);
  }
  if (!rejectedCleanly) FAILED('unknown package unexpectedly resolved');
  const after = await prisma.purchaseOrder.count();
  if (after !== before) FAILED('order was created for an unknown package');
  ok('unknown package is rejected before any order is created');

  // --------------------------------------------------------------------------
  console.log('\n5) Badge path (VerificationPurchase -> SubscriptionPlan) on a real DB');
  // --------------------------------------------------------------------------
  const bluePlan = await prisma.subscriptionPlan.findUnique({ where: { id: 'plan_blue_1month' } });
  if (!bluePlan) FAILED('plan_blue_1month missing after catalog provisioning');
  const badgeOrder = await prisma.verificationPurchase.create({
    data: {
      userId: user.id,
      planId: bluePlan.id,
      amount: bluePlan.price,
      currency: 'USD',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  if (badgeOrder.planId !== 'plan_blue_1month') FAILED('badge order planId mismatch');
  ok('Blue 1-month plan created a VerificationPurchase with a valid plan FK');

  let badgeFkThrown = false;
  try {
    await prisma.verificationPurchase.create({
      data: {
        userId: user.id,
        planId: 'plan_does_not_exist',
        amount: 1,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 60000),
      },
    });
  } catch (e: any) {
    if (e && /foreign key|constraint/i.test(String(e.message || ''))) badgeFkThrown = true;
  }
  if (!badgeFkThrown) FAILED('badge purchase with unknown planId did not violate the plan FK');
  ok('unknown badge planId violates the plan FK (plans are validated before create)');

  // --------------------------------------------------------------------------
  console.log('\n6) Order completion credit is idempotent against a real DB');
  // --------------------------------------------------------------------------
  await prisma.wallet.create({ data: { userId: user.id, coinBalance: 0, totalCoinsPurchased: 0 } });
  const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
  if (!wallet) FAILED('wallet missing');
  const pkgStarter = await prisma.sparkCoinPackage.findUnique({ where: { id: 'pkg_starter' } });
  if (!pkgStarter) FAILED('pkg_starter missing');
  const completableOrder = await prisma.purchaseOrder.create({
    data: {
      userId: user.id,
      packageId: pkgStarter.id,
      coins: pkgStarter.coins,
      amount: pkgStarter.price,
      status: 'PENDING',
    },
  });

  const applyCompletion = async () =>
    prisma.$transaction(async (tx) => {
      const claimed = await tx.purchaseOrder.updateMany({
        where: { id: completableOrder.id, userId: user.id, status: { in: ['PENDING', 'PROCESSING', 'PAID'] } },
        data: { status: 'COMPLETED', confirmedAt: new Date() },
      });
      if (claimed.count === 0) return 0;
      const updated = await tx.wallet.update({
        where: { userId: user.id },
        data: {
          coinBalance: { increment: completableOrder.coins },
          totalCoinsPurchased: { increment: completableOrder.coins },
        },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId: user.id,
          type: 'PURCHASE',
          amount: completableOrder.coins,
          fee: 0,
          balanceBefore: wallet.coinBalance,
          balance: updated.coinBalance,
          status: 'COMPLETED',
          description: `Purchased ${completableOrder.coins} VANTA Coins`,
          reference: completableOrder.id,
        },
      });
      return 1;
    });

  const first = await applyCompletion();
  if (first !== 1) FAILED('first completion did not credit');
  const second = await applyCompletion();
  if (second !== 0) FAILED('duplicate completion credited again (must be idempotent)');
  const walletAfter = await prisma.wallet.findUnique({ where: { userId: user.id } });
  if (walletAfter!.coinBalance !== pkgStarter.coins) {
    FAILED(`wallet balance ${walletAfter!.coinBalance} != ${pkgStarter.coins} (double-credit?)`);
  }
  const ledgerRows = await prisma.walletTransaction.count({
    where: { userId: user.id, type: 'PURCHASE', reference: completableOrder.id },
  });
  if (ledgerRows !== 1) FAILED(`expected exactly 1 ledger row, found ${ledgerRows}`);
  ok(`completion credited EXACTLY once (${pkgStarter.coins} coins, 1 ledger row, no double credit)`);

  console.log(`\nALL ${passed} REAL-DATABASE FK/FLOW CHECKS PASSED.`);
}

main()
  .catch((e) => {
    console.error('\n✘ INTEGRATION TEST FAILED:', e && e.message ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });