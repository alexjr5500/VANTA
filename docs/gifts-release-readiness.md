# VANTA Gifts — implementation and release-readiness audit

**Reviewed:** 2026-10-22  
**Scope:** Existing gift catalog, VANTA Coins spend path, wallet/creator accounting, live gift events, and Android/Google Play release dependencies.  
**Safety:** This review does not change production configuration, payment providers, coin prices, wallet conversion rules, or database schema.

## Existing implementation

- **Catalog:** the backend database-backed Gift catalog is canonical; the gift store and live gift picker consume the API catalog and render the existing artwork/animation metadata.
- **Send paths:** authenticated REST routes and Socket.IO handlers call the server-side `GiftService.sendGift`. The sender cannot set the gift price or recipient coin share.
- **Price and quantity:** the server uses the Gift row's price multiplied by a validated quantity (1–99). Available funds are `coinBalance - lockedCoins`; frozen wallets and insufficient available balances are rejected.
- **Accounting:** the sender is debited atomically; the receiver gets 70% of the gift's coin value, rounded down to whole coins. The remaining 30% is recorded as the platform share. Wallet ledger entries, gift transaction, stream gift event, and creator daily analytics are written in the transaction.
- **Retry safety:** `requestId` is unique at the database layer. The send path must treat a retry as the same operation only when its financial and attribution payload matches the original transaction.
- **Realtime:** the existing gift event, creator notifications, supporter leaderboard, artwork overlays, and LiveKit stream integrations are preserved by this change.
- **Coin funding:** the repository has a crypto coin-purchase path. Live coin crediting is documented in code as provider-webhook-only, with HMAC validation and replay/idempotency controls; the simulated completion path is intended for non-production only. This PR does not change that payment path.

## Hardening delivered in this branch

1. Reject invalid service-layer quantities instead of silently clamping or truncating them.
2. Check idempotency before catalog availability, so a committed transaction can be retried after its gift is archived.
3. Bind idempotency replay to sender, receiver, gift, stream, quantity, message, and anonymous attribution. A reused key with changed payload is rejected, including the concurrent unique-key race.
4. Validate gift IDs, optional stream IDs, and boolean anonymity flags consistently across REST and the `/gifts` socket handler. Values such as the string `"false"` are not coerced to anonymous=true.
5. Add regression coverage for archived-item retries, changed-payload key reuse, and invalid quantities.

## Google Play / Android release gate

Gifts are in-app digital items bought with VANTA Coins. The coin funding method therefore matters even if the gift itself does not take a direct card payment.

Google Play's published Payments policy says Play Billing is required for in-app purchases of digital goods, including virtual currency, unless an applicable policy exception or enrolled program applies. Its policy also says in-app virtual currencies must be used only within the app title for which they were purchased. See the official [Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738) and [Understanding Google Play's Payments policy](https://support.google.com/googleplay/android-developer/answer/10281818).

The repository currently contains a crypto coin-purchase path, not a verified Play Billing integration. Do **not** assume that web/crypto checkout is permitted inside a Play-distributed Android build. The official billing-choice program is opt-in, requires enrollment and implementation requirements, and is only available in specified markets; Nigeria is not listed in the current published billing-choice market list. See [Enrolling in the billing choice program](https://support.google.com/googleplay/android-developer/answer/17161464).

**Release gate:** before distributing VANTA through Google Play, confirm the exact Android distribution model and payment eligibility. Until Google Play Billing is implemented and server-verified—or VANTA is confirmed eligible, enrolled, and compliant with a relevant alternative-billing program—hide or disable in-app external/crypto coin purchase entry points in the Play-distributed build. Do not hide the gift catalog or earned-coin gifting merely because coin purchasing is gated. Keep the PWA/web checkout behavior separate from the Play build and do not use a client-only flag as the security boundary.

## Still required before production sign-off

- CI must pass for backend tests and frontend build; this branch has not been locally built in this environment.
- Run an end-to-end test with two accounts: buy/fund coins through an approved test provider, send a gift, verify the exact sender debit and 70% receiver credit, and confirm the event appears once in the stream and gift history.
- Test duplicate request IDs, concurrent duplicate sends, insufficient available balance with locked coins, frozen wallets, inactive gifts, anonymous attribution, stream ended/disabled-gift rejection, and notification delivery failure after commit.
- Verify live provider webhook signature/replay handling and ensure production cannot enable simulated coin purchases.
- Complete the Play Billing/market eligibility decision and implement the required distribution-specific feature gate before Play release.

No migration, production database change, payment configuration change, merge, or deployment was performed as part of this audit.
