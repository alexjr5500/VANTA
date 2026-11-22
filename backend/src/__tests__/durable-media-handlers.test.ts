import fs from 'fs';
import os from 'os';
import path from 'path';
import { createDurableQueueHandlers } from '../services/durable-queue.handlers';

describe('durable media handler activation', () => {
  const oldFlag = process.env.VANTA_DURABLE_QUEUE_MEDIA_HANDLERS;
  const oldRoot = process.env.UPLOAD_STORAGE_DIR;
  const oldMode = process.env.VANTA_DURABLE_QUEUE_MEDIA_STORAGE;
  const oldCloud = [process.env.CLOUDINARY_CLOUD_NAME, process.env.CLOUDINARY_API_KEY, process.env.CLOUDINARY_API_SECRET];
  afterEach(() => {
    if (oldMode === undefined) delete process.env.VANTA_DURABLE_QUEUE_MEDIA_STORAGE;
    else process.env.VANTA_DURABLE_QUEUE_MEDIA_STORAGE = oldMode;
    for (const [i, key] of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'].entries()) {
      if (oldCloud[i] === undefined) delete process.env[key];
      else process.env[key] = oldCloud[i];
    }
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
    process.env.VANTA_DURABLE_QUEUE_MEDIA_STORAGE = 'local';
    process.env.VANTA_DURABLE_QUEUE_MEDIA_HANDLERS = 'true';
    delete process.env.UPLOAD_STORAGE_DIR;
    expect(() => createDurableQueueHandlers({ deliverByDeviceId: jest.fn() }))
      .toThrow('UPLOAD_STORAGE_DIR');
  });

  test('registers four explicit media handlers when enabled', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanta-handler-'));
    try {
      process.env.VANTA_DURABLE_QUEUE_MEDIA_HANDLERS = 'true';
      process.env.VANTA_DURABLE_QUEUE_MEDIA_STORAGE = 'local';
      process.env.UPLOAD_STORAGE_DIR = root;
      const handlers = createDurableQueueHandlers({ deliverByDeviceId: jest.fn() });
      expect([...handlers.keys()].sort()).toEqual([
        'cleanup:temp', 'image:optimize', 'push:deliver', 'thumbnail:generate', 'video:transcode',
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  test('Cloudinary mode registers remotely processed media and excludes local cleanup', () => {
    process.env.VANTA_DURABLE_QUEUE_MEDIA_HANDLERS = 'true';
    process.env.VANTA_DURABLE_QUEUE_MEDIA_STORAGE = 'cloudinary';
    process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
    process.env.CLOUDINARY_API_KEY = 'test-key';
    process.env.CLOUDINARY_API_SECRET = 'test-secret';
    delete process.env.UPLOAD_STORAGE_DIR;
    const handlers = createDurableQueueHandlers({ deliverByDeviceId: jest.fn() });
    expect([...handlers.keys()].sort()).toEqual([
      'cloudinary:image:optimize', 'cloudinary:thumbnail:generate', 'cloudinary:video:transcode', 'push:deliver',
    ]);
  });

  test('Cloudinary mode fails closed without credentials', () => {
    process.env.VANTA_DURABLE_QUEUE_MEDIA_HANDLERS = 'true';
    process.env.VANTA_DURABLE_QUEUE_MEDIA_STORAGE = 'cloudinary';
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
    expect(() => createDurableQueueHandlers({ deliverByDeviceId: jest.fn() }))
      .toThrow('Cloudinary credentials');
  });
});
