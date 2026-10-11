'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, LockKeyhole, X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { VerificationResponse, ApiError } from '@/lib/api';
import { authVerifyResetToken, authResetPassword } from '@/lib/authApi';
import VantaLogo from '@/components/ui/VantaLogo';

const MIN_PASSWORD_LENGTH = 12;
const HAS_UPPERCASE = (v: string) => /[A-Z]/.test(v);
const HAS_LOWERCASE = (v: string) => /[a-z]/.test(v);
const HAS_NUMBER = (v: string) => /\d/.test(v);
const HAS_SPECIAL = (v: string) => /[^A-Za-z0-9]/.test(v);

const PASSWORD_POLICY_HINTS = [
  { test: HAS_UPPERCASE, label: 'Includes an uppercase letter' },
  { test: HAS_LOWERCASE, label: 'Includes a lowercase letter' },
  { test: HAS_NUMBER, label: 'Includes a number' },
  { test: HAS_SPECIAL, label: 'Includes a special character' },
];

const strengthIndex = (v: string): number => {
  let index = 0;
  if (v.length >= 12) index += 1;
  if (HAS_UPPERCASE(v)) index += 1;
  if (HAS_LOWERCASE(v)) index += 1;
  if (HAS_NUMBER(v)) index += 1;
  if (HAS_SPECIAL(v)) index += 1;
  return index;
};

