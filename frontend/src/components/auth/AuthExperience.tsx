'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, Eye, EyeOff, Loader2, LockKeyhole, Mail, UserRound, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { authLogin, authRegister } from '@/lib/authApi';
import { apiGet } from '@/lib/apiClient';
import { ApiError } from '@/lib/api';
import VantaLogo from '@/components/ui/VantaLogo';

type Props = { mode: 'login' | 'register' };
type Availability = 'idle' | 'checking' | 'available' | 'taken';
type FieldName = 'identifier' | 'username' | 'email' | 'password' | 'terms';
type FieldErrors = Partial<Record<FieldName, string>>;

const safeDestination = (value: string | null) => value && value.startsWith('/') && !value.startsWith('//') ? value : '/reels';

function message(error: unknown) {
  const text = error instanceof ApiError ? error.message : error instanceof Error ? error.message : '';
  if (/verify/i.test(text)) return 'Please verify your email before continuing.';
  if (/already exists|already registered|taken/i.test(text)) return 'That email or username is already in use.';
  if (/invalid email/i.test(text)) return 'Enter a valid email address.';
  if (/network|fetch|failed to fetch/i.test(text)) return 'Check your connection and try again.';
  if (/invalid email or password|invalid credentials/i.test(text)) return 'Incorrect email/username or password.';
  return text || 'Something went wrong. Please try again.';
}

function Logo() {
  return <Link className="auth-brand" href="/" aria-label="VANTA home"><VantaLogo size={27} showText /></Link>;
}

export default function AuthExperience({ mode }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const { login, token, isLoading } = useAuth();
  const register = mode === 'register';
  const [identifier, setIdentifier] = useState(''); const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState(''); const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [terms, setTerms] = useState(false); const [remember, setRemember] = useState(false);
  const [show, setShow] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [availability, setAvailability] = useState<Availability>('idle');
  const strength = useMemo(() => [password.length >= 8, /[A-Z]/.test(password) && /[a-z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length, [password]);
  const destination = safeDestination(params.get('redirect') || params.get('next'));

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

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(''); setFieldErrors({});
    const nextErrors: FieldErrors = {};
    if (!register && !identifier.trim()) nextErrors.identifier = 'Enter your email address or username.';
    if (register) {
      if (!username.trim()) nextErrors.username = 'Choose a username.';
      else if (!/^[a-zA-Z0-9_-]{3,30}$/.test(username.replace(/^@/, ''))) nextErrors.username = 'Use 3–30 letters, numbers, underscores, or hyphens.';
      else if (availability === 'taken' || availability === 'checking') nextErrors.username = 'Please choose an available username.';
      if (!email.trim()) nextErrors.email = 'Enter your email address.';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) nextErrors.email = 'Enter a valid email address.';
      if (!password) nextErrors.password = 'Create a password.';
      else if (password.length < 8) nextErrors.password = 'Use at least 8 characters.';
      if (!terms) nextErrors.terms = 'Please agree before creating your account.';
    }
    if (!register && !password) nextErrors.password = 'Enter your password.';
    if (Object.keys(nextErrors).length) { setFieldErrors(nextErrors); return; }
    setBusy(true);
    try {
      const response = register
        ? await authRegister({ email: email.trim(), username: username.trim().replace(/^@/, ''), password, fullName: fullName.trim() || undefined })
        : await authLogin({ identifier: identifier.trim(), password, rememberMe: remember });
      if (!response.user || !response.token) throw new Error('Invalid authentication response');
      await login(response.user, response.token, response.refreshToken); router.replace(destination);
    } catch (caughtError) { setError(message(caughtError)); } finally { setBusy(false); }
  };

  return (
    <main className={`auth-page auth-page-${mode}`}>
      <div className="auth-atmosphere" aria-hidden="true"><VantaLogo size={260} /></div>
      <section className="auth-shell" aria-labelledby="auth-title">
        <Logo />
        <header className="auth-header">
          <span className="auth-kicker">VANTA / {register ? 'JOIN' : 'SIGN IN'}</span>
          <h1 id="auth-title">{register ? 'Create your account' : 'Welcome back'}</h1>
          <p>{register ? 'Start creating, connecting, and going live on VANTA.' : 'Sign in to continue creating, connecting, and going live.'}</p>
        </header>
        <form className="auth-form" onSubmit={submit} noValidate>
              {register && <Field id="fullName" label="Full name" value={fullName} onChange={setFullName} placeholder="Your name" optional />}
              {register && <Field id="username" label="Username" value={username} onChange={setUsername} placeholder="Choose a username" status={availability} error={fieldErrors.username} />}
              <Field id={register ? 'email' : 'identifier'} label={register ? 'Email address' : 'Email or username'} value={register ? email : identifier} onChange={register ? setEmail : setIdentifier} placeholder={register ? 'you@example.com' : 'Email address or username'} type={register ? 'email' : 'text'} error={register ? fieldErrors.email : fieldErrors.identifier} />
              <div className="auth-field">
                <label htmlFor="password">Password</label>
                <div className={`auth-input-wrap ${fieldErrors.password ? 'invalid' : ''}`}><LockKeyhole size={17} /><input id="password" type={show ? 'text' : 'password'} className="auth-input has-action" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={register ? 'At least 8 characters' : 'Enter your password'} autoComplete={register ? 'new-password' : 'current-password'} aria-invalid={!!fieldErrors.password} aria-describedby={fieldErrors.password ? 'password-error' : register ? 'password-strength' : undefined} required /><button type="button" className="auth-password-toggle" onClick={() => setShow((visible) => !visible)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
                {fieldErrors.password && <span className="auth-field-error" id="password-error"><X size={12} />{fieldErrors.password}</span>}
                {register && <div className="auth-strength-wrap" aria-live="polite"><div className={`auth-strength strength-${strength}`} aria-hidden="true">{[1, 2, 3, 4].map((level) => <i className={level <= strength ? 'on' : ''} key={level} />)}</div><span>{strength < 2 ? 'Weak' : strength === 2 ? 'Medium' : 'Strong'}</span></div>}
              </div>
              {!register && <div className="auth-login-options"><label className="auth-check"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /><span>Remember me</span></label><Link className="auth-link" href="/forgot-password">Forgot password?</Link></div>}
              {register && <><label className={`auth-check ${fieldErrors.terms ? 'invalid' : ''}`}><input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} required /><span>I agree to the <Link className="auth-link" href="/terms">Terms of Service</Link> and <Link className="auth-link" href="/privacy">Privacy Policy</Link>.</span></label>{fieldErrors.terms && <span className="auth-field-error auth-terms-error"><X size={12} />{fieldErrors.terms}</span>}</>}
              {error && <div className="auth-error" role="alert"><X size={15} />{error}</div>}
              <button className="auth-submit" type="submit" disabled={busy || (register && availability === 'checking')} aria-busy={busy}>{busy ? <><Loader2 className="spin" size={18} />{register ? 'Creating account…' : 'Signing in…'}</> : <>{register ? 'Create account' : 'Sign In'}<ArrowRight size={17} /></>}</button>
        </form>
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