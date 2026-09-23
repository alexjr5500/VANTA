import { Response } from "express";
import multer from "multer";

/**
 * Centralized API error normalization for VANTA.
 *
 * Every user-facing error crosses this layer so that raw implementation
 * details (Prisma codes, SQL, stack traces, internal service names) can never
 * reach a client. Known failures are mapped to stable machine-readable codes
 * plus human messages; only genuinely unexpected failures fall back to a
 * generic "something went wrong" message (while full diagnostics are logged
 * server-side for operators).
 */

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "DUPLICATE"
  | "USERNAME_ALREADY_EXISTS"
  | "EMAIL_ALREADY_EXISTS"
  | "NAME_ALREADY_EXISTS"
  | "UPLOAD_FILE_TOO_LARGE"
  | "UPLOAD_UNSUPPORTED_TYPE"
  | "UPLOAD_FAILED"
  | "RATE_LIMITED"
  | "PAYMENT_REQUIRED"
  | "CONFLICT"
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_SUSPENDED"
  | "ACCOUNT_RESTRICTED"
  | "SESSION_EXPIRED"
  | "NETWORK_ERROR"
  | "INTERNAL_ERROR"
  | string;

export interface NormalizedError {
  statusCode: number;
  code: ErrorCode;
  message: string;
}

/** An error that already carries a user-safe status/message/code. */
export class AppError extends Error {
  public statusCode: number;
  public code: ErrorCode;
  public details?: unknown;

  constructor(statusCode: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/** Convenience factories that read well at call sites. */
export const badRequest = (code: ErrorCode, message: string, details?: unknown) =>
  new AppError(400, code, message, details);
export const unauthorized = (code: ErrorCode = "UNAUTHORIZED", message = "Please sign in to continue.") =>
  new AppError(401, code, message);
export const forbidden = (code: ErrorCode = "FORBIDDEN", message = "You don't have permission to perform this action.") =>
  new AppError(403, code, message);
export const notFound = (code: ErrorCode, message: string) => new AppError(404, code, message);
export const conflict = (code: ErrorCode, message: string, details?: unknown) =>
  new AppError(409, code, message, details);

const isPrismaError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  typeof (error as { code?: unknown }).code === "string" &&
  /^P\d+$/.test((error as { code: string }).code);

const prismaErrorCode = (error: unknown): string => (error as { code: string }).code;

/**
 * Determine whether a thrown error should map to a specific HTTP status and a
 * user-safe message. Order matters: explicit `AppError`s first, then
 * infrastructure errors (Prisma / Multer / body parse), then recognizable
 * human messages thrown by our services, then the generic fallback.
 */
export function normalizeError(error: unknown, fallbackStatus = 500): NormalizedError {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
    };
  }

  const message = error instanceof Error ? error.message : "";

  // --- Prisma / database ----------------------------------------------------
  if (isPrismaError(error)) {
    switch (prismaErrorCode(error)) {
      case "P2002":
        return {
          statusCode: 409,
          code: "DUPLICATE",
          message: "That name or username is already in use. Please choose another one.",
        };
      case "P2025":
      case "P2018":
        return { statusCode: 404, code: "NOT_FOUND", message: GENERIC_NOT_FOUND_MESSAGE };
      case "P2003":
        return { statusCode: 400, code: "VALIDATION_ERROR", message: "That request references something that no longer exists." };
      default:
        return { statusCode: 500, code: "INTERNAL_ERROR", message: GENERIC_SERVER_MESSAGE };
    }
  }

