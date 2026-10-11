// @vitest-environment node
/**
 * Password-recovery API contract tests (frontend layer).
 *
 * The recovery pages (/forgot-password, /reset-password) rely on these three
 * helpers. These tests pin the wire contract with the backend:
 *   - forgot-password posts { email } and surfaces the GENERIC message so the
 *     UI can never differentiate registered vs unregistered accounts;
 *   - reset-password posts { token, newPassword } in the JSON BODY only —
 *     tokens and passwords must never appear in URLs;
 *   - verify-reset-token returns { valid, message } without throwing on an
 *     invalid token (the page shows an inline invalid-link state);
 *   - 4xx contract errors are NOT retried (a malformed request must fail fast).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authForgotPassword, authResetPassword, authVerifyResetToken } from './authApi';
import { ApiError, API_BASE_URL } from './api';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('password-recovery API helpers', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('authForgotPassword posts the email and returns the generic message', async () => {
    const generic = { message: 'If an account exists with this email, a password reset link will be sent' };
    (global.fetch as any).mockResolvedValue(jsonResponse(200, generic));

    const result = await authForgotPassword('User@Example.com');

    expect(result.message).toBe(generic.message);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [url, init] = (global.fetch as any).mock.calls[0];
    expect(url).toBe(`${API_BASE_URL}/api/auth/forgot-password`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ email: 'User@Example.com' });
  });

  it('authForgotPassword surfaces 4xx validation errors without retrying', async () => {
    (global.fetch as any).mockResolvedValue(jsonResponse(400, { error: 'Invalid email format' }));

    await expect(authForgotPassword('not-an-email')).rejects.toMatchObject({
      name: 'ApiError',
      statusCode: 400,
      message: 'Invalid email format',
    });
    // Client errors must fail fast — exactly one request.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('authVerifyResetToken returns { valid, message } without throwing on invalid tokens', async () => {
    (global.fetch as any).mockResolvedValue(
      jsonResponse(200, { valid: false, message: 'Token is invalid or expired' })
    );

    const result = await authVerifyResetToken('expired-token-value');

    expect(result.valid).toBe(false);
    expect(result.message).toBe('Token is invalid or expired');

    const [url, init] = (global.fetch as any).mock.calls[0];
    expect(url).toBe(`${API_BASE_URL}/api/auth/verify-reset-token`);
    expect(JSON.parse(init.body)).toEqual({ token: 'expired-token-value' });
  });

  it('authResetPassword sends token and new password in the BODY only — never in the URL', async () => {
    (global.fetch as any).mockResolvedValue(
      jsonResponse(200, { message: 'Password reset successfully' })
    );

    const token = 'raw-reset-token-abc123';
    const newPassword = 'N3w!SecurePassw0rd';
    const result = await authResetPassword(token, newPassword);

    expect(result.message).toBe('Password reset successfully');

    const [url, init] = (global.fetch as any).mock.calls[0];
    expect(url).toBe(`${API_BASE_URL}/api/auth/reset-password`);
    // The token and password must never leak into the request URL.
    expect(url).not.toContain(token);
    expect(url).not.toContain(newPassword);
    expect(url).not.toContain('?');
    expect(JSON.parse(init.body)).toEqual({ token, newPassword });
  });

  it('authResetPassword surfaces a 400 contract error (mismatch/weak password) exactly once', async () => {
    (global.fetch as any).mockResolvedValue(
      jsonResponse(400, { error: 'Passwords do not match' })
    );

    await expect(authResetPassword('tok', 'value')).rejects.toMatchObject({
      name: 'ApiError',
      statusCode: 400,
      message: 'Passwords do not match',
    } satisfies Partial<ApiError>);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('authResetPassword surfaces rate limiting (429) to the UI', async () => {
    (global.fetch as any).mockResolvedValue(
      jsonResponse(429, { error: 'Too many password reset attempts. Please try again later.', retryAfter: 120 })
    );

    await expect(authResetPassword('tok', 'value')).rejects.toMatchObject({
      statusCode: 429,
      message: 'Too many password reset attempts. Please try again later.',
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
