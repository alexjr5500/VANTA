import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma';
import { sessionManager, SecurityValidator, auditLog, config } from '../security';
import { welcomeRewardService } from './welcome-reward.service';
import { Request } from 'express';

// ============================================================================
// VANTA OAuth / OIDC provider authentication (Google + Telegram).
//
// Both providers use the standard Authorization Code flow executed entirely
// server-side:
//
//   1. GET /api/auth/oauth/authorize/:provider  -> 302 to the provider.
//   2. Provider redirects back to /api/auth/oauth/callback/:provider with a
//      code (+ state). The state JWT (signed, short-lived) binds the session
//      to the CSRF nonce, PKCE verifier (Telegram) and the post-login path.
//   3. The backend exchanges the code (client secret stays server-side) and
//      cryptographically verifies the ID token (iss/aud/exp + signature via
//      the provider JWKS). The verified `sub` claim is the only identity key.
//   4. Linked identity -> real VANTA session + one-time exchange code.
//      New identity -> signed registration ticket consumed by the existing
//      register screen (username onboarding). No account is created until the
//      user completes that screen, so an abandoned signup cannot lock out a
//      provider identity and no incomplete user records are ever created.
//
// The generated session is the same Session row the normal email/password
// login produces (sessionManager), so logout, refresh, protected routes, and
// session management behave identically.
// ============================================================================

export const OAUTH_PROVIDERS = ['google', 'telegram'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export interface VerifiedIdentity {
  provider: OAuthProvider;
  /** Provider-assigned unique account identifier (Google `sub` / Telegram `sub`). */
  providerAccountId: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  avatarUrl?: string;
  /** Telegram username only — metadata, never an identity key. */
  username?: string;
  /** Provider-verified phone (Telegram `openid profile phone` scope). */
  phoneNumber?: string;
}

export interface OAuthState {
  type: 'oauth-state';
  nonce: string;
  provider: OAuthProvider;
  redirect: string;
  codeVerifier?: string;
  linkingUserId?: string;
}

export interface OAuthRegistrationTicket {
  type: 'oauth-register';
  provider: OAuthProvider;
  providerAccountId: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  avatarUrl?: string;
  phoneNumber?: string;
  redirect: string;
}

/** User-safe error with a stable code mapped to a message on the client. */
export class OAuthError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message || code);
    this.code = code;
  }
}

export class OAuthConfigError extends OAuthError {
  provider: OAuthProvider;
  constructor(provider: OAuthProvider, code = 'not-configured') {
    super(code, `OAuth provider "${provider}" is not configured`);
    this.provider = provider;
  }
}

