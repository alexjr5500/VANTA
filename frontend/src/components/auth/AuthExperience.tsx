'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, Eye, EyeOff, Loader2, LockKeyhole, Mail, Send, UserRound, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { authLogin, authRegister, authComplete2FALogin } from '@/lib/authApi';
import { apiGet } from '@/lib/apiClient';
import { ApiError } from '@/lib/api';
import { storeAppealContext } from '@/lib/appealApi';
import {
  oauthAuthorizeEndpoint,
  oauthCompleteRegistration,
  oauthExchange,
  oauthReasonMessage,
  oauthStatus,
  parseOAuthCallbackParams,
  safeOAuthDestination,
} from '@/lib/oauthFlow';
import VantaLogo from '@/components/ui/VantaLogo';

type Props = { mode: 'login' | 'register' };
type Availability = 'idle' | 'checking' | 'available' | 'taken';
type FieldName = 'identifier' | 'username' | 'email' | 'password' | 'terms' | 'fullName';
type FieldErrors = Partial<Record<FieldName, string>>;
type OAuthProviderName = 'google' | 'telegram';

const safeDestination = (value: string | null) => value && value.startsWith('/') && !value.startsWith('//') ? value : '/reels';

function message(error: unknown) {
  const text = error instanceof ApiError ? error.message : error instanceof Error ? error.message : '';
  if (/vanta account/i.test(text)) return text;
  if (/verify/i.test(text)) return 'Please verify your email before continuing.';
  if (/already exists|already registered|taken/i.test(text)) return 'That email or username is already in use.';
  if (/invalid email/i.test(text)) return 'Enter a valid email address.';
  if (/network|fetch|failed to fetch/i.test(text)) return 'Check your connection and try again.';
  if (/invalid email or password|invalid credentials/i.test(text)) return 'Incorrect email/username or password.';
  return text || 'Something went wrong. Please try again.';
}

/**
 * True when a login attempt was rejected because the account is banned with
 * valid credentials — the response carries the appeal token the banned
 * screen needs. Stale/nearby states (wrong password, suspended) never match.
 */
function isBannedLoginError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  const data = (error as ApiError).data || {};
  return error.statusCode === 403 && data?.code === 'ACCOUNT_BANNED' && typeof data?.appealToken === 'string';
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15Z" />
      <path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.9l-6.6-5.1c-1.8 1.2-4 1.9-6.9 1.9-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20 20 0 0 0 24 44Z" />
      <path fill="#FBBC05" d="M12.6 27.5a12 12 0 0 1 0-7v-5.3H5.8a20 20 0 0 0 0 17.6l6.8-5.3Z" />
      <path fill="#EA4335" d="M24 12.1c3 0 5.7 1 7.8 3.1l5.8-5.8C34.1 6.1 29.5 4 24 4A20 20 0 0 0 5.8 15.2l6.8 5.3c1.6-4.8 6.1-8.4 11.4-8.4Z" />
    </svg>
  );
}

function TelegramIcon() {
  return <Send size={17} strokeWidth={2.2} color="#27A7E7" aria-hidden="true" />;
}

function Logo() {
  return <Link className="auth-brand" href="/" aria-label="VANTA home"><VantaLogo size={27} showText /></Link>;
}

