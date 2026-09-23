// =============================================================================
// VANTA — centralized user-facing error normalization
//
// Every caught error passes through here before it reaches the UI. The goal:
//
//     Backend error -> normalized application error -> contextual human message
//
// Raw implementation details (Prisma codes, HTTP-only jargon, stack traces,
// "Failed to fetch", "Internal Server Error") are translated into clear,
// actionable VANTA copy. Unknown/unexpected errors get a generic fallback; we
// never pretend to know the cause when we don't.
// =============================================================================

import { ApiError } from './api';

export interface FriendlyError {
  /** Short toast title (e.g. "Username unavailable"). */
  title: string;
  /** A clear, human, actionable sentence (may be used inline or in a dialog). */
  message: string;
  /** Stable machine-readable code when the backend provided one. */
  code?: string;
  /** HTTP status when the failure came from an API response. */
  statusCode?: number;
}

export interface FriendlyErrorOptions {
  /** Action that failed, in readable form (e.g. "create the channel"). */
  action?: string;
  /** Resource kind that failed (e.g. "channel", "group", "message"). */
  context?: string;
  /** Fallback message used only when nothing can be inferred. */
  fallback?: string;
  /** When true the raw backend message may pass through if it is already human. */
  trustBackendMessage?: boolean;
}

const NETWORK_TITLE = "Couldn't connect to VANTA";
const NETWORK_MESSAGE = 'Check your internet connection and try again.';
const SERVER_TITLE = 'Something went wrong';
const SERVER_MESSAGE = 'Please try again in a moment.';

// Contextual wording for duplicate names/usernames.
const alreadyInUseMessage = (context?: string): string => {
  switch (context) {
    case 'channel':
      return 'That channel name is already in use. Please choose another one.';
    case 'group':
      return 'That group name is already in use. Please choose another one.';
    case 'username':
    default:
      return 'That username is already in use. Please choose another one.';
  }
};

// Stable codes emitted by the VANTA backend (see backend/src/utils/api-error.ts).
const CODE_SPECIFIC: Record<string, { title: string; message: (context?: string) => string }> = {
  USERNAME_ALREADY_EXISTS: { title: 'Username unavailable', message: () => 'That username is already in use. Please choose another one.' },
  EMAIL_ALREADY_EXISTS: { title: 'Email unavailable', message: () => 'That email is already in use. Please sign in or use another email.' },
  NAME_ALREADY_EXISTS: { title: 'Name unavailable', message: alreadyInUseMessage },
  DUPLICATE: { title: 'Already added', message: () => 'That has already been added. No changes were made.' },
  UPLOAD_FILE_TOO_LARGE: { title: 'File too large', message: () => 'Please choose a smaller file and try again.' },
  UPLOAD_UNSUPPORTED_TYPE: { title: 'File type unsupported', message: () => 'That file type is not supported. Please choose a supported file.' },
  UPLOAD_FAILED: { title: 'Upload failed', message: () => 'The file could not be uploaded. Check your connection and try again.' },
  RATE_LIMITED: { title: 'Too fast', message: () => "You're doing that too quickly. Please wait a moment and try again." },
  INVALID_CREDENTIALS: { title: 'Sign in failed', message: () => 'Incorrect email/username or password.' },
  ACCOUNT_SUSPENDED: { title: 'Account suspended', message: () => 'Your account has been suspended. Please contact support.' },
  ACCOUNT_RESTRICTED: { title: 'Account restricted', message: () => 'Your account is currently restricted. Please contact support.' },
  FORBIDDEN: { title: 'Not allowed', message: () => "You don't have permission to perform this action." },
  NOT_FOUND: {
    title: 'Not available',
    message: (context?: string) =>
      context ? `This ${context} is no longer available.` : 'This content is no longer available.',
  },
  VALIDATION_ERROR: { title: 'Check the form', message: () => 'Please fix the highlighted fields and try again.' },
  CONFLICT: { title: 'Already done', message: () => 'That action has already been completed.' },
};

const isNetworkFailure = (error: unknown): boolean => {
  if (error instanceof ApiError) return error.statusCode === 0;
  if (error instanceof TypeError && /fetch/i.test(error.message)) return true;
  const raw = error instanceof Error ? error.message : '';
  return /failed to fetch|network error|connection (refused|reset|closed)|fetch failed/i.test(raw);
};