const envStr = (key: string, fallback = ''): string => {
  const value = process.env[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
};

const envSeconds = (key: string, fallback: number, max: number): number => {
  const raw = Number(envStr(key, String(fallback)));
  const value = Number.isFinite(raw) && raw > 0 ? raw : fallback;
  return Math.min(value, max);
};
export const frontendBaseUrl = (): string => {
  const configured = envStr('FRONTEND_URL');
  return configured && !configured.startsWith('//') ? configured.replace(/\/+$/, '') : 'http://localhost:3000';
};

export const backendPublicBaseUrl = (): string => {
  const configured = envStr('BACKEND_PUBLIC_URL') || envStr('BACKEND_URL');
  return (configured || 'http://localhost:5000').replace(/\/+$/, '');
};

export const providerClientConfig = (provider: OAuthProvider): { clientId: string; clientSecret: string; redirectUri: string } => {
  let resolved: { clientId: string; clientSecret: string; redirectUri: string };
  if (provider === 'google') {
    resolved = {
      clientId: envStr('GOOGLE_CLIENT_ID'),
      clientSecret: envStr('GOOGLE_CLIENT_SECRET'),
      redirectUri: envStr('GOOGLE_OAUTH_REDIRECT_URI') || `${backendPublicBaseUrl()}/api/auth/oauth/callback/google`,
    };
  } else if (provider === 'telegram') {
    resolved = {
      clientId: envStr('TELEGRAM_BOT_ID'),
      clientSecret: envStr('TELEGRAM_BOT_SECRET'),
      redirectUri: envStr('TELEGRAM_OAUTH_REDIRECT_URI') || `${backendPublicBaseUrl()}/api/auth/oauth/callback/telegram`,
    };
  } else {
    throw new OAuthConfigError(provider);
  }
  if (!resolved.clientId || !resolved.clientSecret || !resolved.redirectUri) {
    throw new OAuthConfigError(provider);
  }
  return resolved;
};

export const oauthProviderStatus = (provider: OAuthProvider): { provider: OAuthProvider; configured: boolean } => {
  let configured = false;
  try {
    const resolved = providerClientConfig(provider);
    configured = Boolean(resolved.clientId && resolved.clientSecret && resolved.redirectUri);
  } catch {
    configured = false;
  }
  return { provider, configured };
};

const registrationTicketTtlSeconds = () => envSeconds('OAUTH_REGISTRATION_TICKET_TTL_SECONDS', 900, 3600);
const exchangeCodeTtlSeconds = () => envSeconds('OAUTH_EXCHANGE_CODE_TTL_SECONDS', 300, 900);
const stateTtlSeconds = () => envSeconds('OAUTH_STATE_TTL_SECONDS', 600, 1800);

const jwtSecret = (): string => {
  const secret = envStr('JWT_SECRET');
  if (!secret) throw new OAuthError('server-configuration', 'JWT_SECRET is not configured');
  return secret;
};

/**
 * Only allow same-app absolute paths (starting with a single `/`). Rejects
 * `//host`, backslashes, whitespace and absolute URLs.
 */
export const safeFrontendPath = (value: unknown): string => {
  const raw = typeof value === 'string' ? value : '';
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/reels';
  if (/[\u0000-\u0020\\]/.test(raw)) return '/reels';
  return raw;
};

const base64UrlEncode = (buffer: Buffer | Uint8Array): string =>
  Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const randomHex = (bytes: number): string => crypto.randomBytes(bytes).toString('hex');

const randomBase64Url = (bytes: number): string => base64UrlEncode(crypto.randomBytes(bytes));

const sha256 = (input: string): Buffer => crypto.createHash('sha256').update(input).digest();

export const generatePkceVerifier = (): string => randomBase64Url(32);

export const generatePkceChallenge = (verifier: string): string => base64UrlEncode(sha256(verifier));

export const issueOAuthState = (payload: Omit<OAuthState, 'type'>): string =>
  jwt.sign({ ...payload, type: 'oauth-state' }, jwtSecret(), { expiresIn: `${stateTtlSeconds()}s` });

export const verifyOAuthState = (raw: string, provider: OAuthProvider): OAuthState => {
  let decoded: Partial<OAuthState>;
  try {
    decoded = jwt.verify(raw, jwtSecret()) as Partial<OAuthState>;
  } catch {
    // Never surface raw JWT verification errors to the client.
    throw new OAuthError('invalid-state', 'The sign-in request could not be verified. Please try again.');
  }
  if (!decoded || decoded.type !== 'oauth-state') {
    throw new OAuthError('invalid-state', 'The sign-in request could not be verified. Please try again.');
  }
  if (decoded.provider !== provider) {
    throw new OAuthError('invalid-state', 'The sign-in request could not be verified. Please try again.');
  }
  return decoded as OAuthState;
};
const GOOGLE_ISSUERS: [string, ...string[]] = ['https://accounts.google.com', 'accounts.google.com'];
const TELEGRAM_ISSUER = 'https://oauth.telegram.org';

const jwksForProvider = (provider: OAuthProvider): string =>
  provider === 'google'
    ? 'https://www.googleapis.com/oauth2/v3/certs'
    : 'https://oauth.telegram.org/.well-known/jwks.json';

const tokenEndpointForProvider = (provider: OAuthProvider): string =>
  provider === 'google' ? 'https://oauth2.googleapis.com/token' : 'https://oauth.telegram.org/token';

const authorizeEndpointForProvider = (provider: OAuthProvider): string =>
  provider === 'google' ? 'https://accounts.google.com/o/oauth2/v2/auth' : 'https://oauth.telegram.org/auth';

/** JWKS keys are cached briefly to avoid a network round-trip per login. */
let jwksCache: { provider: OAuthProvider; fetchedAt: number; keys: Array<Record<string, unknown>> }[] = [];

const fetchProviderJwks = async (provider: OAuthProvider): Promise<Array<Record<string, unknown>>> => {
  const cached = jwksCache.find((entry) => entry.provider === provider);
  if (cached && Date.now() - cached.fetchedAt < 60_000) {
    return cached.keys;
  }
  const response = await fetch(jwksForProvider(provider), {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new OAuthError('provider-unavailable', 'The sign-in provider could not be reached. Please try again.');
  }
  const payload = (await response.json()) as { keys?: Array<Record<string, unknown>> };
  const keys = Array.isArray(payload?.keys) ? payload.keys : [];
  if (keys.length === 0) {
    throw new OAuthError('provider-unavailable', 'The sign-in provider could not be verified. Please try again.');
  }
  jwksCache = jwksCache.filter((entry) => entry.provider !== provider);
  jwksCache.push({ provider, fetchedAt: Date.now(), keys });
  return keys;
};

/** Build a `crypto.KeyObject` from a JWK so jsonwebtoken can verify RS256/ES256. */
const publicKeyFromJwk = (jwk: Record<string, unknown>): crypto.KeyObject => {
  const kty = String(jwk.kty || '');
  if (kty === 'RSA') {
    return crypto.createPublicKey({ key: { kty: 'RSA', n: String(jwk.n), e: String(jwk.e) }, format: 'jwk' });
  }
  if (kty === 'EC') {
    return crypto.createPublicKey({
      key: { kty: 'EC', crv: String(jwk.crv), x: String(jwk.x), y: String(jwk.y) },
      format: 'jwk',
    });
  }
  throw new OAuthError('invalid-id-token', 'The sign-in provider returned an unsupported key type.');
};

const decodeJwtHeader = (token: string): { alg?: string; kid?: string } => {
  const parts = token.split('.');
  if (parts.length !== 3) throw new OAuthError('invalid-id-token', 'The sign-in result could not be verified.');
  try {
    const header = JSON.parse(Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return { alg: typeof header.alg === 'string' ? header.alg : undefined, kid: typeof header.kid === 'string' ? header.kid : undefined };
  } catch {
    throw new OAuthError('invalid-id-token', 'The sign-in result could not be verified.');
  }
};
/**
 * Cryptographically verify a provider ID token:
 *   - signature against the provider's published JWKS (RS256 or ES256 only),
 *   - `iss` and `aud`, and
 *   - `exp` (jsonwebtoken rejects expired tokens) with a small clock tolerance.
 *
 * Returns the verified claims. Nothing from the frontend/URL is trusted; the
 * identity is established exclusively from this verified payload.
 */
export const verifyProviderIdToken = async (
  provider: OAuthProvider,
  idToken: string,
  expectedAudience: string,
  expectedNonce?: string
): Promise<Record<string, unknown>> => {
  if (typeof idToken !== 'string' || !idToken) {
    throw new OAuthError('invalid-id-token', 'The sign-in result could not be verified.');
  }
  const header = decodeJwtHeader(idToken);
  const algorithm = header.alg || 'RS256';
  if (algorithm !== 'RS256' && algorithm !== 'ES256') {
    throw new OAuthError('invalid-id-token', 'The sign-in result used an unsupported signing algorithm.');
  }
  const keys = await fetchProviderJwks(provider);
  const jwk = keys.find((key) => !header.kid || String(key.kid || '') === header.kid) || keys[0];
  if (!jwk) throw new OAuthError('invalid-id-token', 'The sign-in result could not be verified.');

  let decoded: Record<string, unknown>;
  try {
    const publicKey = publicKeyFromJwk(jwk);
    decoded = jwt.verify(idToken, publicKey, {
      algorithms: [algorithm],
      issuer: provider === 'google' ? GOOGLE_ISSUERS : TELEGRAM_ISSUER,
      audience: expectedAudience,
      clockTolerance: 30,
    }) as Record<string, unknown>;
  } catch (error) {
    // Never leak verification details (e.g. "jwt expired") to the user.
    throw new OAuthError('invalid-id-token', 'The sign-in result could not be verified.');
  }

  if (!decoded || typeof decoded.sub !== 'string' || !decoded.sub) {
    throw new OAuthError('invalid-id-token', 'The sign-in result did not include a verified account identifier.');
  }
  if (expectedNonce && typeof decoded.nonce === 'string' && decoded.nonce !== expectedNonce) {
    throw new OAuthError('invalid-id-token', 'The sign-in result could not be verified.');
  }
  return decoded;
};

const identityFromClaims = (provider: OAuthProvider, claims: Record<string, unknown>): VerifiedIdentity => {
  const email = typeof claims.email === 'string' && claims.email.includes('@') ? String(claims.email).trim().toLowerCase() : undefined;
  return {
    provider,
    providerAccountId: String(claims.sub),
    email,
    emailVerified: provider === 'google' ? claims.email_verified === true || claims.email_verified === 'true' : false,
    name: typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : typeof claims.given_name === 'string' ? String(claims.given_name) : undefined,
    avatarUrl: typeof claims.picture === 'string' && claims.picture ? claims.picture : undefined,
    username: provider === 'telegram' && typeof claims.preferred_username === 'string' ? claims.preferred_username : undefined,
    phoneNumber: typeof claims.phone_number === 'string' && claims.phone_number ? claims.phone_number : undefined,
  };
};
export const buildAuthorizeRequest = (provider: OAuthProvider, redirectUnknown: unknown, linkingUserId?: string) => {
  const { clientId, redirectUri } = providerClientConfig(provider);
  const redirect = safeFrontendPath(redirectUnknown);
  const nonce = randomHex(16);

  if (provider === 'google') {
    const state = issueOAuthState({ nonce, provider: 'google', redirect, linkingUserId });
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      access_type: 'online',
      prompt: 'select_account',
    });
    return { authorizeUrl: `${authorizeEndpointForProvider('google')}?${query}`, state, nonce };
  }

  // Telegram requires PKCE (S256).
  const codeVerifier = generatePkceVerifier();
  const state = issueOAuthState({ nonce, provider: 'telegram', redirect, codeVerifier, linkingUserId });
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid profile phone',
    state,
    code_challenge: generatePkceChallenge(codeVerifier),
    code_challenge_method: 'S256',
  });
  return { authorizeUrl: `${authorizeEndpointForProvider('telegram')}?${query}`, state, nonce };
};

