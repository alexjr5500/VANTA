-- Conservative global EVM transaction fence across coin and badge products.
-- Historical conflicts must stop this migration for manual reconciliation.
BEGIN;
LOCK TABLE "PurchaseOrder", "VerificationPurchase" IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE "BlockchainPaymentClaim" (
  "txHash" TEXT NOT NULL PRIMARY KEY,
  "family" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BlockchainPaymentClaim_hash_format" CHECK ("txHash" ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT "BlockchainPaymentClaim_family" CHECK ("family" IN ('coin', 'badge'))
);

-- Reserve all historical canonical references, including refunded orders.
-- DISTINCT collapses two references from the same order only. A cross-order
-- collision raises unique_violation; the transaction rolls back without edits.
INSERT INTO "BlockchainPaymentClaim" ("txHash", "family", "orderId")
SELECT DISTINCT hash, family, id FROM (
  SELECT lower(substring("providerOrderId" from 6)) AS hash, 'coin' AS family, id
  FROM "PurchaseOrder" WHERE "providerOrderId" ~* '^live:0x[0-9a-f]{64}$'
  UNION ALL
  SELECT lower("providerReference"), 'coin', id FROM "PurchaseOrder"
  WHERE "paymentMode" = 'live' AND "providerReference" ~* '^0x[0-9a-f]{64}$'
  UNION ALL
  SELECT lower(substring("providerOrderId" from 6)), 'badge', id
  FROM "VerificationPurchase" WHERE "providerOrderId" ~* '^live:0x[0-9a-f]{64}$'
  UNION ALL
  SELECT lower("providerReference"), 'badge', id FROM "VerificationPurchase"
  WHERE "paymentMode" = 'live' AND "providerReference" ~* '^0x[0-9a-f]{64}$'
) AS historical;

CREATE FUNCTION vanta_reserve_blockchain_payment() RETURNS trigger
LANGUAGE plpgsql AS $claim$
DECLARE
  canonical TEXT;
  owner_family TEXT;
  owner_order TEXT;
BEGIN
  IF NEW."providerOrderId" ~* '^live:0x[0-9a-f]{64}$' THEN
    canonical := lower(substring(NEW."providerOrderId" from 6));
  ELSIF NEW."paymentMode" = 'live' AND NEW."providerReference" ~* '^0x[0-9a-f]{64}$' THEN
    canonical := lower(NEW."providerReference");
  ELSE
    RETURN NEW;
  END IF;
  IF NEW."paymentMode" = 'live' AND NEW."providerReference" ~* '^0x[0-9a-f]{64}$'
    AND lower(NEW."providerReference") <> canonical THEN
    RAISE EXCEPTION 'Conflicting blockchain payment references' USING ERRCODE = '23514';
  END IF;
  INSERT INTO "BlockchainPaymentClaim" ("txHash", "family", "orderId")
    VALUES (canonical, TG_ARGV[0], NEW.id)
    ON CONFLICT ("txHash") DO NOTHING;
  SELECT "family", "orderId" INTO owner_family, owner_order
    FROM "BlockchainPaymentClaim" WHERE "txHash" = canonical;
  IF owner_family IS DISTINCT FROM TG_ARGV[0] OR owner_order IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'Blockchain payment reference already reserved'
      USING ERRCODE = '23505', CONSTRAINT = 'BlockchainPaymentClaim_pkey';
  END IF;
  RETURN NEW;
END;
$claim$;

CREATE TRIGGER vanta_coin_blockchain_claim BEFORE INSERT OR UPDATE OF "providerOrderId", "providerReference", "paymentMode"
ON "PurchaseOrder" FOR EACH ROW EXECUTE FUNCTION vanta_reserve_blockchain_payment('coin');
CREATE TRIGGER vanta_badge_blockchain_claim BEFORE INSERT OR UPDATE OF "providerOrderId", "providerReference", "paymentMode"
ON "VerificationPurchase" FOR EACH ROW EXECUTE FUNCTION vanta_reserve_blockchain_payment('badge');
COMMIT;
