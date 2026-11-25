import fs from 'fs';
import os from 'os';
import path from 'path';
import { cleanupExpiredMediaTemp } from '../services/media-cleanup-job';
import { transcodeLocalHls } from '../services/media-hls-job';

describe('durable media cleanup and HLS validation', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanta-media-ops-'));
    fs.mkdirSync(path.join(root, '.media-temp'));
    fs.writeFileSync(path.join(root, 'original.mp4'), 'keep');
    fs.writeFileSync(path.join(root, '.media-temp', 'temporary.mp4'), 'remove');
    fs.utimesSync(path.join(root, '.media-temp', 'temporary.mp4'), new Date(0), new Date(0));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('cleanup only deletes old files inside the dedicated temp directory', () => {
    expect(cleanupExpiredMediaTemp(root, 'temporary.mp4')).toBe(true);
    expect(cleanupExpiredMediaTemp(root, 'temporary.mp4')).toBe(false);
    expect(fs.existsSync(path.join(root, 'original.mp4'))).toBe(true);
  });

  test('cleanup rejects traversal, retention bypass and symlink escapes', () => {
    expect(() => cleanupExpiredMediaTemp(root, '../original.mp4')).toThrow();
    expect(() => cleanupExpiredMediaTemp(root, 'temporary.mp4', 0)).toThrow();
    fs.symlinkSync(path.join(root, 'original.mp4'), path.join(root, '.media-temp', 'link.mp4'));
    expect(() => cleanupExpiredMediaTemp(root, 'link.mp4')).toThrow();
  });

  test('cleanup refuses aliases to another temporary file', () => {
    const original = path.join(root, '.media-temp', 'temporary.mp4');
    fs.symlinkSync(original, path.join(root, '.media-temp', 'alias.mp4'));
    expect(() => cleanupExpiredMediaTemp(root, 'alias.mp4')).toThrow('symlink');
    expect(fs.existsSync(original)).toBe(true);
  });

  test('HLS does not acknowledge a master playlist without actual segments', async () => {
    const destination = path.join(root, 'videos', 'incomplete');
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(destination, 'master.m3u8'), '#EXTM3U');
    await expect(transcodeLocalHls(root, {
      inputPath: 'original.mp4', outputName: 'incomplete', qualities: ['360p'],
    })).rejects.toThrow('Incomplete existing HLS output');
  });

  test('HLS rejects a master that points at incomplete variant playlists', async () => {
    const destination = path.join(root, 'videos', 'incomplete-variant');
    const variant = path.join(destination, '360p');
    fs.mkdirSync(variant, { recursive: true });
    fs.writeFileSync(path.join(destination, 'master.m3u8'), '#EXTM3U\\n360p/playlist.m3u8');
    fs.writeFileSync(path.join(variant, 'playlist.m3u8'), '#EXTM3U\\n#EXTINF:4.0,\\nsegment-00000.ts');
    fs.writeFileSync(path.join(variant, 'segment-00000.ts'), 'data');
    await expect(transcodeLocalHls(root, {
      inputPath: 'original.mp4', outputName: 'incomplete-variant', qualities: ['360p'],
    })).rejects.toThrow('Incomplete existing HLS output');
  });

  test('HLS retry rejects playlists that reference missing segment files', async () => {
    const destination = path.join(root, 'videos', 'missing-segment');
    const variant = path.join(destination, '360p');
    fs.mkdirSync(variant, { recursive: true });
    fs.writeFileSync(path.join(destination, 'master.m3u8'),
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n360p/playlist.m3u8\n');
    fs.writeFileSync(path.join(variant, 'playlist.m3u8'),
      '#EXTM3U\n#EXTINF:4.0,\nsegment-00000.ts\n#EXTINF:4.0,\nsegment-00001.ts\n#EXT-X-ENDLIST\n');
    fs.writeFileSync(path.join(variant, 'segment-00000.ts'), 'data');
    await expect(transcodeLocalHls(root, {
      inputPath: 'original.mp4', outputName: 'missing-segment', qualities: ['360p'],
    })).rejects.toThrow('Incomplete existing HLS output');
  });

  test('HLS retry rejects unlisted and symlinked segments', async () => {
    const destination = path.join(root, 'videos', 'unsafe-segment');
    const variant = path.join(destination, '360p');
    fs.mkdirSync(variant, { recursive: true });
    fs.writeFileSync(path.join(destination, 'master.m3u8'),
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n360p/playlist.m3u8\n');
    fs.writeFileSync(path.join(variant, 'playlist.m3u8'),
      '#EXTM3U\n#EXTINF:4.0,\nsegment-00000.ts\n#EXT-X-ENDLIST\n');
    fs.symlinkSync(path.join(root, 'original.mp4'), path.join(variant, 'segment-00000.ts'));
    await expect(transcodeLocalHls(root, {
      inputPath: 'original.mp4', outputName: 'unsafe-segment', qualities: ['360p'],
    })).rejects.toThrow('Incomplete existing HLS output');
    fs.unlinkSync(path.join(variant, 'segment-00000.ts'));
    fs.writeFileSync(path.join(variant, 'segment-00000.ts'), 'valid');
    fs.writeFileSync(path.join(variant, 'segment-00001.ts'), 'not listed');
    await expect(transcodeLocalHls(root, {
      inputPath: 'original.mp4', outputName: 'unsafe-segment', qualities: ['360p'],
    })).rejects.toThrow('Incomplete existing HLS output');
  });

  test('HLS validates quality allow-list before invoking FFmpeg', async () => {
    await expect(transcodeLocalHls(root, {
      inputPath: 'original.mp4', outputName: 'test', qualities: ['1080p'],
    })).rejects.toThrow('Unsupported HLS qualities');
    await expect(transcodeLocalHls(root, {
      inputPath: 'original.mp4', outputName: 'test', qualities: ['constructor'],
    })).rejects.toThrow('Unsupported HLS qualities');
    await expect(transcodeLocalHls(root, {
      inputPath: '../outside.mp4', outputName: 'test',
    })).rejects.toThrow();
  });
});