const exchangeAuthorizationCode = async (provider: OAuthProvider, code: string, codeVerifier: string | undefined) => {
  const { clientId, clientSecret, redirectUri } = providerClientConfig(provider);
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
  });
  if (codeVerifier) params.set('code_verifier', codeVerifier);

  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (provider === 'telegram') {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  } else {
    params.set('client_secret', clientSecret);
  }

  let response: Response;
  try {
    response = await fetch(tokenEndpointForProvider(provider), {
      method: 'POST',
      headers,
      body: params.toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new OAuthError('provider-unavailable', 'The sign-in provider could not be reached. Please try again.');
  }
  const payload = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok || typeof payload.id_token !== 'string' || !payload.id_token) {
    throw new OAuthError('login-failed', 'The sign-in could not be completed. Please try again.');
  }
  return String(payload.id_token);
};
// ============================================================================
// VANTA session creation + one-time exchange codes
// ============================================================================

const accessTokenExpiresInSeconds = (): number => {
  const raw = String(config.jwt.accessToken.expiresIn);
  const match = raw.match(/^(\d+)([dhms])$/);
  if (!match) return 900;
  const value = Number(match[1]);
  const unit = match[2];
  if (unit === 'd') return value * 86400;
  if (unit === 'h') return value * 3600;
  if (unit === 'm') return value * 60;
  return value;
};

