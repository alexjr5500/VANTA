/**
 * Enterprise Role-Based Access Control for VANTA.
 * Enforces fine-grained permissions across all resources.
 */

export enum Role {
  USER = 'USER',
  CREATOR = 'CREATOR',
  MODERATOR = 'MODERATOR',
  ADMIN = 'ADMIN',
  /** Organization executive role stored by some existing deployments. */
  CEO = 'CEO',
  SUPER_ADMIN = 'SUPER_ADMIN',
}

export enum Permission {
  // User management
  READ_USER = 'read:user',
  UPDATE_USER = 'update:user',
  DELETE_USER = 'delete:user',
  
  // Profile
  READ_PROFILE = 'read:profile',
  UPDATE_PROFILE = 'update:profile',
  
  // Content
  CREATE_POST = 'create:post',
  READ_POST = 'read:post',
  UPDATE_POST = 'update:post',
  DELETE_POST = 'delete:post',
  CREATE_COMMENT = 'create:comment',
  DELETE_COMMENT = 'delete:comment',
  
  // Video
  CREATE_VIDEO = 'create:video',
  READ_VIDEO = 'read:video',
  UPDATE_VIDEO = 'update:video',
  DELETE_VIDEO = 'delete:video',
  
  // Live Streaming
  CREATE_STREAM = 'create:stream',
  MODERATE_STREAM = 'moderate:stream',
  
  // Messaging
  SEND_MESSAGE = 'send:message',
  READ_MESSAGE = 'read:message',
  DELETE_MESSAGE = 'delete:message',
  
  // Moderation
  MODERATE_CONTENT = 'moderate:content',
  MODERATE_USERS = 'moderate:users',
  VIEW_REPORTS = 'view:reports',
  RESOLVE_REPORTS = 'resolve:reports',
  
  // Administration
  MANAGE_ROLES = 'manage:roles',
  MANAGE_SETTINGS = 'manage:settings',
  VIEW_AUDIT_LOGS = 'view:audit_logs',
  MANAGE_BACKUPS = 'manage:backups',
  
  // System
  SYSTEM_CONFIG = 'system:config',
  SYSTEM_MAINTENANCE = 'system:maintenance',
  
  // Monetization
  MANAGE_PAYMENTS = 'manage:payments',
  VIEW_TRANSACTIONS = 'view:transactions',
  PROCESS_WITHDRAWALS = 'process:withdrawals',
  
  // GDPR
  EXPORT_DATA = 'export:data',
  DELETE_ACCOUNT = 'delete:account',

  // Compliance
  VIEW_COMPLIANCE_DASHBOARD = 'view:compliance_dashboard',
  MANAGE_POLICIES = 'manage:policies',
  MANAGE_CONSENT = 'manage:consent',

  // Admin console sections (separate read and management capabilities)
  VIEW_ADMIN_DASHBOARD = 'view:admin_dashboard',
  READ_CREATORS = 'read:creators',
  MANAGE_CREATORS = 'manage:creators',
  READ_COMMUNITIES = 'read:communities',
  VIEW_WALLET = 'view:wallet',
  MANAGE_WALLET = 'manage:wallet',
  MANAGE_COINS = 'manage:coins',
  MANAGE_GIFTS = 'manage:gifts',
  MANAGE_ADS = 'manage:ads',
  VIEW_ANALYTICS = 'view:analytics',
  VIEW_SYSTEM_LOGS = 'view:system_logs',
  VIEW_SYSTEM_HEALTH = 'view:system_health',
  READ_COINS = 'read:coins',
  READ_GIFTS = 'read:gifts',
  READ_ADS = 'read:ads',
  MANAGE_NOTIFICATIONS = 'manage:notifications',
  VIEW_FOLLOWER_REWARDS = 'view:follower_rewards',
  MANAGE_VERIFICATION = 'manage:verification',

  // Super Admin
  ALL = '*',
}

