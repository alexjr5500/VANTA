import { beforeEach, describe, expect, jest, test } from '@jest/globals';
jest.mock('../prisma', () => ({
  prisma: {
    uploadedFile: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    conversation: { findUnique: jest.fn() },
    message: { findUnique: jest.fn() },
  },
}));
jest.mock('../services/private-media.service', () => ({ verifyPrivateMediaToken: jest.fn() }));
jest.mock('../services/upload.service', () => ({
  uploadStorageDir: '/tmp/private-uploads',
  getPrivateCloudinaryDownloadUrl: jest.fn(),
}));
import { prisma } from '../prisma';
import { verifyPrivateMediaToken } from '../services/private-media.service';
import { getPrivateMedia } from '../controllers/private-media.controller';

function response() {
  const res: any = {
    headers: {},
    setHeader(name: string, value: unknown) { this.headers[name] = value; return this; },
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
    type(value: string) { this.contentType = value; return this; },
    sendFile: jest.fn(),
    redirect: jest.fn(),
  };
  return res;
}
function request(fileId = 'file-1') {
  return { params: { fileId }, query: { token: 'signed-token' } } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
  (verifyPrivateMediaToken as jest.Mock).mockReturnValue('user-2');
  (prisma.uploadedFile.findUnique as jest.Mock).mockResolvedValue({
    id: 'file-1', category: 'message', deletedAt: null, recordType: 'Conversation',
    recordId: 'conversation-1', filename: 'secret.jpg', mimeType: 'image/jpeg',
    path: '/tmp/private-uploads/secret.jpg',
  });
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE' });
  (prisma.conversation.findUnique as jest.Mock).mockResolvedValue({
    id: 'conversation-1', participants: [{ userId: 'user-1' }],
  });
});

describe('private media membership enforcement', () => {
  test('denies a signed URL when the user is not a conversation participant', async () => {
    const res = response();
    await getPrivateMedia(request(), res);
    expect(res.statusCode).toBe(404);
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  test('serves the file only to a current conversation participant', async () => {
    (verifyPrivateMediaToken as jest.Mock).mockReturnValue('user-1');
    const res = response();
    await getPrivateMedia(request(), res);
    expect(res.sendFile).toHaveBeenCalledWith('/tmp/private-uploads/secret.jpg', expect.any(Function));
    expect(res.headers['Cache-Control']).toBe('private, no-store');
  });

  test('denies a previously signed attachment URL after group message expiry', async () => {
    (verifyPrivateMediaToken as jest.Mock).mockReturnValue('user-1');
    (prisma.uploadedFile.findUnique as jest.Mock).mockResolvedValue({id:'file-1',category:'message',recordType:'Message',recordId:'old-message',path:'/tmp/private-uploads/secret.jpg'});
    (prisma.message.findUnique as jest.Mock).mockResolvedValue({id:'old-message',createdAt:new Date(Date.now()-7200000),conversation:{permissions:JSON.stringify({autoDeleteSeconds:3600}),participants:[{userId:'user-1'}]}});
    const res=response();
    await getPrivateMedia(request(),res);
    expect(res.statusCode).toBe(404);
    expect(res.sendFile).not.toHaveBeenCalled();
  });

  test('denies access after the user account is deactivated', async () => {
    (verifyPrivateMediaToken as jest.Mock).mockReturnValue('user-1');
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ status: 'SUSPENDED' });
    const res = response();
    await getPrivateMedia(request(), res);
    expect(res.statusCode).toBe(404);
    expect(res.sendFile).not.toHaveBeenCalled();
  });
});