/**
 * Create the same Session the normal login flow creates (sessionManager) and
 * attach a single-use exchange code so the frontend can retrieve the token
 * pair over a POST body — never via a redirect URL.
 */
export const createVantaSessionAndExchangeCode = async (
  user: { id: string; role: string },
  provider: OAuthProvider,
  req: Request
): Promise<{ exchangeCode: string; tokenPair: { accessToken: string; refreshToken: string } }> => {
  const userAgent = req.headers['user-agent']?.toString();
  const ipAddress = req.ip || req.socket.remoteAddress;
  const deviceFingerprint = (req as any).deviceFingerprint;

  const tokenPair = sessionManager.generateTokenPair(user.id, user.role, '');
  const session = await sessionManager.createSession(
    user.id, tokenPair.accessToken, tokenPair.refreshToken, userAgent, ipAddress, deviceFingerprint
  );
  const finalPair = sessionManager.generateTokenPair(user.id, user.role, session.id);
  const exchangeCode = randomBase64Url(32);
  const ttl = exchangeCodeTtlSeconds();

  await prisma.session.update({
    where: { id: session.id },
    data: {
      token: finalPair.accessToken,
      refreshToken: finalPair.refreshToken,
      oauthExchangeCode: exchangeCode,
      oauthExchangeExpiresAt: new Date(Date.now() + ttl * 1000),
    },
  });

  await auditLog.log({
    userId: user.id,
    action: 'OAUTH_LOGIN_SUCCESS',
    ipAddress,
    userAgent,
    metadata: { provider },
    severity: 'INFO',
  });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  return { exchangeCode, tokenPair: { accessToken: finalPair.accessToken, refreshToken: finalPair.refreshToken } };
};