  // --- Multer / file upload -------------------------------------------------
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return {
        statusCode: 413,
        code: "UPLOAD_FILE_TOO_LARGE",
        message: "That file is too large. Please choose a smaller file.",
      };
    }
    if (error.code === "LIMIT_UNEXPECTED_FILE") {
      return {
        statusCode: 400,
        code: "UPLOAD_UNSUPPORTED_TYPE",
        message: "That file type isn't supported. Please choose another file.",
      };
    }
    return { statusCode: 400, code: "UPLOAD_FAILED", message: "The file could not be uploaded. Please try again." };
  }

  // --- Recognizable service messages (keep the API human) -------------------
  if (message) {
    // Session problems are authentication failures, not "not found" — check
    // before the generic not-found rule below.
    if (/session (expired|not found|invalid|unauthorized)|invalid or expired token/i.test(message)) {
      return { statusCode: 401, code: "UNAUTHORIZED", message: "Please sign in again to continue." };
    }
    if (/email or username already exists|email already exists/i.test(message)) {
      return { statusCode: 409, code: "EMAIL_ALREADY_EXISTS", message: "That email or username is already in use." };
    }
    if (/username already exists/i.test(message)) {
      return { statusCode: 409, code: "USERNAME_ALREADY_EXISTS", message: "That username is already in use. Please choose another one." };
    }
    if (/channel name already exists|group name already exists|name already exists/i.test(message)) {
      return { statusCode: 409, code: "NAME_ALREADY_EXISTS", message: "That name is already in use. Please choose another one." };
    }
    if (/already (exists|in use|joined|following|a member)/i.test(message)) {
      return { statusCode: 409, code: "CONFLICT", message: "That action has already been completed." };
    }
    if (/account suspended/i.test(message)) {
      return { statusCode: 403, code: "ACCOUNT_SUSPENDED", message: "Your account has been suspended. Please contact support." };
    }
    if (/not found|does not exist|no longer (available|exists)/i.test(message)) {
      return { statusCode: 404, code: "NOT_FOUND", message: GENERIC_NOT_FOUND_MESSAGE };
    }
    // Bare "Unauthorized" from our services is an ownership/role check on an
    // authenticated user — that is a 403 (permission), not a 401 (sign in).
    if (/^unauthorized$/i.test(message)) {
      return { statusCode: 403, code: "FORBIDDEN", message: "You don't have permission to perform this action." };
    }
    // "Only channel administrators can ...", "Only the group owner can ...",
    // "You do not have permission to ...", "You don't have permission to ...",
    // etc.
    if (/don'?t have permission|do not have permission|not allowed|forbidden|only (the )?(channel |group |stream )?(owners?|admins?|administrators|moderators?|creators?|hosts?)/i.test(message)) {
      return { statusCode: 403, code: "FORBIDDEN", message: "You don't have permission to perform this action." };
    }
    if (/too (many|quickly)|rate limit/i.test(message)) {
      return { statusCode: 429, code: "RATE_LIMITED", message: "You're doing that too quickly. Please wait a moment and try again." };
    }
    if (/too large/i.test(message)) {
      return { statusCode: 413, code: "UPLOAD_FILE_TOO_LARGE", message: "That file is too large. Please choose a smaller file." };
    }
    if (/required|must be|invalid|at least/i.test(message)) {
      return { statusCode: 400, code: "VALIDATION_ERROR", message };
    }
  }

  // --- Unexpected -----------------------------------------------------------
  return { statusCode: fallbackStatus, code: "INTERNAL_ERROR", message: GENERIC_SERVER_MESSAGE };
}
const GENERIC_SERVER_MESSAGE =
  "Something went wrong on our end. Please try again in a moment.";
const GENERIC_NOT_FOUND_MESSAGE = "This content is no longer available.";
export interface SendErrorOptions {
  /** Extra server-side context (never sent to the client). */
  diagnostic?: Record<string, unknown>;
}

/**
 * Write a normalized JSON error response and log full diagnostics server-side.
 * The client only ever sees `{ error, code }` — never stack traces, Prisma
 * internals, SQL, paths, or environment details.
 */
export function sendError(res: Response, error: unknown, options: SendErrorOptions = {}): void {
  const normalized = normalizeError(error);

  if (normalized.statusCode >= 500) {
    const diagnostic = error instanceof Error ? error : new Error("Unknown failure");
    console.error(
      `[API:${normalized.code}] ${diagnostic.message}\n`,
      JSON.stringify({
        path: (res.req as { path?: string })?.path,
        method: res.req?.method,
        diagnostic: options.diagnostic,
        stack: process.env.NODE_ENV === "development" ? diagnostic.stack : undefined,
      })
    );
  }

  res.status(normalized.statusCode).json({
    error: normalized.message,
    code: normalized.code,
  });
}