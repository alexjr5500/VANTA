import { Request, Response } from 'express';
import { auditLog } from '../security';
import {
  OAUTH_PROVIDERS,
  OAuthError,
  OAuthProvider,
  buildAuthorizeRequest,
  completeOAuthRegistration,
  frontendBaseUrl,
  handleProviderCallback,
  oauthProviderStatus,
  redeemExchangeCode,
  safeFrontendPath,
} from '../services/oauth.service';

// ============================================================================
// VANTA OAuth controller (Google + Telegram)
// Server-side Authorization Code flow. Never trusts frontend-supplied
// identity data; the provider identity always comes from a verified ID token.
// User-facing errors are generic; diagnostics go to the server log.
// ============================================================================

const providerFromParam = (raw: unknown): OAuthProvider | undefined => {
  if (typeof raw !== 'string') return undefined;
  return OAUTH_PROVIDERS.find((candidate) => candidate === raw.toLowerCase());
};

const frontendRedirect = (res: Response, path: string): void => {
  res.redirect(`${frontendBaseUrl()}${path}`);
};

const loginErrorQuery = (provider: string, reason: string, redirect: string): string =>
  `?oauth=${provider}&status=error&reason=${encodeURIComponent(reason)}&redirect=${encodeURIComponent(redirect)}`;

/** GET /api/auth/oauth/status/:provider */
export const status = (req: Request, res: Response): void => {
  const provider = providerFromParam(req.params.provider);
  if (!provider) {
    res.status(400).json({ error: 'Unsupported provider' });
    return;
  }
  res.status(200).json(oauthProviderStatus(provider));
};

/** GET /api/auth/oauth/authorize/:provider?redirect=/reels */
export const authorize = async (req: Request, res: Response): Promise<void> => {
  const provider = providerFromParam(req.params.provider);
  if (!provider) {
    res.status(400).json({ error: 'Unsupported provider' });
    return;
  }
  const redirect = safeFrontendPath(typeof req.query.redirect === 'string' ? req.query.redirect : '');
  try {
    const { authorizeUrl } = buildAuthorizeRequest(provider, redirect);
    res.redirect(authorizeUrl);
  } catch (error) {
    console.error(`[OAuth] authorize(${provider}) failed:`, error instanceof Error ? error.message : error);
    if (error instanceof OAuthError && error.code === 'not-configured') {
      console.warn(`[OAuth] ${provider} is not configured (GOOGLE_*/TELEGRAM_* env vars)`);
    }
    await auditLog.log({
      action: 'OAUTH_AUTHORIZE_FAILED',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { provider, reason: error instanceof OAuthError ? error.code : 'unknown' },
      severity: 'WARNING',
    });
    frontendRedirect(res, `/login${loginErrorQuery(provider, 'not-configured', redirect)}`);
  }
};

/** GET /api/auth/oauth/callback/:provider?code=&state= */
export const callback = async (req: Request, res: Response): Promise<void> => {
  const provider = providerFromParam(req.params.provider);
  if (!provider) {
    res.status(400).json({ error: 'Unsupported provider' });
    return;
  }

  // The user cancelled the provider consent screen (or the provider denied).
  if (typeof req.query.error === 'string' && req.query.error) {
    console.warn(`[OAuth] callback(${provider}) provider error: ${String(req.query.error).slice(0, 200)}`);
    await auditLog.log({
      action: 'OAUTH_CANCELLED',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { provider, error: String(req.query.error).slice(0, 120) },
      severity: 'INFO',
    });
    frontendRedirect(res, `/login${loginErrorQuery(provider, 'cancelled', safeFrontendPath(req.query.redirect))}`);
    return;
  }

  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';

  if (!code || !state) {
    frontendRedirect(res, `/login${loginErrorQuery(provider, 'invalid-callback', '/reels')}`);
    return;
  }

  try {
    const result = await handleProviderCallback(provider, code, state, req);
    const redirect = encodeURIComponent(result.redirectPath);

    if (result.kind === 'linked' && !result.linkedToLinkingUserId && result.exchangeCode) {
      // Cases B & D: existing linked account -> exchange code -> login page.
      frontendRedirect(res, `/login?oauth=${provider}&code=${encodeURIComponent(result.exchangeCode)}&redirect=${redirect}`);
return;
    }
    if (result.kind === 'new' && result.registrationTicket) {
      // Cases A & C: new identity -> register screen (username onboarding).
      const email = encodeURIComponent(result.email || '');
      const name = encodeURIComponent(result.name || '');
      frontendRedirect(
        res,
        `/register?oauth=${provider}&ticket=${encodeURIComponent(result.registrationTicket)}&email=${email}&name=${name}&redirect=${redirect}`
      );
      return;
    }
    if (result.kind === 'existing-account') {
      // Cases E & F: never auto-merge by email/phone.
      frontendRedirect(res, `/login${loginErrorQuery(provider, 'existing-account', result.redirectPath)}`);
      return;
    }
    // Account linking completed from an authenticated context.
    frontendRedirect(res, `${result.redirectPath}`);
  } catch (error) {
    console.error(`[OAuth] callback(${provider}) failed:`, error instanceof Error ? error.message : error);
    const reason = error instanceof OAuthError && error.code !== 'invalid-state' ? error.code : 'login-failed';
    await auditLog.log({
      action: 'OAUTH_LOGIN_FAILED',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { provider, reason },
      severity: 'WARNING',
    });
    frontendRedirect(res, `/login${loginErrorQuery(provider, reason, '/reels')}`);
  }
};

/** POST /api/auth/oauth/exchange  { code } */
export const exchange = async (req: Request, res: Response): Promise<void> => {
  const code = req.body?.code;
  if (typeof code !== 'string' || !code) {
    res.status(400).json({ error: 'Sign-in code is required' });
    return;
  }
  try {
    const result = await redeemExchangeCode(code, req);
    res.status(200).json({
      message: 'Signed in successfully',
      token: result.token,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      user: result.user,
    });
  } catch (error) {
    console.warn('[OAuth] exchange failed:', error instanceof Error ? error.message : error);
    res.status(400).json({
      error: 'This sign-in link has expired. Please try signing in again.',
    });
  }
};

/** POST /api/auth/oauth/register  { ticket, username, fullName? } */
export const register = async (req: Request, res: Response): Promise<void> => {
  const { ticket, username, fullName } = req.body ?? {};
  if (typeof ticket !== 'string' || !ticket || typeof username !== 'string' || !username) {
    res.status(400).json({ error: 'Ticket and username are required' });
    return;
  }
  try {
    const result = await completeOAuthRegistration({ ticket, username, fullName }, req);
    res.status(200).json({
      message: 'Account created successfully',
      token: result.token,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      user: result.user,
      redirect: result.redirect,
    });
  } catch (error) {
    console.warn('[OAuth] register failed:', error instanceof Error ? error.message : error);
    const statusMap: Record<string, number> = {
      'invalid-ticket': 400,
      'invalid-username': 400,
      'username-taken': 409,
      'email-taken': 409,
      'already-linked': 409,
      'registration-failed': 500,
    };
    const reason = error instanceof OAuthError ? error.code : 'registration-failed';
    const userMessage = reason === 'registration-failed'
      ? 'Unable to create your account. Please try again.'
      : error instanceof OAuthError && error.message
        ? error.message
        : 'Unable to create your account. Please try again.';
    res.status(statusMap[reason] || 400).json({ error: userMessage });
  }
};