// Role-permission mappings
const rolePermissions: Record<Role, Permission[]> = {
  [Role.USER]: [
    Permission.READ_USER,
    Permission.UPDATE_USER,
    Permission.READ_PROFILE,
    Permission.UPDATE_PROFILE,
    Permission.CREATE_POST,
    Permission.READ_POST,
    Permission.UPDATE_POST,
    Permission.DELETE_POST,
    Permission.CREATE_COMMENT,
    Permission.CREATE_VIDEO,
    Permission.READ_VIDEO,
    Permission.UPDATE_VIDEO,
    Permission.DELETE_VIDEO,
    Permission.CREATE_STREAM,
    Permission.SEND_MESSAGE,
    Permission.READ_MESSAGE,
    Permission.DELETE_MESSAGE,
    Permission.EXPORT_DATA,
    Permission.DELETE_ACCOUNT,
  ],
  [Role.CREATOR]: [
    Permission.READ_USER,
    Permission.UPDATE_USER,
    Permission.READ_PROFILE,
    Permission.UPDATE_PROFILE,
    Permission.CREATE_POST,
    Permission.READ_POST,
    Permission.UPDATE_POST,
    Permission.DELETE_POST,
    Permission.CREATE_COMMENT,
    Permission.DELETE_COMMENT,
    Permission.CREATE_VIDEO,
    Permission.READ_VIDEO,
    Permission.UPDATE_VIDEO,
    Permission.DELETE_VIDEO,
    Permission.CREATE_STREAM,
    Permission.SEND_MESSAGE,
    Permission.READ_MESSAGE,
    Permission.DELETE_MESSAGE,
    Permission.EXPORT_DATA,
    Permission.DELETE_ACCOUNT,
    Permission.VIEW_TRANSACTIONS,
  ],
  [Role.MODERATOR]: [
    Permission.READ_USER,
    Permission.READ_PROFILE,
    Permission.READ_POST,
    Permission.READ_VIDEO,
    Permission.READ_MESSAGE,
    Permission.MODERATE_CONTENT,
    Permission.MODERATE_USERS,
    Permission.MODERATE_STREAM,
    Permission.VIEW_REPORTS,
    Permission.RESOLVE_REPORTS,
    Permission.DELETE_POST,
    Permission.DELETE_COMMENT,
    Permission.DELETE_VIDEO,
    Permission.DELETE_MESSAGE,
    Permission.VIEW_COMPLIANCE_DASHBOARD,
  ],
  [Role.ADMIN]: [
    Permission.READ_USER,
    Permission.UPDATE_USER,
    Permission.DELETE_USER,
    Permission.READ_PROFILE,
    Permission.UPDATE_PROFILE,
    Permission.READ_POST,
    Permission.DELETE_POST,
    Permission.READ_VIDEO,
    Permission.DELETE_VIDEO,
    Permission.MODERATE_CONTENT,
    Permission.MODERATE_USERS,
    Permission.MODERATE_STREAM,
    Permission.VIEW_REPORTS,
    Permission.RESOLVE_REPORTS,
    Permission.MANAGE_ROLES,
    Permission.MANAGE_SETTINGS,
    Permission.VIEW_AUDIT_LOGS,
    Permission.MANAGE_BACKUPS,
    Permission.MANAGE_PAYMENTS,
    Permission.VIEW_TRANSACTIONS,
    Permission.PROCESS_WITHDRAWALS,
    Permission.VIEW_COMPLIANCE_DASHBOARD,
    Permission.MANAGE_POLICIES,
    Permission.MANAGE_CONSENT,
    Permission.VIEW_ADMIN_DASHBOARD,
    Permission.READ_CREATORS,
    Permission.MANAGE_CREATORS,
    Permission.READ_COMMUNITIES,
    Permission.VIEW_WALLET,
    Permission.MANAGE_WALLET,
    Permission.MANAGE_COINS,
    Permission.READ_COINS,
    Permission.READ_GIFTS,
    Permission.READ_ADS,
    Permission.MANAGE_GIFTS,
    Permission.MANAGE_ADS,
    Permission.VIEW_ANALYTICS,
    Permission.VIEW_SYSTEM_LOGS,
    Permission.VIEW_SYSTEM_HEALTH,
    Permission.MANAGE_NOTIFICATIONS,
    Permission.VIEW_FOLLOWER_REWARDS,
    Permission.MANAGE_VERIFICATION,
  ],
  // CEO is an administrative role, but is intentionally not treated as a
  // SUPER_ADMIN wildcard. This preserves least privilege while allowing
  // executive accounts to use the admin area.
  [Role.CEO]: [
    Permission.READ_USER,
    Permission.UPDATE_USER,
    Permission.DELETE_USER,
    Permission.READ_PROFILE,
    Permission.UPDATE_PROFILE,
    Permission.READ_POST,
    Permission.DELETE_POST,
    Permission.READ_VIDEO,
    Permission.DELETE_VIDEO,
    Permission.MODERATE_CONTENT,
    Permission.MODERATE_USERS,
    Permission.MODERATE_STREAM,
    Permission.VIEW_REPORTS,
    Permission.RESOLVE_REPORTS,
    Permission.MANAGE_ROLES,
    Permission.MANAGE_SETTINGS,
    Permission.VIEW_AUDIT_LOGS,
    Permission.MANAGE_BACKUPS,
    Permission.MANAGE_PAYMENTS,
    Permission.VIEW_TRANSACTIONS,
    Permission.PROCESS_WITHDRAWALS,
    Permission.VIEW_COMPLIANCE_DASHBOARD,
    Permission.MANAGE_POLICIES,
    Permission.MANAGE_CONSENT,
    Permission.VIEW_ADMIN_DASHBOARD,
    Permission.READ_CREATORS,
    Permission.MANAGE_CREATORS,
    Permission.READ_COMMUNITIES,
    Permission.VIEW_WALLET,
    Permission.MANAGE_WALLET,
    Permission.MANAGE_COINS,
    Permission.READ_COINS,
    Permission.READ_GIFTS,
    Permission.READ_ADS,
    Permission.MANAGE_GIFTS,
    Permission.MANAGE_ADS,
    Permission.VIEW_ANALYTICS,
    Permission.VIEW_SYSTEM_LOGS,
    Permission.VIEW_SYSTEM_HEALTH,
    Permission.MANAGE_NOTIFICATIONS,
    Permission.VIEW_FOLLOWER_REWARDS,
    Permission.MANAGE_VERIFICATION,
  ],
  [Role.SUPER_ADMIN]: [
    Permission.ALL,
  ],
};

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  if (role === Role.SUPER_ADMIN) return true;
  const permissions = rolePermissions[role] || [];
  return permissions.includes(permission) || permissions.includes(Permission.ALL);
}

