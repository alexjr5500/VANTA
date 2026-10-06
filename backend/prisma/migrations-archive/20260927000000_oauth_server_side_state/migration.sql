-- ============================================================================
-- VANTA — server-side OAuth `state` (short opaque state for Telegram/Google)
-- ============================================================================
-- The provider authorization URL only ever carries a SHORT opaque state id
-- (16 random bytes -> ~22 base64url chars). The full OAuth payload — CSRF
-- nonce, PKCE code_verifier (Telegram), post-login redirect path and optional
-- linking user — lives here server-side, so Telegram's authorization request
-- never exceeds its `state` length limit while CSRF/replay protection stays
-- intact. Records are short-lived and single-use: `consumedAt` is set exactly
-- once by the callback, and any replay / expired / unknown state is rejected.
--
-- SAFETY: purely additive and non-destructive (new table only).
-- ============================================================================

CREATE TABLE "OAuthState" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "redirect" TEXT NOT NULL,
    "codeVerifier" TEXT,
    "linkingUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OAuthState_expiresAt_idx" ON "OAuthState"("expiresAt");
CREATE INDEX "OAuthState_provider_idx" ON "OAuthState"("provider");
CREATE INDEX "OAuthState_consumedAt_idx" ON "OAuthState"("consumedAt");