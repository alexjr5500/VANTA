# Withdrawal recovery runbook

Scope: manual settlement, not an automated provider. Use an authorized admin session with verified 2FA. Do not send, re-send, refund or release a reserved payout based on these notes.

1. Open Admin Finance, Active / unresolved. Refresh the queue. Record the withdrawal ID, current status, amount, destination and network; compare with the reservation and exact pending ledger. An unexpected ledger count requires escalation.
2. Reconcile the treasury/provider records and approved operator's handoff. Check the relevant time range, provider request identifiers, and any independently available settlement evidence. Do not infer absence from an explorer search or a timeout. Do not put credentials or private keys in a case note.
3. Record a recovery review with an incident/ticket reference, reported outcome and evidence sources/time range. Candidate hashes are unverified. If the evidence is insufficient, record UNKNOWN and retain the reservation.
4. If a reserved payout has independently corroborated settlement evidence, use the existing verify-settlement operation, which validates the chain transfer and claims its hash transactionally. If verification fails, leave the request reserved. A failed attempt does not authorize another transfer.
5. Legacy PROCESSING/APPROVED, missing ledger, conflicting references, reported failure, and no payout located all require escalation to finance/security review. No release or refund override is provided. An independent provider-specific proof-of-nonexecution and reviewed recovery policy are prerequisites for such a transition.
6. After a lost response, refresh the recovery history and main queue; never automatically retry a mutation. Record follow-up case evidence separately. Preserve the audit trail under the applicable retention policy.

No funds are moved by the recovery review. A note is not independent proof, and the current audit table is not a tamper-proof external evidence store. Production release requires runtime acceptance, retention review and provider-specific reconciliation/recovery procedures.
