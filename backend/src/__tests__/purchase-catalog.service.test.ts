// ============================================================================
// PURCHASE CATALOG PROVISIONING TESTS
//
// The database (`SparkCoinPackage` / `SubscriptionPlan`) is the authoritative
// purchase catalog. These tests pin the provisioning routine that keeps the DB
// in sync with the canonical config catalogs on every deploy:
//   * canonical coin packages are upserted with the EXACT ids the frontend
//     sends (so `PurchaseOrder_packageId_fkey` can never fire);
//   * legacy rows with mismatched ids are deactivated, never deleted;
//   * badge plans are upserted from the canonical Verified Badge catalog.
// ============================================================================

import { ensureCanonicalPurchaseCatalog } from '../services/purchase-catalog.service';
import { VANTA_COIN_PACKAGES } from '../config/wallet.config';
import { VERIFIED_BADGE_PLANS } from '../config/verification-badge.config';

function createFakeClient() {
  const upserted: any[] = [];
  let legacyCount = 0;
  const client: any = {
    sparkCoinPackage: {
      upsert: jest.fn(async ({ create }: any) => {
        upserted.push(create);
        return { ...create };
      }),
      updateMany: jest.fn(async () => ({ count: legacyCount })),
    },
    subscriptionPlan: {
      upsert: jest.fn(async ({ create }: any) => ({ ...create })),
    },
  };
  return { client, upserted, setLegacyCount: (n: number) => { legacyCount = n; } };
}

describe('ensureCanonicalPurchaseCatalog', () => {
  it('upserts every canonical coin package using the config id as the database primary key', async () => {
    const { client, upserted } = createFakeClient();

    const result = await ensureCanonicalPurchaseCatalog(client);

    // Every config package became a real DB row with the SAME id.
    expect(upserted.length).toBe(VANTA_COIN_PACKAGES.length);
    for (const pkg of VANTA_COIN_PACKAGES) {
      const row = upserted.find((u: any) => u.id === pkg.id);
      expect(row).toBeDefined();
      expect(row.name).toBe(pkg.name);
      expect(row.coins).toBe(pkg.coins);
      expect(row.price).toBe(pkg.price);
      expect(row.isActive).toBe(true);
    }
    // "MOST_POPULAR" maps into the DB isPopular flag.
    expect(upserted.find((u: any) => u.id === 'pkg_popular').isPopular).toBe(true);
    expect(result.coinPackages).toBe(VANTA_COIN_PACKAGES.length);
    expect(result.legacyDeactivated).toBe(0);
  });

  it('retires legacy rows (old *_pack ids) WITHOUT deleting them', async () => {
    const { client, setLegacyCount } = createFakeClient();
    setLegacyCount(12); // e.g. the 12 legacy "Pack" rows from an older seed

    await ensureCanonicalPurchaseCatalog(client);

    const where = client.sparkCoinPackage.updateMany.mock.calls[0][0].where;
    expect(where.isActive).toBe(true);
    // Every legacy id is excluded from the deactivation, canonical rows kept.
    expect(where.id.notIn).toHaveLength(VANTA_COIN_PACKAGES.length);
    expect(client.sparkCoinPackage.updateMany.mock.calls[0][0].data.isActive).toBe(false);
  });

  it('upserts the canonical Verified Badge plans from SubscriptionPlan', async () => {
    const { client } = createFakeClient();
    await ensureCanonicalPurchaseCatalog(client);

    expect(client.subscriptionPlan.upsert).toHaveBeenCalledTimes(VERIFIED_BADGE_PLANS.length);
    for (const plan of VERIFIED_BADGE_PLANS) {
      const call = client.subscriptionPlan.upsert.mock.calls.find(
        (c: any[]) => c[0].where.id === plan.id
      );
      expect(call).toBeDefined();
      expect(call[0].create.id).toBe(plan.id);
      expect(call[0].create.price).toBe(plan.priceUSD);
      expect(call[0].create.badgeType).toBe(plan.badgeType);
      expect(call[0].create.durationMonths).toBe(plan.durationMonths);
      expect(call[0].create.isActive).toBe(true);
    }
  });

  it('can skip badge-plan sync (syncBadgePlans:false)', async () => {
    const { client } = createFakeClient();
    await ensureCanonicalPurchaseCatalog(client, { syncBadgePlans: false });

    expect(client.subscriptionPlan.upsert).not.toHaveBeenCalled();
    expect(client.sparkCoinPackage.upsert).toHaveBeenCalledTimes(VANTA_COIN_PACKAGES.length);
  });

  it('is idempotent: running twice upserts the same canonical rows (no duplication)', async () => {
    const { client, upserted } = createFakeClient();

    await ensureCanonicalPurchaseCatalog(client);
    await ensureCanonicalPurchaseCatalog(client);

    // Two runs produce exactly two upsert batches for the same 15 canonical
    // ids — never a row multiplication.
    expect(client.sparkCoinPackage.upsert).toHaveBeenCalledTimes(VANTA_COIN_PACKAGES.length * 2);
    expect(upserted.length).toBe(VANTA_COIN_PACKAGES.length * 2);
    const uniqueIds = new Set(upserted.map((u: any) => u.id));
    expect(uniqueIds.size).toBe(VANTA_COIN_PACKAGES.length);
  });
});