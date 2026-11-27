# Treasury settlement: protected instruction workflow

Admin > Treasury is CEO / SUPER_ADMIN only with existing admin 2FA session enforcement. Instructions are disabled by default. Authorizations and broadcast records require fresh one-time authenticator codes. Destinations are deliberately managed outside the application in protected operator configuration; the admin must confirm the exact configured address. This is a manual custody workflow, not an automatic signer.

## Public treasury destination configuration
- VANTA_TREASURY_BSC_ADDRESS (USDT BEP-20)
- VANTA_TREASURY_BASE_ADDRESS (USDC Base)
- VANTA_TREASURY_ETHEREUM_ADDRESS (ETH / USDT ERC-20)
- VANTA_TREASURY_TRON_ADDRESS (USDT TRC-20)
- VANTA_TREASURY_TON_ADDRESS (native TON asset)
- VANTA_TREASURY_INSTRUCTIONS_ENABLED=true only after custody verification and migration testing.

Verify ownership through the custody provider/hardware wallet and a controlled small transfer before approving destinations. Do not put seed phrases or private keys in source, application DB, chat, or environment variables. Destination updates require protected infrastructure change control, independent review and audit; no in-app destination change is enabled. Invoice receiving addresses must be controlled by the same approved custody arrangement, separate from the main treasury.

## Lifecycle
Verified fulfilled invoices populate the queue from durable payment records. One transfer instruction per invoice. The signed transaction is performed outside VANTA by an approved custodian, recorded with fresh 2FA, then independently checked for EVM stablecoin transfers (recipient, source, official token, exact amount, block and confirmation requirements). No other outgoing rail is marked verified. A submitted hash is never evidence of settlement.

## Remaining production release work
Select and configure a custody/signer provider, verify ownership, design durable idempotent broadcast/outbox and nonce management, gas funding, fee limits, withdrawal policies and emergency halt, independent outbound proof on ETH/TRON/TON, late/partial/multiple deposits, refunds and reconciliation, and end-to-end controlled transfers. For native coins, fees may prevent sweeping the full credited amount; compute policy-approved net amounts before enabling broadcasts. Automatic settlement orchestration is documented separately in shop-treasury-auto-settlement.md; no external signer is connected. Do not activate shop live payments solely because this dashboard builds. Google Play Billing remains deferred.
