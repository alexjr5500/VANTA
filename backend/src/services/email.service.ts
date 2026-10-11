/**
 * VANTA transactional email service (password recovery).
 *
 * Transport selection (in priority order):
 *  1. SendGrid  — when `SENDGRID_API_KEY` and `EMAIL_FROM_ADDRESS` are set.
 *                 Sends via the SendGrid v3 REST API (`https://api.sendgrid.com
 *                 /v3/mail/send`) using Node's global fetch — no additional
 *                 npm dependency, no extra services.
 *  2. Console   — ONLY when `EMAIL_TRANSPORT=console` AND `NODE_ENV !==
 *                 'production'`. Prints the rendered email to stdout so local
 *                 development can inspect delivery. Refused in production.
 *  3. None      — unconfigured. Returns `delivered:false` and logs a generic
 *                 warning (never the email body, never recovery URLs) so the
 *                 caller can invalidate the just-issued token instead of
 *                 leaving falsely-issued recovery links outstanding.
 *
 * Security invariants:
 *   - API keys live ONLY in server-side env vars; never exposed to the
 *     frontend, never logged.
 *   - Raw recovery tokens and full recovery URLs are never written to logs.
 *   - Sender identity is always VANTA via EMAIL_FROM_NAME / EMAIL_FROM_ADDRESS.
 */
import fs from 'fs';
import path from 'path';

export interface RecoveryEmailContext {
  to: string;
  resetUrl: string;
  expiresInMinutes: number;
}

export interface PasswordChangedEmailContext {
  to: string;
  /** Set when the change was NOT initiated by the account owner (e.g. a reset). */
  reset?: boolean;
}

export interface SendResult {
  delivered: boolean;
  transport: 'sendgrid' | 'console' | 'none';
  /** Human-safe failure detail (HTTP status / short error). Never includes tokens or secrets. */
  reason?: string;
}

interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildPasswordResetEmailText(ctx: RecoveryEmailContext): string {
  return [
    'VANTA — Reset your password',
    '',
    `We received a request to reset the password for the VANTA account associated with ${ctx.to}.`,
    '',
    'Reset your password now:',
    ctx.resetUrl,
    '',
    `For your security, this link expires in ${ctx.expiresInMinutes} minutes and can only be used once.`,
    '',
    'If you did not request a password reset, no action is needed — you can safely ignore this email and your password will not change.',
    '',
    '© VANTA. Do not reply to this automated email.',
  ].join('\n');
}

