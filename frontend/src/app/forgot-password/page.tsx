'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { ArrowLeft, Check, Loader2, Mail, X } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { authForgotPassword } from '@/lib/authApi';
import VantaLogo from '@/components/ui/VantaLogo';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Generic, privacy-preserving confirmation. This MUST NOT reveal whether the
// supplied email belongs to a registered account — the backend returns the
// same response either way, and the frontend mirrors it here.
const GENERIC_CONFIRMATION =
  "If an account exists with that email address, you'll receive instructions to reset your password.";

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    const normalized = email.trim().toLowerCase();
    if (!EMAIL_RE.test(normalized)) {
      setError('Enter a valid email address.');
      return;
    }

    setLoading(true);
    try {
      await authForgotPassword(normalized);
      setSent(true);
    } catch (err: unknown) {
      // Never surface whether the account exists. Only genuine client-side
      // validation/network failures produce an error here.
      if (err instanceof ApiError) {
        setError(err.message || 'Something went wrong. Please try again.');
      } else if (err instanceof Error) {
        setError(/network|fetch/i.test(err.message) ? 'Check your connection and try again.' : 'Something went wrong. Please try again.');
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-page">
      <div className="auth-shell">
        <Link className="auth-brand" href="/" aria-label="VANTA home">
          <VantaLogo size={27} showText />
        </Link>

        {sent ? (
          <div className="auth-header">
            <div className="auth-kicker">Check your inbox</div>
            <h1>Reset link sent</h1>
            <p>{GENERIC_CONFIRMATION}</p>
          </div>
        ) : (
          <div className="auth-header">
            <div className="auth-kicker">Account recovery</div>
            <h1>Forgot password</h1>
            <p>Enter the email tied to your VANTA account and we&apos;ll send you a secure link to choose a new password.</p>
          </div>
        )}

        {sent ? (
          <div className="auth-form">
            <div
              className="auth-error"
              style={{ borderColor: 'rgba(120,170,120,.22)', background: 'rgba(60,120,60,.10)', color: '#b7ddb7' }}
              role="status"
            >
              <Check size={14} aria-hidden="true" />
              <span>If an account exists with the address you provided, you&apos;ll receive a password reset link. The link expires in 1 hour and can be used once.</span>
            </div>
            <p className="auth-form-hint">
              Didn&apos;t receive the email? Check your spam folder, or{' '}
              <button type="button" className="auth-link" onClick={() => { setSent(false); setError(''); }}>
                try a different address
              </button>
              .
            </p>
            <Link className="auth-submit" href="/login">
              <span className="auth-submit-content">
                <ArrowLeft size={17} aria-hidden="true" /> Back to login
              </span>
            </Link>
          </div>
        ) : (
          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            {error && (
              <div className="auth-error" role="alert">
                <X size={13} aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <div className="auth-field">
              <label htmlFor="forgot-email">Email address</label>
              <div className={`auth-input-wrap ${error ? 'invalid' : ''}`}>
                <Mail size={17} aria-hidden="true" />
                <input
                  id="forgot-email"
                  type="email"
                  className="auth-input"
                  value={email}
                  onChange={(event) => { setEmail(event.target.value); setError(''); }}
                  placeholder="you@example.com"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                />
              </div>
            </div>

            <button className="auth-submit" type="submit" disabled={loading}>
              <span className="auth-submit-content">
                {loading ? (<><Loader2 className="spin" size={18} aria-hidden="true" /> Sending…</>) : 'Send reset link'}
              </span>
            </button>
          </form>
        )}

        <div className="auth-switch">
          <Link className="auth-link" href="/login">
            <ArrowLeft size={13} style={{ verticalAlign: '-2px' }} aria-hidden="true" /> Back to login
          </Link>
        </div>

        <footer className="auth-legal">
          <Link href="/terms">Terms</Link>
          <i aria-hidden="true" />
          <Link href="/privacy">Privacy</Link>
        </footer>
      </div>
    </main>
  );
}
