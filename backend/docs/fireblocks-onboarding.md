# Fireblocks custody onboarding — selected, not connected

Use the official Developer Sandbox first: https://www.fireblocks.com/developer-sandbox-sign-up. Confirm account eligibility, pricing, and support for the exact VANTA asset contracts in the commercial workspace before contracting. Fireblocks supports the relevant five chains; provider asset IDs are not guessed and testnet assets are not interchangeable with mainnet assets.

## Read-only connection check
Create a Viewer API user in the sandbox. Keep its RSA API authentication key file in a protected operator environment, outside the repository and application runtime; this is not a blockchain wallet private key. Do not share either kind of key in chat. Set FIREBLOCKS_PREFLIGHT_ENV=sandbox, FIREBLOCKS_PREFLIGHT_API_KEY and FIREBLOCKS_PREFLIGHT_KEY_FILE locally, then from backend run:
```sh
npx ts-node --transpile-only scripts/fireblocks-preflight.ts
```
Only GET requests to documented Fireblocks endpoints are allowed. The command cannot sign blockchain transactions, create vaults, set treasury configuration, or submit payments.

## Mainnet address review (after workspace onboarding)
Use a distinct Viewer API user and the correct mainnet region. Supply a local FIREBLOCKS_PREFLIGHT_MAPPING_FILE containing six JSON entries, each with network, assetId (provider asset ID), blockchainId (provider chain UUID), vaultId (Fireblocks vault ID), expectedAddress (public address confirmed by the owner). Use the exact VANTA network IDs: usdt-bep20,usdc-base,usdt-erc20,eth-erc20,usdt-trc20,gram-ton. For each rail verify official asset contract/class, decimals, provider chain identity and the address in the vault. The script checks the first address page and fails closed if no match; provider chain metadata without chain ID requires independent review. It does not prove control of a private key, authorize a transfer or cover an external wallet allowlist. External treasury wallets must instead be verified and whitelisted through the custody workspace. No sandbox addresses may be used in production.

## Controlled transactions and activation
1. Create a dedicated test vault and treasury vault in sandbox; enable supported test assets with provider approval. Confirm actual available testnets; not all six production assets necessarily have corresponding sandbox tokens.
2. Confirm source wallet ownership, destination allowlist, independent per-order/daily limits, native gas balances and fee policy. Disable arbitrary/one-time destinations and raw signing for the settlement identity. Configure the custody co-signer and provider-specific adapter for the VANTA authenticated protocol; the Fireblocks REST API is NOT the VANTA /v1/settlements API. The adapter must enforce all-in fee ceilings before signing and durable externalTxId/idempotency, and never blindly retry ambiguous requests. No adapter deployment is included here.
3. Test a tiny approved amount for each available sandbox rail, then compare the provider transfer record to on-chain source, destination, asset and amount. Record inbound and outbound hashes, network fees, exact credited amount and duplicate/restart tests. Repeat with individually approved minimal mainnet transfers only after the security/custody/financial review, account and address setup, and explicit release authorization. Use only test accounts before then.
4. Keep VANTA_TREASURY_AUTO_ENABLED and VANTA_SHOP_LIVE_CRYPTO_ENABLED disabled until independent review and controlled tests pass. No existing destination has been overwritten.

References: https://fireblocks.readme.io/reference/signing-a-request-jwt-structure, https://fireblocks.readme.io/docs/sweep-funds, https://fireblocks.readme.io/reference/listassets, https://fireblocks.readme.io/reference/getpagedvaultaccounts, https://fireblocks.readme.io/reference/vault-objects.