export function buildPasswordResetEmailHtml(ctx: RecoveryEmailContext): string {
  const email = escapeHtml(ctx.to);
  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#0b0b0d;font-family:Inter,Arial,sans-serif;color:#f3f3f1;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b0d;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;border:1px solid rgba(255,255,255,.08);border-radius:16px;background:#111114;overflow:hidden;">
          <tr><td style="padding:28px 28px 8px;">
            <div style="font-size:12px;letter-spacing:.18em;color:#c7a447;font-weight:700;">VANTA</div>
          </td></tr>
          <tr><td style="padding:8px 28px 4px;">
            <h1 style="margin:0;font-size:20px;font-weight:650;letter-spacing:.01em;">Reset your password</h1>
          </td></tr>
          <tr><td style="padding:8px 28px 20px;">
            <p style="margin:0 0 10px;font-size:13px;line-height:1.6;color:#aaa9a5;">
              We received a request to reset the password for the VANTA account associated with
              <strong style="color:#f3f3f1;">${email}</strong>.
            </p>
            <p style="margin:0 0 18px;font-size:13px;line-height:1.6;color:#aaa9a5;">
              Use the button below to create a new password. For your security, this link expires in
              <strong style="color:#f3f3f1;">${ctx.expiresInMinutes} minutes</strong> and can only be used once.
            </p>
            <p style="margin:0 0 6px;">
              <a href="${ctx.resetUrl}" style="display:inline-block;padding:12px 22px;border-radius:10px;background:#c7a447;color:#0b0b0d;text-decoration:none;font-size:13px;font-weight:700;">Reset password</a>
            </p>
          </td></tr>
          <tr><td style="padding:0 28px 22px;">
            <p style="margin:0;font-size:11px;line-height:1.6;color:#717175;">
              If you did not request a password reset, no action is needed — you can safely ignore this
              email and your password will not change.
            </p>
            <p style="margin:12px 0 0;font-size:10px;color:#55555a;">© VANTA. Do not reply to this automated email.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function buildPasswordChangedEmailText(ctx: PasswordChangedEmailContext): string {
  const lines = [
    'VANTA — Your password was changed',
    '',
    `The password for the VANTA account associated with ${ctx.to} was changed successfully.`,
    '',
  ];
  if (ctx.reset) {
    lines.push(
      'If you did not make this change (for example, you used the "Forgot password" recovery flow or someone else did),',
      'please contact VANTA support immediately and sign out of all your devices.',
      ''
    );
  } else {
    lines.push(
      'If you did not make this change, please contact VANTA support immediately and sign out of all your devices.',
      ''
    );
  }
  lines.push('© VANTA. Do not reply to this automated email.');
  return lines.join('\n');
}

export function buildPasswordChangedEmailHtml(ctx: PasswordChangedEmailContext): string {
  const email = escapeHtml(ctx.to);
  const guidance = ctx.reset
    ? 'If you did not make this change (for example you used the "Forgot password" recovery flow or someone else did), please contact VANTA support immediately and sign out of all your devices.'
    : 'If you did not make this change, please contact VANTA support immediately and sign out of all your devices.';
  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#0b0b0d;font-family:Inter,Arial,sans-serif;color:#f3f3f1;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b0d;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;border:1px solid rgba(255,255,255,.08);border-radius:16px;background:#111114;overflow:hidden;">
          <tr><td style="padding:28px 28px 8px;">
            <div style="font-size:12px;letter-spacing:.18em;color:#c7a447;font-weight:700;">VANTA</div>
          </td></tr>
          <tr><td style="padding:8px 28px 4px;">
            <h1 style="margin:0;font-size:20px;font-weight:650;letter-spacing:.01em;">Your password was changed</h1>
          </td></tr>
          <tr><td style="padding:8px 28px 20px;">
            <p style="margin:0 0 10px;font-size:13px;line-height:1.6;color:#aaa9a5;">
              The password for the VANTA account associated with <strong style="color:#f3f3f1;">${email}</strong>
              was changed successfully.
            </p>
            <p style="margin:0;font-size:12px;line-height:1.6;color:#717175;">${escapeHtml(guidance)}</p>
          </td></tr>
          <tr><td style="padding:0 28px 22px;">
            <p style="margin:0;font-size:10px;color:#55555a;">© VANTA. Do not reply to this automated email.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}
// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

function appName(): string {
  return process.env.EMAIL_FROM_NAME || 'VANTA';
}

function emailFromAddress(): string {
  return process.env.EMAIL_FROM_ADDRESS || '';
}

/**
 * Keys that are obviously placeholders (docs/env examples / dev stubs). Values
 * like this must NOT be treated as a configured provider — they would produce
 * confusing 401 failures instead of a clear "not configured" message.
 */
const SENDGRID_PLACEHOLDER_KEYS = new Set(['your-sendgrid-api-key', 'your-sendgrid-key', 'change-me', '']);

function sendgridConfigured(): boolean {
  const apiKey = (process.env.SENDGRID_API_KEY || '').trim();
  return Boolean(apiKey && !SENDGRID_PLACEHOLDER_KEYS.has(apiKey) && emailFromAddress());
}

function consoleTransportRequested(): boolean {
  return process.env.EMAIL_TRANSPORT === 'console';
}

async function sendViaSendgrid(message: EmailMessage): Promise<SendResult> {
  const apiKey = process.env.SENDGRID_API_KEY as string;
  const fromEmail = emailFromAddress();
  const timeoutMs = parseInt(process.env.EMAIL_TIMEOUT_MS || '10000', 10);

  const payload = {
    personalizations: [{ to: [{ email: message.to }] }],
    from: { email: fromEmail, name: appName() },
    subject: message.subject,
    content: [
      { type: 'text/plain', value: message.text },
      { type: 'text/html', value: message.html },
    ],
  };

  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'VANTA-backend/1.0',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });

    // SendGrid returns 202 Accepted for a successfully queued message.
    if (response.status === 202) {
      return { delivered: true, transport: 'sendgrid' };
    }

    let detail = '';
    try {
      detail = (await response.text()).slice(0, 300);
    } catch {
      /* body may be empty */
    }
    return {
      delivered: false,
      transport: 'none',
      reason: `sendgrid-http-${response.status}${detail ? `:${detail}` : ''}`,
    };
  } catch (error) {
    return {
      delivered: false,
      transport: 'none',
      reason: `sendgrid-network:${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}`,
    };
  }
}

