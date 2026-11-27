# VANTA Shop crypto release gate

This branch does not enable production checkout. Existing shared receiving-wallet routes and the old amount/time matching watcher remain disabled. No purchase bonus is added.

The new checkout uses one permanently reserved deposit address per invoice, exact token atomic units, canonical chain block and invoice time checks, persisted scan progress, server-confirmed fulfillment and a payer-scoped recovery API. USDT BNB Smart Chain and USDC Base are the currently implemented networks. The address pool is not a treasury change; it must consist of fresh, operator-controlled receiving addresses with an approved custody and sweep/reconciliation process.

## Before enabling

- Apply the new database migration on isolated staging and verify concurrent allocation, ownership checks, replay rejection, exact crediting and bad-network/wrong-token/wrong-address rejection.
- Confirm ownership and secure custody of every fresh deposit address. Never paste private keys or seed phrases into the repository or configuration.
- Provision the public addresses in `VANTA_SHOP_CRYPTO_DEPOSIT_ADDRESSES` only after that confirmation. Never remove addresses while invoices are outstanding, recycle an address, delete invoice reservations or restore a database without reconciling all historical reservations. Capacity is finite; production-scale address provisioning and fund sweeping are not implemented.
- Configure dedicated BSC/Base RPC providers and review confirmation/finality thresholds. The monitor uses at least 12 confirmations. Validate network support and fee handling on physical devices and wallets.
- Establish manual reconciliation/refund procedures for underpayments, overpayments, wrong networks, extra transfers, late confirmations, provider outages and pool exhaustion. Closed or expired orders do not auto-credit; they require operator reconciliation. A QR code is never evidence of payment.
- Keep the live flag off until reviewed end-to-end with controlled transactions and legal/store payment requirements checked. `VANTA_SHOP_LIVE_CRYPTO_ENABLED=true` explicitly opens the new live self-purchase route if valid public deposit addresses are configured and payment mode is live. Do not set it on production merely to preview the UI.
- Live gifts, additional networks, hosted card checkout, recurring billing, coin-funded badge purchases and Android Play Billing are outside this change and remain blocked until separately implemented and verified.

A sandbox can still exercise no-bonus gift and self-purchase confirmation using isolated non-production data and the existing sandbox flags.
