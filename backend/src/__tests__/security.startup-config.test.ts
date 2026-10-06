/**
 * Phase 2 — fail-closed startup security configuration.
 * In production, missing critical secrets OR known development defaults must
 * abort server startup (never boot with forgeable/guessable credentials).
 */
import { enforceSecretPolicy, validateProductionSecrets } from '../security/startupValidation';
import { describe, expect, test, jest } from '@jest/globals';

const PROD_GOOD = {
  NODE_ENV: 'production',
  JWT_SECRET: 'str0ng-access-secret-0123456789abcdef',
  JWT_REFRESH_SECRET: 'str0ng-refresh-secret-0123456789abcdef',
  ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
};

describe('enforceSecretPolicy (fail closed)', () => {
  test('aborts production startup when JWT_SECRET is missing', () => {
    expect(() => enforceSecretPolicy({ ...PROD_GOOD, JWT_SECRET: undefined })).toThrow('missing required secrets: JWT_SECRET');
  });

  test('aborts production startup when a development default JWT_SECRET is used', () => {
    expect(() => enforceSecretPolicy({ ...PROD_GOOD, JWT_SECRET: 'change-this-to-a-strong-random-secret-in-production' })).toThrow(/must never be used in production/);
    expect(() => enforceSecretPolicy({ ...PROD_GOOD, JWT_SECRET: 'fallback_secret' })).toThrow(/must never be used in production/);
  });

  test('aborts production startup when JWT_REFRESH_SECRET is missing', () => {
    expect(() => enforceSecretPolicy({ ...PROD_GOOD, JWT_REFRESH_SECRET: undefined })).toThrow('missing required secrets: JWT_REFRESH_SECRET');
  });

  test('aborts production startup when ENCRYPTION_KEY is missing', () => {
    expect(() => enforceSecretPolicy({ ...PROD_GOOD, ENCRYPTION_KEY: undefined })).toThrow('missing required secrets: ENCRYPTION_KEY');
  });

  test('returns ok=true when all production secrets are strong', () => {
    const result = validateProductionSecrets(PROD_GOOD);
    expect(result.ok).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.weak).toHaveLength(0);
  });

  test('development mode has ok=true even with missing secrets', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = validateProductionSecrets({ NODE_ENV: 'development' });
      expect(result.isProduction).toBe(false);
      expect(result.ok).toBe(true);
      expect(() => enforceSecretPolicy({ NODE_ENV: 'development' })).not.toThrow();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
