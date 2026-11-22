import fs from 'fs';
import os from 'os';
import path from 'path';
import { createDurableQueueHandlers } from '../services/durable-queue.handlers';

describe('durable media handler activation', () => {
  const oldFlag = process.env.VANTA_DURABLE_QUEUE_MEDIA_HANDLERS;
  const oldRoot = process.env.UPLOAD_STORAGE_DIR;
  afterEach(() => {
    if (oldFlag === undefined) delete process.env.VANTA_DURABLE_QUEUE_MEDIA_HANDLERS;
    else process.env.VANTA_DURABLE_QUEUE_MEDIA_HANDLERS = oldFlag;
    if (oldRoot === undefined) delete process.env.UPLOAD_STORAGE_DIR;
    else process.env.UPLOAD_STORAGE_DIR = oldRoot;
  });

  test('does not register media handlers without explicit flag', () => {
    delete process.env.VANTA_DURABLE_QUEUE_MEDIA_HANDLERS;
    const handlers = createDurableQueueHandlers({ deliverByDeviceId: jest.fn() });
    expect([...handlers.keys()]).toEqual(['push:deliver']);
  });

  test('requires a configured upload root when enabled', () => {
    process.env.VANTA_DURABLE_QUEUE_MEDIA_HANDLERS = 'true';
    delete process.env.UPLOAD_STORAGE_DIR;
    expect(() => createDurableQueueHandlers({ deliverByDeviceId: jest.fn() }))
      .toThrow('UPLOAD_STORAGE_DIR');
  });

  test('registers four explicit media handlers when enabled', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanta-handler-'));
    try {
      process.env.VANTA_DURABLE_QUEUE_MEDIA_HANDLERS = 'true';
      process.env.UPLOAD_STORAGE_DIR = root;
      const handlers = createDurableQueueHandlers({ deliverByDeviceId: jest.fn() });
      expect([...handlers.keys()].sort()).toEqual([
        'cleanup:temp', 'image:optimize', 'push:deliver', 'thumbnail:generate', 'video:transcode',
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
