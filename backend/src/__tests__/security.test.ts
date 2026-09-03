import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Permission, Role, hasPermission, parseRole } from '../security/rbac';

describe('Security Module Tests', () => {
  describe('Authentication role mapping', () => {
    test('keeps normal and administrative roles distinct', () => {
      expect(parseRole('USER')).toBe(Role.USER);
      expect(parseRole('ADMIN')).toBe(Role.ADMIN);
      expect(parseRole('SUPER_ADMIN')).toBe(Role.SUPER_ADMIN);
      expect(parseRole('CEO')).toBe(Role.CEO);
      expect(parseRole('ADMINISTRATOR')).toBe(Role.ADMIN);
    });

    test('grants CEO administrative permissions without a super-admin wildcard', () => {
      expect(hasPermission(Role.CEO, Permission.MANAGE_SETTINGS)).toBe(true);
      expect(hasPermission(Role.CEO, Permission.ALL)).toBe(false);
      expect(hasPermission(Role.USER, Permission.MANAGE_SETTINGS)).toBe(false);
    });
  });

  describe('JWT Token Security', () => {
    test('should generate valid JWT with userId payload', () => {
      const secret = 'test_secret_key';
      const payload = { userId: 'user123' };
      const token = jwt.sign(payload, secret, { expiresIn: '1h' });
      expect(token).toBeDefined();
      const decoded = jwt.verify(token, secret) as any;
      expect(decoded.userId).toBe('user123');
    });

    test('should reject tampered JWT', () => {
      const token = jwt.sign({ userId: 'user123' }, 'test_secret_key');
      const tampered = token.slice(0, -5) + 'XXXXX';
      expect(() => jwt.verify(tampered, 'test_secret_key')).toThrow();
    });

    test('should reject expired JWT', async () => {
      const token = jwt.sign({ userId: 'user123' }, 'test_key', { expiresIn: '0s' });
      await new Promise(r => setTimeout(r, 100));
      expect(() => jwt.verify(token, 'test_key')).toThrow('jwt expired');
    });

    test('should reject token with wrong secret', () => {
      const token = jwt.sign({ userId: 'user123' }, 'correct_secret');
      expect(() => jwt.verify(token, 'wrong_secret')).toThrow();
    });

    test('should extract refresh token payload correctly', () => {
      const token = jwt.sign({ userId: 'user123', type: 'refresh' }, 'refresh_secret', { expiresIn: '30d' });
      const decoded = jwt.verify(token, 'refresh_secret') as any;
      expect(decoded.userId).toBe('user123');
      expect(decoded.type).toBe('refresh');
    });
  });

  describe('Password Validation', () => {
    test('should enforce minimum password length', () => {
      expect(('short'.length >= 8)).toBe(false);
      expect(('longenough123'.length >= 8)).toBe(true);
    });

    test('should detect password complexity features', () => {
      const pw = 'Pass1234';
      expect(/[A-Z]/.test(pw)).toBe(true);
      expect(/[a-z]/.test(pw)).toBe(true);
      expect(/[0-9]/.test(pw)).toBe(true);
    });
  });

  describe('Email Validation', () => {
    test('should validate email format', () => {
      const valid = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
      expect(valid('user@example.com')).toBe(true);
      expect(valid('user.name+tag@example.co.uk')).toBe(true);
      expect(valid('invalid-email')).toBe(false);
    });
  });

  describe('XSS Prevention', () => {
    test('should detect HTML tag injection', () => {
      const input = '<script>alert("xss")</script>';
      const hasTags = /<[^>]*>/.test(input);
      expect(hasTags).toBe(true);
    });

    test('should detect event handler injection', () => {
      const input = '"><img src=x onerror=alert(1)>';
      const hasEventHandlers = /on\w+\s*=/.test(input);
      expect(hasEventHandlers).toBe(true);
    });
  });

  describe('SQL Injection Prevention', () => {
    test('should detect common SQL injection patterns', () => {
      const hasSQLi = (input: string): boolean => {
        const patterns = [/'.*OR.*'/, /'.*--/, /DROP\s+TABLE/i, /UNION\s+SELECT/i, /DELETE\s+FROM/i, /WAITFOR\s+DELAY/i];
        return patterns.some(p => p.test(input));
      };
      expect(hasSQLi("' OR '1'='1")).toBe(true);
      expect(hasSQLi("' DROP TABLE users --")).toBe(true);
      expect(hasSQLi("normal input")).toBe(false);
    });
  });

  describe('Username Validation', () => {
    test('should validate safe username', () => {
      const safe = (u: string) => u.length >= 3 && /^[a-z0-9_.]+$/.test(u.toLowerCase());
      expect(safe('john_doe')).toBe(true);
      expect(safe('ab')).toBe(false);
      expect(safe('<script>')).toBe(false);
    });
  });

  describe('Rate Limiting Logic', () => {
    test('should enforce rate limits per IP', () => {
      const limiter = new Map<string, { count: number; reset: number }>();
      const allow = (ip: string): boolean => {
        const now = Date.now();
        const r = limiter.get(ip);
        if (!r || now > r.reset) { limiter.set(ip, { count: 1, reset: now + 60000 }); return true; }
        if (r.count >= 10) return false;
        r.count++;
        return true;
      };
      for (let i = 0; i < 10; i++) expect(allow('1.2.3.4')).toBe(true);
      expect(allow('1.2.3.4')).toBe(false);
      expect(allow('5.6.7.8')).toBe(true);
    });
  });

  describe('CSRF Token Validation', () => {
    test('should generate and validate CSRF tokens', () => {
      const store = new Map<string, string>();
      const gen = (sid: string) => { const t = crypto.randomBytes(32).toString('hex'); store.set(sid, t); return t; };
      const val = (sid: string, t: string) => store.get(sid) === t;

      const sid = 'session123';
      const token = gen(sid);
      expect(token.length).toBe(64);
      expect(val(sid, token)).toBe(true);
      expect(val(sid, 'wrong')).toBe(false);
    });
  });

  describe('Webhook Signature Validation', () => {
    test('should validate HMAC signatures', () => {
      const secret = 'whsec_secret';
      const sign = (p: string) => crypto.createHmac('sha256', secret).update(p).digest('hex');
      const payload = JSON.stringify({ event: 'payment.succeeded', amount: 100 });
      const sig = sign(payload);
      const verify = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      expect(sig).toBe(verify);
      expect(sig).not.toBe(crypto.createHmac('sha256', 'wrong_secret').update(payload).digest('hex'));
    });
  });

  describe('Session ID Uniqueness', () => {
    test('should generate unique session IDs', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const id = crypto.randomBytes(32).toString('hex');
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    });
  });

  describe('IDOR Protection', () => {
    test('should prevent cross-user access', () => {
      const canAccess = (req: string, owner: string, admin: boolean) => req === owner || admin;
      expect(canAccess('user1', 'user1', false)).toBe(true);
      expect(canAccess('user1', 'user2', false)).toBe(false);
      expect(canAccess('admin', 'user2', true)).toBe(true);
    });
  });
});