export const redeemExchangeCode = async (code: unknown, req: Request) => {
  if (typeof code !== 'string' || !code) {
    throw new OAuthError('invalid-code', 'This sign-in link is invalid. Please try again.');
  }
  const session = await prisma.session.findUnique({ where: { oauthExchangeCode: code } });
  if (!session || !session.oauthExchangeExpiresAt || session.oauthExchangeExpiresAt < new Date() || !session.token) {
    throw new OAuthError('expired-code', 'This sign-in link has expired. Please try again.');
  }
  // Single use: redeem immediately nulls the code so it can never be replayed.
  await prisma.session.update({
    where: { id: session.id },
    data: { oauthExchangeCode: null, oauthExchangeExpiresAt: null },
  });

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: {
      profile: true,
      wallet: { select: { coinBalance: true, earningsBalance: true } },
      userSettings: true,
      notificationPrefs: true,
    },
  });
  if (!user) {
    throw new OAuthError('user-missing', 'This account is no longer available. Please try again.');
  }
  if (user.status !== 'ACTIVE') {
    throw new OAuthError('account-restricted', user.status === 'SUSPENDED' ? 'Account suspended' : 'Account restricted');
  }

  return {
    user: sanitizeUserShape(user),
    token: session.token,
    refreshToken: session.refreshToken,
    expiresIn: accessTokenExpiresInSeconds(),
  };
};

