-- Extend permanent global claims to withdrawal settlement evidence.
BEGIN;
LOCK TABLE "PurchaseOrder", "VerificationPurchase", "Withdrawal" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "BlockchainPaymentClaim" IN SHARE ROW EXCLUSIVE MODE;
DO $preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM "Withdrawal" WHERE "transactionHash" IS NOT NULL
      AND btrim("transactionHash") !~* '^0x[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'Unrecognized historical withdrawal reference requires reconciliation' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "Withdrawal" WHERE status = 'COMPLETED'
      AND method = 'USDT_BEP20' AND "transactionHash" IS NULL) THEN
    RAISE EXCEPTION 'Completed historical USDT withdrawal lacks settlement evidence' USING ERRCODE = '23514';
  END IF;
END;
$preflight$;
ALTER TABLE "BlockchainPaymentClaim" DROP CONSTRAINT "BlockchainPaymentClaim_family";
ALTER TABLE "BlockchainPaymentClaim" ADD CONSTRAINT "BlockchainPaymentClaim_family"
  CHECK ("family" IN ('coin', 'badge', 'withdrawal'));
-- No source-row rewrite. Any collision aborts the entire migration.
INSERT INTO "BlockchainPaymentClaim" ("txHash", "family", "orderId")
SELECT lower(btrim("transactionHash")), 'withdrawal', id FROM "Withdrawal"
WHERE "transactionHash" IS NOT NULL;

CREATE FUNCTION vanta_reserve_withdrawal_claim() RETURNS trigger
LANGUAGE plpgsql AS $claim$
DECLARE
  canonical TEXT;
  owner_family TEXT;
  owner_order TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."transactionHash" IS NOT NULL AND
       lower(btrim(OLD."transactionHash")) IS DISTINCT FROM lower(btrim(NEW."transactionHash")) THEN
      RAISE EXCEPTION 'Withdrawal settlement reference is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW."transactionHash" IS NULL THEN
    RETURN NEW;
  END IF;
  canonical := lower(btrim(NEW."transactionHash"));
  IF canonical !~ '^0x[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid withdrawal settlement reference' USING ERRCODE = '23514';
  END IF;
  INSERT INTO "BlockchainPaymentClaim" ("txHash", "family", "orderId")
    VALUES (canonical, 'withdrawal', NEW.id) ON CONFLICT ("txHash") DO NOTHING;
  SELECT "family", "orderId" INTO owner_family, owner_order
    FROM "BlockchainPaymentClaim" WHERE "txHash" = canonical;
  IF owner_family IS DISTINCT FROM 'withdrawal' OR owner_order IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'Blockchain payment reference already reserved'
      USING ERRCODE = '23505', CONSTRAINT = 'BlockchainPaymentClaim_pkey';
  END IF;
  NEW."transactionHash" := canonical;
  RETURN NEW;
END;
$claim$;
CREATE TRIGGER vanta_withdrawal_blockchain_claim BEFORE INSERT OR UPDATE OF "transactionHash"
ON "Withdrawal" FOR EACH ROW EXECUTE FUNCTION vanta_reserve_withdrawal_claim();
COMMIT;