export default function ResetPasswordPage() {
  const params = useSearchParams();
  const token = params.get('token') || '';
  const [validating, setValidating] = useState(true);
  const [valid, setValid] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [tokenError, setTokenError] = useState('');
  const [tokenChecked, setTokenChecked] = useState(false);

  const strength = strengthIndex(password);

  useEffect(() => {
    if (!token) {
      setTokenError('This reset link is missing or invalid.');
      setTokenChecked(true);
      setValidating(false);
      return;
    }

    setValidating(true);
    setError('');
    setTokenError('');

    authVerifyResetToken(token)
      .then((response: VerificationResponse) => {
        // `authVerifyResetToken` returns `{ valid: boolean, message: string }`
        // directly (not wrapped in `data`), so read the `valid` property
        // from the top-level response object.
        const isValid = Boolean(response?.valid);
        if (isValid) {
          setValid(true);
        } else {
          setTokenError('This reset link is invalid or has expired.');
          setValid(false);
        }
      })
      .catch(() => {
        setTokenError('We could not reach the server to verify this link. Please check your connection and try again.');
        setValid(false);
      })
      .finally(() => {
        setValidating(false);
        setTokenChecked(true);
      });
  }, [token]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setTokenError('');

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (!HAS_UPPERCASE(password)) {
      setError('Include at least one uppercase letter.');
      return;
    }
    if (!HAS_LOWERCASE(password)) {
      setError('Include at least one lowercase letter.');
      return;
    }
    if (!HAS_NUMBER(password)) {
      setError('Include at least one number.');
      return;
    }
    if (!HAS_SPECIAL(password)) {
      setError('Include at least one special character.');
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setBusy(true);
    try {
      await authResetPassword(token, password);
      // Clear sensitive values from state as soon as the reset succeeds.
      setPassword('');
      setConfirm('');
      setDone(true);
    } catch (err) {
      const apiError = err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Unable to reset password.';
      setError(apiError);
    } finally {
      setBusy(false);
    }
  };

  const clearTokenError = () => {
    setTokenError('');
    setValid(false);
    setTokenChecked(false);
  };

  return (
    <main className="auth-page">
      <div className="auth-layout" style={{ display: 'block', maxWidth: 560 }}>
        <div className="auth-mobile-logo" style={{ display: 'flex', marginBottom: 25 }}>
          <Link className="auth-logo" href="/">
            <span className="auth-logo-mark"><VantaLogo size={28} /></span>
            VANTA
          </Link>
        </div>
        <section className="auth-card" style={{ maxWidth: 'none', margin: 'auto' }}>
          {done ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <CheckCircle2 size={48} color="#62dfbd" style={{ margin: '0 auto 18px' }} />
              <h2>Password updated</h2>
              <p className="auth-hint" style={{ display: 'block', margin: '10px 0 25px' }}>
                Your account is secure again. You can now sign in with your new password.
              </p>
              <Link
                className="auth-submit"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}
                href="/login"
              >
                Back to login
              </Link>
            </div>
          ) : (
            <>
              <header>
                <span className="auth-kicker">VANTA / ACCOUNT RECOVERY</span>
                <h2>Set a new password</h2>
                <p>Create a strong password you will remember.</p>
              </header>

              {tokenChecked && !done ? (
                <div
                  className={validating ? 'auth-success' : 'auth-error'}
                  role={validating ? undefined : 'alert'}
                  style={{ marginBottom: 12 }}
                >
                  {validating ? (
                    <>
                      <Loader2 className="spin" size={14} /> Checking reset link…
                    </>
                  ) : tokenError ? (
                    <>
                      <X size={15} style={{ verticalAlign: '-3px', marginRight: 7 }} />
                      {tokenError}
                      <button
                        type="button"
                        onClick={clearTokenError}
                        className="ml-2 text-[#d6a83f]/60 hover:text-[#d6a83f] transition-colors"
                        style={{ marginLeft: 8 }}
                      >
                        Request a new link
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}

              {(error || validating) && (
                <div
                  className={validating ? 'auth-success' : 'auth-error'}
                  role={validating ? undefined : 'alert'}
                  style={{ marginBottom: 12 }}
                >
                  {validating ? (
                    <>
                      <Loader2 className="spin" size={14} />
                      {error ? error : 'Checking reset link…'}
                    </>
                  ) : (
                    <>
                      <X size={15} style={{ verticalAlign: '-3px', marginRight: 7 }} />
                      {error}
                    </>
                  )}
                </div>
              )}

              {valid && (
                <form className="auth-form" onSubmit={handleSubmit} style={{ marginTop: 16 }}>
                  <div className="auth-field">
                    <label htmlFor="new-password">New password</label>
                    <div className="auth-input-wrap">
                      <LockKeyhole size={16} />
                      <input
                        id="new-password"
                        type={show ? 'text' : 'password'}
                        className="auth-input has-action"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="At least 12 characters"
                        autoComplete="new-password"
                        aria-describedby="reset-password-strength"
                        required
                      />
                      <button
                        type="button"
                        className="auth-password-toggle"
                        onClick={() => setShow((s) => !s)}
                        aria-label={show ? 'Hide password' : 'Show password'}
                      >
                        {show ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    <div className="auth-strength-wrap" id="reset-password-strength" aria-live="polite">
                      <div className={`auth-strength strength-${strength}`} aria-hidden="true">
                        {[1, 2, 3, 4].map((level) => (
                          <i key={level} className={level <= strength ? 'on' : ''} />
                        ))}
                      </div>
                      <span>{strength < 2 ? 'Weak' : strength === 2 ? 'Medium' : 'Strong'}</span>
                    </div>
                    <ul className="auth-policy-hints" aria-hidden="true">
                      <li className={password.length >= MIN_PASSWORD_LENGTH ? 'met' : ''}>
                        {password.length >= MIN_PASSWORD_LENGTH ? '✓' : '•'} At least {MIN_PASSWORD_LENGTH} characters
                      </li>
                      {PASSWORD_POLICY_HINTS.map((hint) => (
                        <li key={hint.label} className={hint.test(password) ? 'met' : ''}>
                          {hint.test(password) ? '✓' : '•'} {hint.label}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="auth-field">
                    <label htmlFor="confirm-password">Confirm new password</label>
                    <div className="auth-input-wrap">
                      <LockKeyhole size={16} />
                      <input
                        id="confirm-password"
                        type={show ? 'text' : 'password'}
                        className="auth-input has-action"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        autoComplete="new-password"
                        required
                      />
                      <button
                        type="button"
                        className="auth-password-toggle"
                        onClick={() => setShow((s) => !s)}
                        aria-label={show ? 'Hide password' : 'Show password'}
                      >
                        {show ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  <button className="auth-submit" type="submit" disabled={busy}>
                    {busy ? (
                      <>
                        <Loader2 className="spin" size={16} /> Updating…
                      </>
                    ) : (
                      'Update password'
                    )}
                  </button>
                  <p style={{ marginTop: 8, fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                    Your password will change immediately. Any other signed-in sessions will be signed out.
                  </p>
                </form>
              )}
              <div className="auth-switch">
                <Link className="auth-link" href="/login">
                  <ArrowLeft size={13} style={{ verticalAlign: '-2px' }} /> Back to login
                </Link>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}