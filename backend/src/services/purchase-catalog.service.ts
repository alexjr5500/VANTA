// ============================================================================
// PURCHASE CATALOG PROVISIONING (idempotent, safe to run on every boot)
// ============================================================================
// The database rows in `SparkCoinPackage` (VANTA Coins) and `SubscriptionPlan`
// (Verified Badge) are the AUTHORITATIVE purchase catalog: the backend resolves
// every order from these rows, and the frontend catalog endpoint serves them.
//
// Production deployment (Railway) does NOT run `npm run seed` on every deploy,
// so the canonical rows are provisioned here instead — from the same config
// modules the API uses — making package provisioning part of every startup.
//
// Guarantees:
//   * idempotent upsert (running it 1x or 1000x yields the same rows);
//   * never deletes rows — legacy packages with mismatched ids (e.g.
//     `pkg_popular_pack` from older seeds) are only deactivated (isActive=false)
//     so historical PurchaseOrder rows keep their FK reference intact;
//   * prices/coin amounts always come from the config catalogs, never from the
//     client.
// ============================================================================

import { PrismaClient } from '@prisma/client';
import { VANTA_COIN_PACKAGES } from '../config/wallet.config';
import { VERIFIED_BADGE_PLANS } from '../config/verification-badge.config';

export interface PurchaseCatalogSyncResult {
  coinPackages: number;
  badgePlans: number;
  legacyDeactivated: number;
}

/**
 * Upsert the canonical VANTA Coin packages (`SparkCoinPackage`) and the
 * canonical Verified Badge plans (`SubscriptionPlan`) from the server-side
 * config catalogs, then deactivate any legacy coin packages whose ids are no
 * longer part of the canonical catalog.
 *
 * Pass the Prisma client (including inside a transaction) so the same routine
 * is used by `prisma/seed.ts` and by the app's startup provisioning.
 */
export async function ensureCanonicalPurchaseCatalog(
  client: PrismaClient,
  options: { syncBadgePlans?: boolean } = {}
): Promise<PurchaseCatalogSyncResult> {
  const syncBadgePlans = options.syncBadgePlans !== false;

  const canonicalCoinIds: string[] = [];
  let coinPackages = 0;

  for (const [index, pkg] of VANTA_COIN_PACKAGES.entries()) {
    canonicalCoinIds.push(pkg.id);
    const data = {
      name: pkg.name,
      coins: pkg.coins,
      price: pkg.price,
      // Zero bonus coins is the authoritative rule across every purchase path.
      bonusCoins: 0,
      isPopular: pkg.badge === 'MOST_POPULAR',
      isActive: true,
      sortOrder: index,
    };
    await client.sparkCoinPackage.upsert({
      where: { id: pkg.id },
      update: data,
      create: { id: pkg.id, ...data },
    });
    coinPackages += 1;
  }

  // Retire legacy/non-canonical coin packages (e.g. `pkg_starter_pack` from
  // older seeds) so they can never be sold at stale prices or listed twice in
  // the catalog. Rows are intentionally KEPT (only deactivated) so historical
  // PurchaseOrder FK references never break.
  const legacy = await client.sparkCoinPackage.updateMany({
    where: {
      isActive: true,
      id: { notIn: canonicalCoinIds },
    },
    data: { isActive: false },
  });

  let badgePlans = 0;
  if (syncBadgePlans) {
    for (const plan of VERIFIED_BADGE_PLANS) {
      const data = {
        name: plan.name,
        durationMonths: plan.durationMonths,
        price: plan.priceUSD,
        currency: 'USD',
        description: plan.description,
        benefits: JSON.stringify(plan.benefits),
        isActive: true,
        sortOrder: plan.sortOrder,
        badgeType: plan.badgeType,
      };
      await client.subscriptionPlan.upsert({
        where: { id: plan.id },
        update: data,
        create: { id: plan.id, ...data },
      });
      badgePlans += 1;
    }
  }

  return {
    coinPackages,
    badgePlans,
    legacyDeactivated: legacy.count,
  };
}