async function sendViaConsole(message: EmailMessage): Promise<SendResult> {
  if (process.env.NODE_ENV === 'production') {
    return { delivered: false, transport: 'console', reason: 'console-transport-refused-in-production' };
  }
  // Dev-only echo. Emails are printed BETWEEN two markers so developers can
  // read the rendered template (recovery link included) while iterating.
  try {
    const logPath = process.env.EMAIL_DEV_LOG_FILE || '';
    const rendered = `-----VANTA DEV EMAIL-----\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n-----END VANTA DEV EMAIL-----\n`;
    if (logPath) {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, rendered, 'utf8');
    } else {
      // eslint-disable-next-line no-console
      console.log(rendered);
    }
  } catch {
    return { delivered: false, transport: 'console', reason: 'console-write-failed' };
  }
  return { delivered: true, transport: 'console' };
}

// ---------------------------------------------------------------------------
// Public service
// ---------------------------------------------------------------------------

export class EmailService {
  isConfigured(): boolean {
    return sendgridConfigured() || (consoleTransportRequested() && process.env.NODE_ENV !== 'production');
  }

  async sendPasswordResetEmail(ctx: RecoveryEmailContext): Promise<SendResult> {
    const message: EmailMessage = {
      to: ctx.to,
      subject: 'VANTA — Reset your password',
      text: buildPasswordResetEmailText(ctx),
      html: buildPasswordResetEmailHtml(ctx),
    };
    return this.dispatch(message);
  }

  async sendPasswordChangedEmail(ctx: PasswordChangedEmailContext): Promise<SendResult> {
    const message: EmailMessage = {
      to: ctx.to,
      subject: 'VANTA — Your password was changed',
      text: buildPasswordChangedEmailText(ctx),
      html: buildPasswordChangedEmailHtml(ctx),
    };
    return this.dispatch(message);
  }

  private async dispatch(message: EmailMessage): Promise<SendResult> {
    if (sendgridConfigured()) {
      return sendViaSendgrid(message);
    }

    if (consoleTransportRequested()) {
      if (process.env.NODE_ENV === 'production') {
        console.error('[EMAIL] EMAIL_TRANSPORT=console is not allowed in production; no email was delivered.');
        return { delivered: false, transport: 'console', reason: 'console-transport-refused-in-production' };
      }
      // Dev-only delivery. The message body may contain a recovery URL, so
      // this branch is gated to non-production + explicit opt-in.
      return sendViaConsole(message);
    }

    // Unconfigured: refuse silently (never fabricate a send) and report the
    // generic failure so callers can invalidate any token they just issued.
    console.warn('[EMAIL] Email delivery is not configured (set SENDGRID_API_KEY/EMAIL_FROM_ADDRESS or EMAIL_TRANSPORT=console for dev).');
    return { delivered: false, transport: 'none', reason: 'email-not-configured' };
  }
}

export const emailService = new EmailService();