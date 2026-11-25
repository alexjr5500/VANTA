# Balance UX audit — PR #311

## Scope and findings
- Balance overview: inconsistent hard-coded black/white surfaces, cramped summary values, clipped large balances, frozen account actions not visually disabled.
- History: first 50 records only; filtered overview; unsuccessful history calls shown as empty; client-side CSV fallback silently exported a subset.
- Security: no real 2FA status or direct PIN settings link; payout address unnecessarily exposed in overview.
- Send: Max ignored the fee; search errors looked like no matches; labels/focus management incomplete; no explicit completion action.
- Withdraw: cramped presets, truncated confirmation address, account-security request race, repeated click risk.
- Dialogs: keyboard focus and reduced motion incomplete, purchase-maintenance language implied a future notification without a subscription.

## Implemented
Slate/gold tokens, larger readable controls, scoped focus indicators, reduced-motion support, dialog focus trapping and restoration, linked form labels, error/status announcements, fee-aware transfer maximum, duplicate submission guards, confirmation screens, payout address and amount validation mirroring existing server rules, pagination and truthful loaded-record search, explicit export failure, real 2FA status and settings links.

No changes to backend authorization, transfer fees, balances, PIN/OTP/2FA requirements, withdrawal minimum, settlement or purchase availability as part of this Balance pass.

## Release acceptance (not yet executed)
- Check 320, 360, 390 and 480 CSS-pixel viewports; long usernames, large balances, keyboard open and enlarged text.
- Keyboard/screen reader: tab cycle, Escape, focus restoration, error and completion announcements; reduced motion.
- History: empty/error/filter/no-match states, >50 records, duplicate-free pagination, CSV export and documented server cap (10,000 records). Search is over loaded records.
- Transfer: recipient @ search, offline retry, self-transfer disabled, Max includes fee, review and OTP/2FA challenges, duplicate clicks, confirmation after server success. Use test accounts only.
- Withdraw: minimum and decimal validation, full BEP-20 address, 2FA loading/failure, review and completion; no live financial transfer.
- Verify preview build, full CI and mobile runtime; preserve previous Status upload acceptance gates.