export const sanitizeUserShape = (user: any) => ({
  id: user.id,
  email: user.email,
  username: user.username,
  fullName: user.fullName,
  avatar: user.avatar || user.profile?.avatarUrl,
  role: user.role,
  verified: user.verified,
  emailVerified: user.emailVerified,
  premium: user.premium,
  twoFactorEnabled: user.twoFactorEnabled,
  coins: user.coins || user.wallet?.coinBalance || 0,
  earnings: user.earnings || user.wallet?.earningsBalance || 0,
  createdAt: user.createdAt,
  settings: user.userSettings,
  notifications: user.notificationPrefs,
});
// ============================================================================
// Provider callback handling
// ============================================================================

export interface OAuthCallbackResult {
  kind: 'linked' | 'new' | 'existing-account';
  provider: OAuthProvider;
  redirectPath: string;
  exchangeCode?: string;
  registrationTicket?: string;
  email?: string;
  name?: string;
  linkedToLinkingUserId?: boolean;
}

const issueRegistrationTicket = (identity: VerifiedIdentity, redirect: string): string =>
  jwt.sign(
    {
      type: 'oauth-register',
      provider: identity.provider,
      providerAccountId: identity.providerAccountId,
      email: identity.email,
      emailVerified: identity.emailVerified,
      name: identity.name,
      avatarUrl: identity.avatarUrl,
      phoneNumber: identity.phoneNumber,
      redirect,
    },
    jwtSecret(),
    { expiresIn: `${registrationTicketTtlSeconds()}s` }
  );

export const verifyRegistrationTicket = (raw: string): OAuthRegistrationTicket => {
  let decoded: Partial<OAuthRegistrationTicket>;
  try {
    decoded = jwt.verify(raw, jwtSecret()) as Partial<OAuthRegistrationTicket>;
  } catch {
    // Never surface raw JWT verification errors to the client.
    throw new OAuthError('invalid-ticket', 'This sign-up link is invalid or has expired. Please try again.');
  }
  if (!decoded || decoded.type !== 'oauth-register' || !decoded.provider || !decoded.providerAccountId) {
    throw new OAuthError('invalid-ticket', 'This sign-up link is invalid or has expired. Please try again.');
  }
  if (!OAUTH_PROVIDERS.includes(decoded.provider as OAuthProvider)) {
    throw new OAuthError('invalid-ticket', 'This sign-up link is invalid or has expired. Please try again.');
  }
  return decoded as OAuthRegistrationTicket;
};

const providerAccountMetadata = (identity: VerifiedIdentity): string => {
  const metadata: Record<string, string | boolean> = {};
  if (identity.username) metadata.username = identity.username;
  if (identity.emailVerified !== undefined) metadata.email_verified = identity.emailVerified;
  return JSON.stringify(metadata);
};

const isUniqueViolation = (error: unknown, columnPattern: string): boolean => {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: string; meta?: { target?: unknown } };
  if (err.code !== 'P2002') return false;
  const targets = err.meta?.target;
  const list = Array.isArray(targets) ? targets : targets ? [targets] : [];
  if (list.length === 0) return true;
  return list.some((target) => String(target).includes(columnPattern));
};
/**
 * Process a provider callback after code + ID-token verification:
 *  - identity already linked -> real VANTA session + exchange code (login),
 *  - identity matches an existing VANTA account by verified email/phone ->
 *    refusal to auto-merge (the user is directed back to normal login),
 *  - otherwise -> a signed registration ticket for the existing register flow.
 */