export default function AuthExperience({ mode }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const { login, token, isLoading } = useAuth();
  const register = mode === 'register';
  const [identifier, setIdentifier] = useState('');
  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [signupStep, setSignupStep] = useState(1);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [terms, setTerms] = useState(false);
  const [remember, setRemember] = useState(false);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  // Two-factor step: a login held for 2FA stores the userId here and the
  // form switches to the code-collection screen until verification succeeds.
  const [twoFactorUserId, setTwoFactorUserId] = useState<string | null>(null);
  const [twoFactorChallenge, setTwoFactorChallenge] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [twoFactorError, setTwoFactorError] = useState('');
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);
  const [availability, setAvailability] = useState<Availability>('idle');
  const [providerReady, setProviderReady] = useState<{ google: boolean; telegram: boolean }>({ google: true, telegram: true });
  const [providerBusy, setProviderBusy] = useState<OAuthProviderName | null>(null);
  const strength = useMemo(() => [password.length >= 8, /[A-Z]/.test(password) && /[a-z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length, [password]);
  const destination = safeDestination(params.get('redirect') || params.get('next'));

  // Provider callback parameters appended by the backend (e.g. ?oauth=google&code=…).
  // `window` does not exist during SSR/static generation. Reading it during the
  // render used to throw `ReferenceError: window is not defined`, which made the
  // production /login and /register pages return HTTP 500 for every visitor.
  // Parse the query string only after hydration on the client.
  const [oauthSearch, setOauthSearch] = useState('');
  useEffect(() => { setOauthSearch(window.location.search); }, []);
  const oauth = parseOAuthCallbackParams(oauthSearch);
  const oauthSignup = register && Boolean(oauth.provider && oauth.ticket);
  const oauthSignin = !register && Boolean(oauth.provider && oauth.code);
  const oauthError = !register && oauth.provider && oauth.status === 'error' ? oauthReasonMessage(oauth.reason) : '';
useEffect(() => { if (!isLoading && token) router.replace(destination); }, [isLoading, token, router, destination]);
  useEffect(() => {
    if (!register) return;
    const value = username.trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9_-]{3,30}$/.test(value)) { setAvailability('idle'); return; }
    setAvailability('checking');
    const timer = window.setTimeout(() => apiGet<any>(`/api/auth/check-username?username=${encodeURIComponent(value)}`)
      .then((response) => setAvailability(response?.available === true || response?.data?.available === true ? 'available' : 'taken'))
      .catch(() => setAvailability('idle')), 450);
    return () => window.clearTimeout(timer);
  }, [username, register]);

  // Disable provider buttons when the backend reports the provider is unconfigured.
  useEffect(() => {
    void oauthStatus('google').then((status) => setProviderReady((prev) => ({ ...prev, google: status?.configured !== false }))).catch(() => {});
    void oauthStatus('telegram').then((status) => setProviderReady((prev) => ({ ...prev, telegram: status?.configured !== false }))).catch(() => {});
  }, []);

  // Complete an OAuth sign-in on the login screen (?oauth=google&code=…).
  useEffect(() => {
    if (!oauthSignin) return;
    setBusy(true);
    let cancelled = false;
    void oauthExchange(oauth.code)
      .then(async (response) => {
        if (cancelled) return;
        if (response.requiresTwoFactor && response.userId && response.twoFactorChallenge) {
          setTwoFactorUserId(response.userId);
          setTwoFactorChallenge(response.twoFactorChallenge);
          return;
        }
        if (!response.user || !response.token) throw new Error('Invalid authentication response');
        await login(response.user, response.token, response.refreshToken);
        window.history.replaceState(null, '', window.location.pathname);
        router.replace(safeOAuthDestination(oauth.redirect));
      })
      .catch((caughtError) => {
        if (cancelled) return;
        setError(oauthReasonMessage('expired-code'));
        window.history.replaceState(null, '', window.location.pathname);
      })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [oauthSignin, oauth.code, login, router, oauth.redirect]);
  const startOAuth = (provider: OAuthProviderName) => {
    if (providerBusy || busy) return;
    setProviderBusy(provider);
    const redirect = params.get('redirect') || params.get('next') || '';
    // Navigate to the backend authorize endpoint; it 302s to Google/Telegram.
    setError('');
    window.location.replace(oauthAuthorizeEndpoint(provider, redirect));
  };

  const continueSignup = () => {
    setError('');
    setFieldErrors({});
    if (signupStep === 1) {
      if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setFieldErrors({ email: 'Enter a valid email address.' });
        return;
      }
      setSignupStep(2);
      return;
    }
    const nextErrors: FieldErrors = {};
    if (!username.trim()) nextErrors.username = 'Choose a username.';
    else if (!/^[a-zA-Z0-9_-]{3,30}$/.test(username.replace(/^@/, ''))) nextErrors.username = 'Use 3–30 letters, numbers, underscores, or hyphens.';
    else if (availability === 'taken' || availability === 'checking') nextErrors.username = 'Please choose an available username.';
    if (!password) nextErrors.password = 'Create a password.';
    else if (password.length < 8) nextErrors.password = 'Use at least 8 characters.';
    if (Object.keys(nextErrors).length) { setFieldErrors(nextErrors); return; }
    setSignupStep(3);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (register && !oauthSignup && signupStep < 3) return;
    if (busy) return;
    setError(''); setFieldErrors({});

    // OAuth sign-up: provider identity is already verified; the user only
    // picks a username (plus optional full name) and agrees to the terms.
    if (oauthSignup) {
      const nextErrors: FieldErrors = {};
      if (!username.trim()) nextErrors.username = 'Choose a username.';
      else if (!/^[a-zA-Z0-9_-]{3,30}$/.test(username.replace(/^@/, ''))) nextErrors.username = 'Use 3–30 letters, numbers, underscores, or hyphens.';
      else if (availability === 'taken' || availability === 'checking') nextErrors.username = 'Please choose an available username.';
      if (!fullName.trim()) nextErrors.fullName = 'Enter your display name.';
      if (!dateOfBirth) nextErrors.terms = 'Enter your date of birth.';
      else { const dob = new Date(dateOfBirth + 'T00:00:00'); const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 13); if (Number.isNaN(dob.getTime()) || dob > cutoff) nextErrors.terms = 'You must be at least 13 years old to join VANTA.'; }
      if (!terms) nextErrors.terms = 'Please agree before creating your account.';
      if (Object.keys(nextErrors).length) { setFieldErrors(nextErrors); return; }
      setBusy(true);
      try {
        const response = await oauthCompleteRegistration({
          ticket: oauth.ticket,
          username: username.trim().replace(/^@/, ''),
          fullName: fullName.trim() || undefined,
          dateOfBirth,
        });
        if (!response.user || !response.token) throw new Error('Invalid authentication response');
        await login(response.user, response.token, response.refreshToken);
        router.replace(safeOAuthDestination(oauth.redirect));
      } catch (caughtError) { setError(message(caughtError)); } finally { setBusy(false); }
      return;
    }

    const nextErrors: FieldErrors = {};
    if (!register && !identifier.trim()) nextErrors.identifier = 'Enter your email address or username.';
    if (register) {
      if (!username.trim()) nextErrors.username = 'Choose a username.';
      else if (!/^[a-zA-Z0-9_-]{3,30}$/.test(username.replace(/^@/, ''))) nextErrors.username = 'Use 3–30 letters, numbers, underscores, or hyphens.';
      else if (availability === 'taken' || availability === 'checking') nextErrors.username = 'Please choose an available username.';
      if (!fullName.trim()) nextErrors.fullName = 'Enter your display name.';
      if (!email.trim()) nextErrors.email = 'Enter your email address.';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) nextErrors.email = 'Enter a valid email address.';
      if (!password) nextErrors.password = 'Create a password.';
      else if (password.length < 8) nextErrors.password = 'Use at least 8 characters.';
      if (!dateOfBirth) nextErrors.terms = 'Enter your date of birth.';
      else { const dob = new Date(dateOfBirth + 'T00:00:00'); const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 13); if (Number.isNaN(dob.getTime()) || dob > cutoff) nextErrors.terms = 'You must be at least 13 years old to join VANTA.'; }
      if (!terms) nextErrors.terms = 'Please agree before creating your account.';
    }
    if (!register && !password) nextErrors.password = 'Enter your password.';
    if (Object.keys(nextErrors).length) { setFieldErrors(nextErrors); return; }
    setBusy(true);
    try {
      const response = register
        ? await authRegister({ email: email.trim(), username: username.trim().replace(/^@/, ''), password, fullName: fullName.trim() || undefined, dateOfBirth })
        : await authLogin({ identifier: identifier.trim(), password, rememberMe: remember });
      // The backend holds the login for two-factor verification (it never
      // issues a token until the authenticator/backup code is confirmed).
      if (!register && (response as any).requiresTwoFactor) {
        setTwoFactorUserId((response as any).userId as string);
        setTwoFactorChallenge((response as any).twoFactorChallenge as string);
        return;
      }
      if (!response.user || !response.token) throw new Error('Invalid authentication response');
      await login(response.user, response.token, response.refreshToken);
      // A suspended account signs in successfully into a restricted session —
      // take it to the dedicated suspended screen, not the normal app shell.
      if (!register && ['DEACTIVATED', 'SCHEDULED_FOR_DELETION'].includes(response.user.status || (response as any).accountStatus || '')) {
        router.replace('/account/deactivated');
        return;
      }
      if (!register && (response.user.status === 'SUSPENDED' || (response as any).accountStatus === 'SUSPENDED')) {
        router.replace('/account/suspended');
        return;
      }
      router.replace(destination);
    } catch (caughtError) {
      // A banned account never receives a session. Valid credentials come
      // back as 403 ACCOUNT_BANNED with a narrow appeal token — hand it to
      // the dedicated banned screen so an appeal can still be submitted.
      if (isBannedLoginError(caughtError)) {
        const data = (caughtError as ApiError)?.data || {};
        storeAppealContext(String(data.appealToken || ''), String(data.username || identifier.trim()));
        router.replace('/account/banned');
        return;
      }
      setError(message(caughtError));
    } finally { setBusy(false); }
  };

  const submit2FA = async (event: FormEvent) => {
    event.preventDefault();
    if (twoFactorBusy || !twoFactorUserId || !twoFactorChallenge) return;
    if (twoFactorCode.trim().length < 6) {
      setTwoFactorError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setTwoFactorBusy(true); setTwoFactorError('');
    try {
      const response = await authComplete2FALogin(twoFactorUserId, twoFactorChallenge, twoFactorCode.trim());
      if (!response.user || !response.token) throw new Error('Invalid authentication response');
      await login(response.user, response.token, response.refreshToken);
      if (['DEACTIVATED', 'SCHEDULED_FOR_DELETION'].includes(response.user.status || (response as any).accountStatus || '')) {
        router.replace('/account/deactivated');
        return;
      }
      if (response.user.status === 'SUSPENDED' || (response as any).accountStatus === 'SUSPENDED') {
        router.replace('/account/suspended');
        return;
      }
      router.replace(destination);
    } catch (caughtError) {
      if (isBannedLoginError(caughtError)) {
        const data = (caughtError as ApiError)?.data || {};
        storeAppealContext(String(data.appealToken || ''), String(data.username || ''));
        router.replace('/account/banned');
        return;
      }
      setTwoFactorError(message(caughtError));
    } finally {
      setTwoFactorBusy(false);
    }
  };
return (
    <main className={`auth-page auth-page-${mode}`}>
      <div className="auth-atmosphere" aria-hidden="true"><VantaLogo size={260} /></div>
      <section className="auth-shell" aria-labelledby="auth-title">
        <Logo />
        <header className="auth-header">
          <span className="auth-kicker">VANTA / {register ? 'JOIN' : 'SIGN IN'}</span>
          <h1 id="auth-title">{register ? (oauthSignup ? 'Finish your profile' : signupStep === 1 ? 'Create your account' : signupStep === 2 ? 'Secure your account' : 'Tell us about yourself') : 'Welcome back'}</h1>
          <p>{register ? (oauthSignup ? `Finish setting up your ${oauth.provider === 'google' ? 'Google' : 'Telegram'} account.` : signupStep === 1 ? 'Choose how you want to join VANTA.' : signupStep === 2 ? 'Choose your username and password.' : 'Just a couple of details to get you started.') : 'Sign in to continue creating, connecting, and going live.'}</p>
          {register && !oauthSignup && <div className="auth-signup-progress" aria-label={`Registration step ${signupStep} of 3`}><div className="auth-signup-progress-track"><span style={{ width: `${signupStep * 33.333}%` }} /></div><div className="auth-signup-progress-labels"><span className={signupStep === 1 ? 'active' : ''}>Method</span><span className={signupStep === 2 ? 'active' : ''}>Credentials</span><span className={signupStep === 3 ? 'active' : ''}>Profile</span></div></div>}
        </header>
        <form className="auth-form" onSubmit={twoFactorUserId ? submit2FA : submit} noValidate>
              {twoFactorUserId && (
                <div className="auth-field">
                  <label htmlFor="twofa">Authentication code</label>
                  <div className="auth-input-wrap"><LockKeyhole size={17} /><input id="twofa" className="auth-input" inputMode="numeric" maxLength={6} value={twoFactorCode} onChange={(event) => setTwoFactorCode(event.target.value.replace(/[^0-9]/g, '').slice(0, 6))} placeholder="6-digit code" autoFocus aria-invalid={!!twoFactorError} aria-describedby={twoFactorError ? 'twofa-error' : undefined} /></div>
                  {twoFactorError && <span className="auth-field-error" id="twofa-error"><X size={12} />{twoFactorError}</span>}
                  <button type="button" className="auth-link" style={{ marginTop: 10 }} onClick={() => { setTwoFactorUserId(null); setTwoFactorChallenge(null); setTwoFactorCode(''); setTwoFactorError(''); }}>Back to sign in</button>
                </div>
              )}
              {!twoFactorUserId && (
              <>
              {oauthSignup && <div className="auth-oauth-note" role="status"><UserRound size={14} /><span>Your {oauth.provider === 'google' ? 'Google' : 'Telegram'} identity was verified. Now choose your VANTA username.</span></div>}
              {oauthSignup && oauth.email && <div className="auth-oauth-email"><Mail size={15} /><span>{oauth.email}</span></div>}
              {oauthSignup && <Field id="username" label="Username" value={username} onChange={setUsername} placeholder="Choose a username" status={availability} error={fieldErrors.username} />}
              {oauthSignup && <Field id="fullName" label="Display name" value={fullName} onChange={setFullName} placeholder="How should people know you?" error={fieldErrors.fullName} />}
              {oauthSignup && <div className="auth-field"><label htmlFor="oauthDateOfBirth">Date of birth</label><div className="auth-input-wrap"><input id="oauthDateOfBirth" type="date" className="auth-input" value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} max={new Date(new Date().setFullYear(new Date().getFullYear() - 13)).toISOString().slice(0, 10)} required /></div>{fieldErrors.terms && <span className="auth-field-error"><X size={12} />{fieldErrors.terms}</span>}</div>}
              {register && !oauthSignup && signupStep === 1 && <Field id="email" label="Email address" value={email} onChange={setEmail} placeholder="you@example.com" type="email" error={fieldErrors.email} />}
              {register && !oauthSignup && signupStep >= 2 && <Field id="username" label="Username" value={username} onChange={setUsername} placeholder="Choose a username" status={availability} error={fieldErrors.username} />}
              {register && !oauthSignup && signupStep === 3 && <Field id="fullName" label="Display name" value={fullName} onChange={setFullName} placeholder="How should people know you?" error={fieldErrors.fullName} />}
              {register && !oauthSignup && signupStep === 3 && <div className="auth-field"><label htmlFor="dateOfBirth">Date of birth</label><div className="auth-input-wrap"><input id="dateOfBirth" type="date" className="auth-input" value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} max={new Date(new Date().setFullYear(new Date().getFullYear() - 13)).toISOString().slice(0, 10)} required /></div>{fieldErrors.terms && <span className="auth-field-error"><X size={12} />{fieldErrors.terms}</span>}</div>}
              {!register && <Field id="identifier" label="Email or username" value={identifier} onChange={setIdentifier} placeholder="Email address or username" type="text" error={fieldErrors.identifier} />}
              {(!register || signupStep === 2 || oauthSignup) && !oauthSignup && (
              <div className="auth-field">
                <label htmlFor="password">Password</label>
                <div className={`auth-input-wrap ${fieldErrors.password ? 'invalid' : ''}`}><LockKeyhole size={17} /><input id="password" type={show ? 'text' : 'password'} className="auth-input has-action" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={register ? 'At least 8 characters' : 'Enter your password'} autoComplete={register ? 'new-password' : 'current-password'} aria-invalid={!!fieldErrors.password} aria-describedby={fieldErrors.password ? 'password-error' : register ? 'password-strength' : undefined} required /><button type="button" className="auth-password-toggle" onClick={() => setShow((visible) => !visible)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
                {fieldErrors.password && <span className="auth-field-error" id="password-error"><X size={12} />{fieldErrors.password}</span>}
                {register && <div className="auth-strength-wrap" aria-live="polite"><div className={`auth-strength strength-${strength}`} aria-hidden="true">{[1, 2, 3, 4].map((level) => <i className={level <= strength ? 'on' : ''} key={level} />)}</div><span>{strength < 2 ? 'Weak' : strength === 2 ? 'Medium' : 'Strong'}</span></div>}
              </div>
              )}
              {!register && !oauthSignin && <div className="auth-login-options"><label className="auth-check"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /><span>Remember me</span></label><Link className="auth-link" href="/forgot-password">Forgot password?</Link></div>}
              {register && (signupStep === 3 || oauthSignup) && <><label className={`auth-check ${fieldErrors.terms ? 'invalid' : ''}`}><input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} required /><span>I agree to the <Link className="auth-link" href="/terms">Terms of Service</Link> and <Link className="auth-link" href="/privacy">Privacy Policy</Link>.</span></label>{fieldErrors.terms && <span className="auth-field-error auth-terms-error"><X size={12} />{fieldErrors.terms}</span>}</>}
              </>)}
{error && <div className="auth-error" role="alert"><X size={15} />{error}</div>}
              {!error && oauthError && <div className="auth-error" role="alert"><X size={15} />{oauthError}</div>}
              {twoFactorUserId && twoFactorError && <div className="auth-error" role="alert"><X size={15} />{twoFactorError}</div>}
              {register && !oauthSignup && signupStep > 1 && <button className="auth-link" type="button" onClick={() => { setError(''); setFieldErrors({}); setSignupStep((step) => step - 1); }}>Back</button>}
              {register && !oauthSignup && signupStep < 3 && <button className="auth-submit" type="button" onClick={continueSignup}><span className="auth-submit-content">{signupStep === 1 ? "Continue with email" : "Continue"}<ArrowRight size={17} aria-hidden="true" /></span></button>}
              {(!register || oauthSignup || signupStep === 3) && <button className="auth-submit" type="submit" disabled={busy || twoFactorBusy || (register && availability === 'checking')} aria-busy={busy || twoFactorBusy} data-loading={busy || twoFactorBusy}><span className="auth-submit-content">{busy || twoFactorBusy ? <><Loader2 className="spin" size={18} aria-hidden="true" /><span>{register ? 'Creating account…' : twoFactorUserId ? 'Verifying…' : 'Signing in…'}</span></> : <>{register ? 'Create account' : twoFactorUserId ? 'Verify & sign in' : oauthSignin ? 'Finish sign in' : 'Sign In'}<ArrowRight size={17} aria-hidden="true" /></>}</span></button>}
        </form>
        {!twoFactorUserId && !oauthSignin && (!register || signupStep === 1) && !oauthSignup && (providerReady.google || providerReady.telegram) && (
          <div className="auth-providers">
            <span className="auth-provider-divider">or continue with</span>
            {providerReady.google && (
              <button type="button" className="auth-provider-btn auth-provider-btn--icon" aria-label="Continue with Google" title="Continue with Google" disabled={busy || providerBusy !== null} aria-busy={providerBusy === 'google'} data-loading={providerBusy === 'google'} onClick={() => startOAuth('google')}>
                <span className="auth-provider-icon">{providerBusy === 'google' ? <Loader2 className="spin" size={20} aria-hidden="true" /> : <GoogleIcon />}</span>
              </button>
            )}
            {providerReady.telegram && (
              <button type="button" className="auth-provider-btn auth-provider-btn--icon auth-provider-btn--telegram" aria-label="Continue with Telegram" title="Continue with Telegram" disabled={busy || providerBusy !== null} aria-busy={providerBusy === 'telegram'} data-loading={providerBusy === 'telegram'} onClick={() => startOAuth('telegram')}>
                <span className="auth-provider-icon">{providerBusy === 'telegram' ? <Loader2 className="spin" size={20} aria-hidden="true" /> : <TelegramIcon />}</span>
              </button>
            )}
          </div>
        )}
        <div className="auth-switch"><span>{register ? 'Already have an account?' : 'Don\'t have an account?'}</span><Link className="auth-link" href={register ? '/login' : '/register'}>{register ? 'Sign in' : 'Create account'}</Link></div>
        <footer className="auth-legal"><Link href="/terms">Terms</Link><i /><Link href="/privacy">Privacy</Link></footer>
      </section>
    </main>
  );
}
function Field({ id, label, value, onChange, placeholder, type = 'text', optional, status, error }: { id: string; label: string; value: string; onChange: (_value: string) => void; placeholder: string; type?: string; optional?: boolean; status?: Availability; error?: string }) {
  const Icon = id === 'email' || id === 'identifier' ? Mail : UserRound;
  const describedBy = error ? `${id}-error` : status && status !== 'idle' ? `${id}-status` : undefined;
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label} {optional && <span>(optional)</span>}</label>
      <div className={`auth-input-wrap ${error ? 'invalid' : ''}`}><Icon size={17} /><input id={id} type={type} className="auth-input" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} autoComplete={id === 'email' ? 'email' : id === 'fullName' ? 'name' : 'username'} required={!optional} aria-invalid={!!error} aria-describedby={describedBy} /></div>
      {error ? <span className="auth-field-error" id={`${id}-error`}><X size={12} />{error}</span> : status && status !== 'idle' && <span id={`${id}-status`} className={`auth-status ${status}`} aria-live="polite">{status === 'checking' ? 'Checking availability…' : status === 'available' ? <><Check size={12} /> Username available</> : <><X size={12} /> Username already taken</>}</span>}
    </div>
  );
}