const looksRawServerMessage = (raw: string): boolean =>
  /P\d{4}|unique constraint|prisma|sqlite|postgres|stack trace|at \w+ \(/i.test(raw);
/**
 * Convert any caught error into a safe, human-friendly { title, message }.
 * Use everywhere a user can see a failure.
 */
export function friendlyError(error: unknown, options: FriendlyErrorOptions = {}): FriendlyError {
  const fallback: FriendlyError = {
    title: options.action ? `Couldn't ${options.action}` : SERVER_TITLE,
    message: options.fallback || SERVER_MESSAGE,
  };

  // Already-friendly errors (e.g. an earlier friendlyError result passed into
  // errorMessage/errorTitle) flow straight through unchanged.
  if (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as FriendlyError).title === 'string' &&
    typeof (error as FriendlyError).message === 'string'
  ) {
    return error as FriendlyError;
  }

  // --- Cancelled requests are not failures ----------------------------------
  if (error instanceof ApiError && (error.statusCode === 499 || (error.statusCode === 0 && /cancell?ed/i.test(error.message)))) {
    return { title: 'Request cancelled', message: error.message, code: 'CANCELLED', statusCode: error.statusCode };
  }

  // --- Server-provided stable code wins -------------------------------------
  if (error instanceof ApiError && typeof error.data?.code === 'string') {
    const code = error.data.code as string;
    const mapped = CODE_SPECIFIC[code];
    if (mapped) {
      return { title: mapped.title, message: mapped.message(options.context), code, statusCode: error.statusCode };
    }
  }

  // --- HTTP status based mapping ---------------------------------------------
  if (error instanceof ApiError) {
    const status = error.statusCode;
    const raw = error.message || '';

    if (status === 401) {
      return {
        title: 'Session expired',
        message: 'Please sign in again to continue.',
        code: 'UNAUTHORIZED',
        statusCode: status,
      };
    }
    if (status === 403) {
      return { title: 'Not allowed', message: "You don't have permission to perform this action.", code: 'FORBIDDEN', statusCode: status };
    }
    if (status === 404) {
      return {
        title: 'Not available',
        message: options.context ? `This ${options.context} is no longer available.` : 'This content is no longer available.',
        code: 'NOT_FOUND',
        statusCode: status,
      };
    }
    if (status === 409) {
      if (/username|handle/i.test(raw)) {
        return { title: 'Username unavailable', message: alreadyInUseMessage('username'), code: 'USERNAME_ALREADY_EXISTS', statusCode: status };
      }
      return { title: 'Already in use', message: alreadyInUseMessage(options.context), code: 'CONFLICT', statusCode: status };
    }
    if (status === 413) {
      return { title: 'File too large', message: 'Please choose a smaller file and try again.', code: 'UPLOAD_FILE_TOO_LARGE', statusCode: status };
    }
    if (status === 429) {
      return { title: 'Too fast', message: "You're doing that too quickly. Please wait a moment and try again.", code: 'RATE_LIMITED', statusCode: status };
    }
    if (status === 0) {
      return { title: NETWORK_TITLE, message: NETWORK_MESSAGE, code: 'NETWORK_ERROR', statusCode: status };
    }
    if (status >= 500) {
      return { title: SERVER_TITLE, message: SERVER_MESSAGE, code: 'INTERNAL_ERROR', statusCode: status };
    }
    // Other 4xx — keep a human message when the backend already speaks human.
    if (raw && !looksRawServerMessage(raw)) {
      return {
        title: options.action ? `Couldn't ${options.action}` : 'Not completed',
        message: raw.trim(),
        code: 'VALIDATION_ERROR',
        statusCode: status,
      };
    }
  }

  // --- Network failures come in many disguises -------------------------------
  if (isNetworkFailure(error)) {
    return { title: NETWORK_TITLE, message: NETWORK_MESSAGE, code: 'NETWORK_ERROR' };
  }

  // --- Raw backend/database markers that must never reach a user -------------
  if (error instanceof Error) {
    const raw = error.message || '';
    if (/already (exists|taken|in use)/i.test(raw)) {
      return { title: 'Already in use', message: alreadyInUseMessage(options.context), code: 'DUPLICATE' };
    }
    // Session problems are authentication failures, not "not found" — this must
    // run before the generic not-found rule below.
    if (/session (expired|not found|invalid|unauthorized)|invalid or expired token/i.test(raw)) {
      return { title: 'Session expired', message: 'Please sign in again to continue.', code: 'UNAUTHORIZED' };
    }
    if (/not found|no longer (available|exists)/i.test(raw)) {
      return {
        title: 'Not available',
        message: options.context ? `This ${options.context} is no longer available.` : 'This content is no longer available.',
        code: 'NOT_FOUND',
      };
    }
    // Raw Prisma unique-constraint output (e.g. P2002, "unique constraint
    // failed on the fields (`handle`)") surfaces a duplicate, not a stack.
    if (/P2002|unique constraint/i.test(raw)) {
      return { title: 'Already in use', message: alreadyInUseMessage(options.context), code: 'DUPLICATE' };
    }
    if (/don'?t have permission|do not have permission|not allowed|forbidden|only (the )?(channel |group |stream )?(owners?|admins?|administrators|moderators?|creators?|hosts?)|^unauthorized$/i.test(raw)) {
      return { title: 'Not allowed', message: "You don't have permission to perform this action.", code: 'FORBIDDEN' };
    }
    if (/too large/i.test(raw)) {
      return { title: 'File too large', message: 'Please choose a smaller file and try again.', code: 'UPLOAD_FILE_TOO_LARGE' };
    }
    if (/rate limit|too (many|quickly)/i.test(raw)) {
      return { title: 'Too fast', message: "You're doing that too quickly. Please wait a moment and try again.", code: 'RATE_LIMITED' };
    }
    if (/invalid email or password|invalid credentials/i.test(raw)) {
      return { title: 'Sign in failed', message: 'Incorrect email/username or password.', code: 'INVALID_CREDENTIALS' };
    }
    if (looksRawServerMessage(raw)) {
      return { title: SERVER_TITLE, message: SERVER_MESSAGE, code: 'INTERNAL_ERROR' };
    }
    if (raw.trim() && options.trustBackendMessage) {
      return { title: options.action ? `Couldn't ${options.action}` : 'Not completed', message: raw.trim() };
    }
  }

  return fallback;
}

/** Convenience: just the human message for inline/field errors. */
export function errorMessage(error: unknown, options: FriendlyErrorOptions = {}): string {
  return friendlyError(error, options).message;
}

/** Convenience: just the toast title. */
export function errorTitle(error: unknown, options: FriendlyErrorOptions = {}): string {
  return friendlyError(error, options).title;
}