# VANTA Shop hosted card checkout — isolated test only

The Card option uses Stripe Checkout test sessions for one-time coin and verification purchases, including gifts. The amount and product are server-resolved. The browser receives an official Stripe-hosted test URL, not a simulation token. A return URL alone cannot credit coins or activate a badge. A signed Stripe webhook or an authenticated status check retrieves and validates the session, payment intent and charge. A durable unique session/payment intent mapping protects against duplicate fulfillment.

## Test prerequisites

- Use a separately provisioned non-production database with both the gift and card migrations and seeded canonical purchase catalog.
- Set VANTA_SHOP_SANDBOX_ENABLED=true, VANTA_COIN_PAYMENT_MODE=test, VANTA_SHOP_CARD_TEST_ENABLED=true, and configure a Stripe test secret key and test webhook signing secret in the staging secrets manager. Never put credentials in Git.
- Set APP_PUBLIC_URL to the staging frontend. Configure the Stripe test webhook endpoint /api/payments/shop/stripe/webhook for checkout.session.completed and checkout.session.expired.
- Test self purchases, gifts, custom quantities, canceled sessions, failed cards, forged/duplicate webhooks, mismatched amounts, recovery after reload, concurrent confirmation and expired orders. Verify exact recipient credit and zero bonuses.
- This version intentionally accepts no real card payments. Actual card transactions, chargeback/refund synchronization, delayed settlement reconciliation, recurring billing, native Google Play Billing, and production merchant onboarding remain release blockers. The existing internal refund routines are not a Stripe refund integration.
- The Android shell does not expose this test checkout. Do not treat a user agent as a security boundary or use it to authorize alternative billing. Store billing requires its own integration, catalog and release review.
