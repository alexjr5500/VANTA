-- Run with an explicitly selected database connection. Aggregate only; no row identifiers.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
WITH refs AS (
  SELECT lower(btrim("transactionHash")) AS hash, id FROM "Withdrawal"
  WHERE btrim("transactionHash") ~* '^0x[0-9a-f]{64}$'
), duplicate_refs AS (
  SELECT hash FROM refs GROUP BY hash HAVING count(*) > 1
)
SELECT
 (SELECT count(*) FROM "Withdrawal") AS total_withdrawals,
 (SELECT count(*) FROM "Withdrawal" WHERE status IN ('PENDING','PROCESSING','APPROVED','PAYOUT_RESERVED')) AS unresolved,
 (SELECT count(*) FROM "Withdrawal" WHERE "transactionHash" IS NOT NULL AND btrim("transactionHash") !~* '^0x[0-9a-f]{64}$') AS invalid_references,
 (SELECT count(*) FROM "Withdrawal" WHERE status='COMPLETED' AND method='USDT_BEP20' AND "transactionHash" IS NULL) AS completed_missing_hash,
 (SELECT count(*) FROM duplicate_refs) AS duplicate_hashes,
 (SELECT count(*) FROM refs r JOIN "BlockchainPaymentClaim" c ON c."txHash"=r.hash
  WHERE c.family <> 'withdrawal' OR c."orderId" <> r.id) AS conflicting_registry_owners;
ROLLBACK;