export const handleProviderCallback = async (
  provider: OAuthProvider,
  code: string,
  stateRaw: string,
  req: Request
): Promise<OAuthCallbackResult> => {
  const state = verifyOAuthState(stateRaw, provider);
  if (typeof code !== 'string' || !code) {
    throw new OAuthError('invalid-callback', 'The sign-in could not be completed. Please try again.');
  }

  const { clientId } = providerClientConfig(provider);
  const idToken = await exchangeAuthorizationCode(provider, code, state.codeVerifier);
  const claims = await verifyProviderIdToken(provider, idToken, clientId, state.nonce);
  const identity = identityFromClaims(provider, claims);

  // ------------------------------------------------------------------
  // Authenticated account linking (the user initiated the OAuth flow from
  // an authenticated context). The provider identity is attached to the
  // authenticated VANTA user; never merged by display names/emails.
  // ------------------------------------------------------------------
  if (state.linkingUserId) {
    const existing = await prisma.providerAccount.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId: identity.providerAccountId } },
    });
    if (existing) {
      throw new OAuthError('already-linked', 'This account is already linked to another VANTA account.');
    }
    await prisma.providerAccount.create({
      data: {
        userId: state.linkingUserId,
        provider,
        providerAccountId: identity.providerAccountId,
        email: identity.email,
        displayName: identity.name,
        avatarUrl: identity.avatarUrl,
        metadata: providerAccountMetadata(identity),
      },
    });
    await auditLog.log({
      userId: state.linkingUserId,
      action: 'OAUTH_ACCOUNT_LINKED',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { provider },
      severity: 'INFO',
    });
    return { kind: 'linked', provider, redirectPath: state.redirect, linkedToLinkingUserId: true };
  }

  // ------------------------------------------------------------------
  // Existing linked identity -> login (Cases B & D).
  // ------------------------------------------------------------------
  const existing = await prisma.providerAccount.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId: identity.providerAccountId } },
  });
  if (existing) {
    const user = await prisma.user.findUnique({
      where: { id: existing.userId },
      include: { profile: true, wallet: true, userSettings: true, notificationPrefs: true },
    });
    if (!user) {
      throw new OAuthError('linked-user-missing', 'The linked VANTA account no longer exists. Please sign in again.');
    }
    if (user.status !== 'ACTIVE') {
      throw new OAuthError('account-restricted', user.status === 'SUSPENDED' ? 'Account suspended' : 'Account restricted');
    }
    const { exchangeCode } = await createVantaSessionAndExchangeCode({ id: user.id, role: user.role }, provider, req);
    return { kind: 'linked', provider, redirectPath: state.redirect, exchangeCode };
  }

  // ------------------------------------------------------------------
  // Unlinked identity: never silently merge accounts by email/phone.
  // If the verified email/phone already belongs to a VANTA account, refuse
  // and direct the user to authenticate normally first (Cases E & F).
  // ------------------------------------------------------------------
  if (identity.email) {
    const emailOwner = await prisma.user.findFirst({ where: { email: identity.email } });
    if (emailOwner) {
      return { kind: 'existing-account', provider, redirectPath: state.redirect };
    }
  }
  if (identity.phoneNumber) {
    const phoneOwner = await prisma.user.findFirst({
      where: { OR: [{ phone: identity.phoneNumber }, { phoneNumber: identity.phoneNumber }] },
    });
    if (phoneOwner) {
      return { kind: 'existing-account', provider, redirectPath: state.redirect };
    }
  }

  // ------------------------------------------------------------------
  // New provider identity -> registration ticket (Cases A & C).
  // ------------------------------------------------------------------
  const registrationTicket = issueRegistrationTicket(identity, state.redirect);
  return {
    kind: 'new',
    provider,
    redirectPath: state.redirect,
    registrationTicket,
    email: identity.email,
    name: identity.name,
  };
};
// ============================================================================
// Completing registration for a new provider identity
// ============================================================================

const normalizeUsername = (value: unknown): string => {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw.replace(/^@/, '').toLowerCase();
};

/**
 * Creates the VANTA account for a verified provider identity using the same
 * user-creation architecture as email registration (profile, wallet, settings,
 * notification prefs, welcome reward), links the ProviderAccount row, and
 * issues a normal VANTA session. No provider identity can be created twice —
 * the `@@unique([provider, providerAccountId])` constraint is the final gate.
 */