/**
 * Check if a role has all specified permissions
 */
export function hasAllPermissions(role: Role, permissions: Permission[]): boolean {
  return permissions.every(permission => hasPermission(role, permission));
}

/**
 * Check if a role has any of the specified permissions
 */
export function hasAnyPermission(role: Role, permissions: Permission[]): boolean {
  return permissions.some(permission => hasPermission(role, permission));
}

/**
 * Get all permissions for a role
 */
export function getPermissionsForRole(role: Role): Permission[] {
  if (role === Role.SUPER_ADMIN) {
    return Object.values(Permission);
  }
  return [...(rolePermissions[role] || [])];
}

/**
 * Get all available roles
 */
export function getAllRoles(): Role[] {
  return Object.values(Role);
}

/**
 * Convert string to Role enum
 */
export function parseRole(role: string): Role {
  const upper = role.toUpperCase();
  // Keep compatibility with role names used by older/admin deployments.
  if (upper === 'ADMINISTRATOR') return Role.ADMIN;
  if (Object.values(Role).includes(upper as Role)) {
    return upper as Role;
  }
  return Role.USER;
}

/**
 * Prevent mid-level administrators from changing the role of an existing
 * privileged account. Checking only the requested role is insufficient:
 * without checking the target's current role, an ADMIN could demote a
 * SUPER_ADMIN or CEO to USER and remove their privileges.
 */
export function canManageRole(actorRole: string, currentRole: string, nextRole: string): boolean {
  const actor = actorRole.toUpperCase();
  const current = currentRole.toUpperCase();
  const next = nextRole.toUpperCase();

  if ((current === Role.SUPER_ADMIN || current === Role.CEO) && actor !== Role.SUPER_ADMIN) return false;
  if (current === Role.ADMIN && actor !== Role.SUPER_ADMIN && actor !== Role.CEO) return false;
  if ((next === Role.SUPER_ADMIN || next === Role.CEO) && actor !== Role.SUPER_ADMIN) return false;
  if (next === Role.ADMIN && actor !== Role.SUPER_ADMIN && actor !== Role.CEO) return false;

  return true;
}
