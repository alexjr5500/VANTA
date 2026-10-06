/**
 * VANTA Canonical Authentication Middleware — single source of truth.
 *
 * This module used to contain a second, parallel JWT implementation
 * (`authenticateJWT` / `optionallyAuthenticateJWT`). That duplication was a
 * security risk: the two paths could drift (session checks, expiry handling,
 * account-status enforcement), and a route "protected" by one middleware could
 * silently behave differently under the other.
 *
 * The canonical security layer lives in `src/security/authMiddleware.ts`. This
 * file is now a thin, behavior-preserving re-export shim so every existing
 * route/controller that imports `authenticateJWT`, `optionallyAuthenticateJWT`
 * or `AuthRequest` transparently uses the canonical implementation — no route
 * file needs to change and there is exactly ONE authentication code path.
 *
 *  authenticateJWT           == authenticate
 *  optionallyAuthenticateJWT == optionalAuth
 *  AuthRequest               == AuthenticatedRequest
 */
import {
  authenticate,
  optionalAuth,
  AuthenticatedRequest,
} from '../security/authMiddleware';
import type { Request, Response, NextFunction } from 'express';

// Canonical JWT auth: 401 when missing/invalid, 403 when suspended/banned,
// rejected when the exact session is revoked, expired or swapped.
export const authenticateJWT = authenticate;

// Canonical optional auth: sets req.user when a valid session is presented,
// otherwise continues anonymously (never fails the request).
export const optionallyAuthenticateJWT = optionalAuth;

// Type alias — keep the legacy identifier so controllers don't need churn.
export interface AuthRequest extends AuthenticatedRequest {}

// Re-export the canonical middleware types for convenience.
export type { Request, Response, NextFunction };

export default authenticate;