export const completeOAuthRegistration = async (
  payload: { ticket: string; username: unknown; fullName?: unknown },
  req: Request
) => {
  if (!payload || typeof payload.ticket !== 'string' || !payload.ticket) {
    throw new OAuthError('invalid-ticket', 'This sign-up link is invalid or has expired. Please try again.');
  }
  const ticket = verifyRegistrationTicket(payload.ticket);
  const username = normalizeUsername(payload.username);
  if (!username || !SecurityValidator.isValidUsername(username)) {
    throw new OAuthError('invalid-username', 'Username must be 3-30 characters (letters, numbers, underscores, hyphens)');
  }

  // An existing account with the same verified email is never auto-merged.
  if (ticket.email) {
    const emailOwner = await prisma.user.findFirst({ where: { email: ticket.email } });
    if (emailOwner) {
      throw new OAuthError('email-taken', 'An account with this email already exists. Please sign in with your existing VANTA account before connecting it.');
    }
  }
  const usernameOwner = await prisma.user.findFirst({ where: { username } });
  if (usernameOwner) {
    throw new OAuthError('username-taken', 'That username is already taken.');
  }
  const providerOwned = await prisma.providerAccount.findUnique({
    where: { provider_providerAccountId: { provider: ticket.provider, providerAccountId: ticket.providerAccountId } },
  });
  if (providerOwned) {
    // Case G: the provider identity already belongs to another VANTA account.
    throw new OAuthError('already-linked', 'This sign-up link has already been used for another account.');
  }

  const fullName = SecurityValidator.sanitizeText(
    typeof payload.fullName === 'string' && payload.fullName.trim() ? payload.fullName : ticket.name || ''
  ) || null;

  let user: any;
  try {
    user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: ticket.email,
          username,
          fullName,
          profile: { create: { username, fullName } },
          wallet: { create: {} },
          userSettings: { create: {} },
          notificationPrefs: { create: {} },
        },
      });
      await tx.providerAccount.create({
        data: {
          userId: created.id,
          provider: ticket.provider,
          providerAccountId: ticket.providerAccountId,
          email: ticket.email,
          displayName: fullName,
          avatarUrl: ticket.avatarUrl,
          metadata: JSON.stringify({
            email_verified: ticket.emailVerified === true,
            phone: ticket.phoneNumber,
          }),
        },
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error, 'providerAccountId') || isUniqueViolation(error, 'ProviderAccount_provider_providerAccountId_key')) {
      throw new OAuthError('already-linked', 'This sign-up link has already been used for another account.');
    }
    if (isUniqueViolation(error, 'username')) {
      throw new OAuthError('username-taken', 'That username is already taken.');
    }
    if (isUniqueViolation(error, 'email') || isUniqueViolation(error, 'User_email_key')) {
      throw new OAuthError('email-taken', 'An account with this email already exists. Please sign in with your existing VANTA account before connecting it.');
    }
    throw new OAuthError('registration-failed', 'Unable to create your account. Please try again.');
  }

  try {
    await welcomeRewardService.claimWelcomeReward(user.id);
  } catch (rewardError) {
    // Same behavior as email registration: never fail signup on reward errors.
    console.error('[OAuth] Failed to award welcome reward:', rewardError);
  }

  const { tokenPair } = await createVantaSessionAndExchangeCode({ id: user.id, role: user.role }, ticket.provider, req);
  const userWithRelations = await prisma.user.findUnique({
    where: { id: user.id },
    include: {
      profile: true,
      wallet: { select: { coinBalance: true, earningsBalance: true } },
      userSettings: true,
      notificationPrefs: true,
    },
  });

  return {
    user: sanitizeUserShape(userWithRelations || user),
    token: tokenPair.accessToken,
    refreshToken: tokenPair.refreshToken,
    expiresIn: accessTokenExpiresInSeconds(),
    redirect: ticket.redirect,
  };
};