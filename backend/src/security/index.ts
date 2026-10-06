/**
 * VANTA Enterprise Security Module
 * 
 * Central export point for all security components.
 * Provides a unified security layer for the entire platform.
 */
export { config } from './config';
export { CryptoUtils } from './crypto';
export { validateProductionSecrets, enforceSecretPolicy } from './startupValidation';
import { enforceSecretPolicy } from './startupValidation';
export { SecurityValidator, validateRequest, ValidationRule } from './validation';
export { Role, Permission, hasPermission, hasAllPermissions, hasAnyPermission, getPermissionsForRole, parseRole } from './rbac';
export { rateLimiter } from './rateLimiter';
export { auditLog } from './auditLog';
export { botProtection } from './botProtection';
export { CSRFProtection, doubleSubmitCookie } from './csrf';
export { UploadSecurity } from './uploadSecurity';
export { twoFactorAuth, TwoFactorAuth, TwoFactorSetupResult, TwoFactorVerifyResult } from './twoFactorAuth';
export {
  authenticate,
  optionalAuth,
  requirePermission,
  requireRole,
  checkLoginAttempts,
  requireEmailVerified,
  requireTwoFactorEnabled,
  securityLog,
  AuthenticatedRequest,
} from './authMiddleware';
export {
  authenticateSocket,
  createSecuredEventHandler,
  authorizeRoom,
  EventSubscriptionManager,
  eventSubscriptionManager,
  handleConnect,
  handleDisconnect,
} from './webSocketSecurity';
export { sessionManager, SessionManager, TokenPair } from './sessionManager';
export { GDPRCompliance } from './gdpr';
export { SecurityMonitoring } from './monitoring';
export { PaymentSecurity } from './paymentSecurity';
export { BackupManager } from './backupManager';
export { DevSecOps } from './devsecops';

/**
 * Initialize all security middleware.
 * This should be called once during server startup.
 *
 * PHASE 2 (fail closed): in production, missing critical secrets or known
 * development defaults ABORT startup. The backend must never boot with a
 * predictable JWT secret, an unset refresh secret or AES key — that would let
 * an attacker forge sessions or decrypt sensitive stored data.
 */
export async function initializeSecurity(): Promise<void> {
  // Fail closed on misconfigured production secrets.
  enforceSecretPolicy();

  // Check password hashing cost
  const bcryptRounds = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);
  if (bcryptRounds < 10) {
    console.warn('[SECURITY] BCRYPT_ROUNDS is too low. Set to at least 10 for production.');
  }
}
