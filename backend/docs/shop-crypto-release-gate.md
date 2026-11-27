# VANTA Shop crypto release gate

This branch does not enable production checkout. Existing shared receiving-wallet routes and the old amount/time matching watcher remain disabled. No purchase bonus is added.

The new checkout uses one permanently reserved deposit address per invoice, exact token atomic units, canonical chain block and invoice time checks, persisted scan progress, server-confirmed fulfillment and a payer-scoped recovery API. USDT BNB Smart Chain, USDC Base, USDT Ethereum ERC-20 and native ETH on Ethereum are implemented, behind separate opt-ins. The address pool is not a treasury change; it must consist of fresh, operator-controlled receiving addresses with an approved custody and sweep/reconciliation process.

## Before enabling

- Apply the new database migration on isolated staging and verify concurrent allocation, ownership checks, replay rejection, exact crediting and bad-network/wrong-token/wrong-address rejection.
- Confirm ownership and secure custody of every fresh deposit address. Never paste private keys or seed phrases into the repository or configuration.
- Provision the public addresses in `VANTA_SHOP_CRYPTO_DEPOSIT_ADDRESSES` only after that confirmation. Never remove addresses while invoices are outstanding, recycle an address, delete invoice reservations or restore a database without reconciling all historical reservations. Capacity is finite; production-scale address provisioning and fund sweeping are not implemented.
- Configure dedicated BSC/Base RPC providers and review confirmation/finality thresholds. The monitor uses at least 12 confirmations. Validate network support and fee handling on physical devices and wallets.
- Establish manual reconciliation/refund procedures for underpayments, overpayments, wrong networks, extra transfers, late confirmations, provider outages and pool exhaustion. Closed or expired orders do not auto-credit; they require operator reconciliation. A QR code is never evidence of payment.
- Keep the live flag off until reviewed end-to-end with controlled transactions and legal/store payment requirements checked. `VANTA_SHOP_LIVE_CRYPTO_ENABLED=true` explicitly opens the new live self-purchase route if valid public deposit addresses are configured and payment mode is live. Do not set it on production merely to preview the UI.
- Live gifts, additional networks, hosted card checkout, recurring billing, coin-funded badge purchases and Android Play Billing are outside this change and remain blocked until separately implemented and verified.

A sandbox can still exercise no-bonus gift and self-purchase confirmation using isolated non-production data and the existing sandbox flags.

## Ethereum expansion
- `VANTA_ETHEREUM_RPC_URL`: explicit trusted HTTPS Ethereum mainnet RPC with finalized-block support, configured before server startup.
- `VANTA_SHOP_ERC20_ENABLED=true`: enable USDT ERC-20 in the dedicated invoice flow only. Contract 0xdac17f958d2ee523a2206206994597c13d831ec7, 6 decimals (Tether supported protocols).
- `VANTA_SHOP_NATIVE_ETH_ENABLED=true`: enable native ETH only after review of price-feed and custody risk. Uses the Ethereum mainnet Chainlink ETH/USD feed, verifies 8 decimals and fresh positive round data, saves exact wei quote and rejects stale or invalid prices. EIP-681 native payment URI carries the exact wei amount.
- Both Ethereum rails require finalized blocks and independent receipt verification. Native ETH discovery scans bounded finalized blocks for direct transfers; contract-internal transfers and batch transfers are not supported. Ethereum finality can arrive after the 30-minute order window; operators must reconcile these payments without automatically treating them as successful. Gas is paid separately.
- Use unique custody-controlled receiving addresses, never reuse them, and test real wallets on an isolated controlled environment before enabling either flag. Rate, quote expiry, finality, throughput, provider outage, underpayments and fund sweeping require operational validation. No production settings were changed.
- TRON TRC-20 and TON/GRAM remain disabled; they need separate address formats, chain identity checks, finalized transaction validation, QR/deep links and custody. Google Play Billing remains deferred.

## TRON USDT
Set `VANTA_SHOP_TRC20_ENABLED=true` and `VANTA_SHOP_TRON_DEPOSIT_ADDRESSES` to fresh custody-controlled Base58Check public addresses after staging validation. Optional `VANTA_TRONGRID_API_KEY` is stored only in server secrets. The provider is fixed to official mainnet TronGrid. The official Tether TRC-20 contract is verified using solidified transaction body, receipt, exact six-decimal transfer event, and solidified block inclusion. Indexer history is only used to discover candidate hashes. The QR contains the address; users must manually enter the displayed exact amount in a TRON wallet. Direct wallet transfer calls only; unsupported batches, excess transfers, late transfers and outages require reconciliation. No new production configuration was applied. Native GRAM on TON remains disabled pending its separate verified quote and finality integration. See https://tether.to/en/supported-protocols/ and https://developers.tron.network/docs/confirmation-semantics.
