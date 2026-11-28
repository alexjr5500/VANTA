import { afterAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
jest.mock('../prisma', () => ({ prisma: { uploadedFile: { findFirst: jest.fn() } } }));
import { prisma } from '../prisma';
import { createPrivateMediaUrl, verifyPrivateMediaToken, privateMediaStaticGuard } from '../services/private-media.service';

const previousSecret = process.env.JWT_SECRET;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.JWT_SECRET = 'test-jwt-secret-long-enough-for-private-media-signing';
});

afterAll(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

function response() {
  const res: any = {
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  return res;
}

describe('private message media access tokens', () => {
  test('creates a short-lived token bound to one user and one file', () => {
    const url = createPrivateMediaUrl('file-1', 'user-1');
    const token = new URL(url, 'https://vanta.test').searchParams.get('token')!;
    expect(url).toContain('/api/media/private/file-1?token=');
    expect(verifyPrivateMediaToken(token, 'file-1')).toBe('user-1');
    expect(() => verifyPrivateMediaToken(token, 'file-2')).toThrow();
  });

  test('blocks private message files from the public /uploads path', async () => {
    (prisma.uploadedFile.findFirst as jest.Mock).mockResolvedValue({ id: 'private-file', category: 'message', deletedAt: null });
    const next = jest.fn();
    const res = response();
    await privateMediaStaticGuard({ path: '/secret.jpg' } as any, res, next);
    expect(res.statusCode).toBe(404);
    expect(next).not.toHaveBeenCalled();
  });

  test.each(['verification', 'identity', 'KYC'])('blocks legacy %s documents from the public static path', async category => {
    (prisma.uploadedFile.findFirst as jest.Mock).mockResolvedValue({ id: 'legacy-document', category, deletedAt: null });
    const next = jest.fn();
    const res = response();
    await privateMediaStaticGuard({ path: '/synthetic.pdf' } as any, res, next);
    expect(res.statusCode).toBe(404);
    expect(next).not.toHaveBeenCalled();
  });

  test('blocks legacy verification record bindings even with a generic category', async () => {
    (prisma.uploadedFile.findFirst as jest.Mock).mockResolvedValue({ id: 'legacy-document', category: 'generic', recordType: 'VerificationRequest', deletedAt: null });
    const next = jest.fn();
    const res = response();
    await privateMediaStaticGuard({ path: '/synthetic.pdf' } as any, res, next);
    expect(res.statusCode).toBe(404);
    expect(next).not.toHaveBeenCalled();
  });

  test('allows public media through the static path', async () => {
    (prisma.uploadedFile.findFirst as jest.Mock).mockResolvedValue(null);
    const next = jest.fn();
    await privateMediaStaticGuard({ path: '/avatar.jpg' } as any, response(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('fails closed when the media metadata database cannot be checked', async () => {
    (prisma.uploadedFile.findFirst as jest.Mock).mockRejectedValue(new Error('database offline'));
    const next = jest.fn();
    const res = response();
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await privateMediaStaticGuard({ path: '/unknown.jpg' } as any, res, next);
    expect(res.statusCode).toBe(503);
    expect(next).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
