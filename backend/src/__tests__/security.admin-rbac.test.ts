import { describe, expect, test } from '@jest/globals';
import { hasPermission, Permission, Role } from '../security/rbac';

describe('admin section permissions', () => {
  test('moderators can handle moderation but cannot access financial controls', () => {
    expect(hasPermission(Role.MODERATOR, Permission.VIEW_REPORTS)).toBe(true);
    expect(hasPermission(Role.MODERATOR, Permission.RESOLVE_REPORTS)).toBe(true);
    expect(hasPermission(Role.MODERATOR, Permission.MODERATE_CONTENT)).toBe(true);
    expect(hasPermission(Role.MODERATOR, Permission.VIEW_WALLET)).toBe(false);
    expect(hasPermission(Role.MODERATOR, Permission.PROCESS_WITHDRAWALS)).toBe(false);
    expect(hasPermission(Role.MODERATOR, Permission.MANAGE_ROLES)).toBe(false);
    expect(hasPermission(Role.MODERATOR, Permission.VIEW_AUDIT_LOGS)).toBe(false);
  });

  test('read-only section permissions do not grant management access', () => {
    expect(hasPermission(Role.ADMIN, Permission.READ_COINS)).toBe(true);
    expect(hasPermission(Role.ADMIN, Permission.READ_GIFTS)).toBe(true);
    expect(hasPermission(Role.ADMIN, Permission.READ_ADS)).toBe(true);
    expect(hasPermission(Role.MODERATOR, Permission.READ_COINS)).toBe(false);
    expect(hasPermission(Role.MODERATOR, Permission.READ_GIFTS)).toBe(false);
    expect(hasPermission(Role.MODERATOR, Permission.READ_ADS)).toBe(false);
  });

  test('admins can view system health without system configuration access', () => {
    expect(hasPermission(Role.ADMIN, Permission.VIEW_SYSTEM_HEALTH)).toBe(true);
    expect(hasPermission(Role.CEO, Permission.VIEW_SYSTEM_HEALTH)).toBe(true);
    expect(hasPermission(Role.SUPER_ADMIN, Permission.VIEW_SYSTEM_HEALTH)).toBe(true);
    expect(hasPermission(Role.MODERATOR, Permission.VIEW_SYSTEM_HEALTH)).toBe(false);
    expect(hasPermission(Role.ADMIN, Permission.SYSTEM_CONFIG)).toBe(false);
  });


  test('administrators retain explicit access to admin console sections', () => {
    expect(hasPermission(Role.ADMIN, Permission.VIEW_ADMIN_DASHBOARD)).toBe(true);
    expect(hasPermission(Role.ADMIN, Permission.MANAGE_GIFTS)).toBe(true);
    expect(hasPermission(Role.ADMIN, Permission.MANAGE_WALLET)).toBe(true);
    expect(hasPermission(Role.ADMIN, Permission.MANAGE_VERIFICATION)).toBe(true);
    expect(hasPermission(Role.CEO, Permission.MANAGE_VERIFICATION)).toBe(true);
    expect(hasPermission(Role.SUPER_ADMIN, Permission.MANAGE_VERIFICATION)).toBe(true);
    expect(hasPermission(Role.MODERATOR, Permission.MANAGE_VERIFICATION)).toBe(false);
    expect(hasPermission(Role.SUPER_ADMIN, Permission.MANAGE_ADS)).toBe(true);
  });
});
