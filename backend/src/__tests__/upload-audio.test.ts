/**
 * Voice-note / audio upload pipeline — WebM(M) support.
 * MediaRecorder produces `audio/webm` with a `.webm` extension. The backend
 * validation must accept the base MIME (stripping codec parameters), map the
 * audio/ MIME to the AUDIO type, and verify the EBML magic bytes.
 */
import { getFileType, verifyFileContent } from '../services/upload.service';
import type { Express } from 'express';
import os from 'os';
import path from 'path';

jest.mock('../prisma', () => ({ prisma: { uploadedFile: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() } } }));
jest.mock('../services/image-optimizer.service', () => ({ imageOptimizer: { optimize: jest.fn() } }));

jest.mock('fs', () => jest.requireActual('fs'));

// EBML magic signature (WebM container): 0x1A 0x45 0xDF 0xA3
const WEBM_HEADER = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

const tempAudioPath = (name: string): string => path.join(os.tmpdir(), name);

const makeFile = (opts: { mimetype: string; path: string; originalname: string; size: number }): Express.Multer.File =>
  ({ fieldname: 'file', encoding: '7bit', mimetype: opts.mimetype, path: opts.path, originalname: opts.originalname, size: opts.size, destination: '', filename: '', buffer: undefined }) as Express.Multer.File;

describe('WebM / audio upload pipeline', () => {
  test('getFileType maps audio/webm to AUDIO', () => {
    expect(getFileType('audio/webm')).toBe('AUDIO');
    expect(getFileType('audio/webm;codecs=opus')).toBe('AUDIO');
  });

  test('verifyFileContent accepts a WebM EBML header for audio/webm', () => {
    const file = makeFile({ mimetype: 'audio/webm', path: tempAudioPath('vanta-tmp-audio.webm'), originalname: 'voice-note.webm', size: WEBM_HEADER.length });
    const realFs = jest.requireActual('fs');
    realFs.writeFileSync(file.path, WEBM_HEADER);
    try {
      expect(() => verifyFileContent(file)).not.toThrow();
    } finally {
      realFs.unlinkSync(file.path);
    }
  });

  test('verifyFileContent accepts a WebM EBML header for audio/webm;codecs=opus', () => {
    const file = makeFile({ mimetype: 'audio/webm;codecs=opus', path: tempAudioPath('vanta-tmp-audio2.webm'), originalname: 'voice-note-2.webm', size: WEBM_HEADER.length });
    const realFs = jest.requireActual('fs');
    realFs.writeFileSync(file.path, WEBM_HEADER);
    try {
      expect(() => verifyFileContent(file)).not.toThrow();
    } finally {
      realFs.unlinkSync(file.path);
    }
  });

  test('verifyFileContent rejects a WebM file declared as audio when bytes are not EBML', () => {
    const file = makeFile({ mimetype: 'audio/webm', path: tempAudioPath('vanta-tmp-audio3.webm'), originalname: 'fakepcm.wav', size: 16 });
    const realFs = jest.requireActual('fs');
    realFs.writeFileSync(file.path, Buffer.alloc(16, 0xff));
    try {
      expect(() => verifyFileContent(file)).toThrow(/do not match/);
    } finally {
      realFs.unlinkSync(file.path);
    }
  });

  test('getFileType keeps audio/ogg audio and video/webm video', () => {
    expect(getFileType('audio/ogg')).toBe('AUDIO');
    expect(getFileType('audio/mpeg')).toBe('AUDIO');
    expect(getFileType('video/webm')).toBe('VIDEO');
  });
});