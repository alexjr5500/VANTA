import fs from 'fs';
import os from 'os';
import path from 'path';
import { transcodeLocalHls } from '../services/media-hls-job';

describe('real FFmpeg HLS integration', () => {
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  const { spawnSync } = require('child_process') as typeof import('child_process');
  const installed = spawnSync(ffmpeg, ['-version'], { timeout: 3000 }).status === 0;
  const run = installed ? test : test.skip;

  run('creates a master playlist and playable transport-stream segments', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanta-ffmpeg-'));
    try {
      const input = path.join(root, 'fixture.mp4');
      const fixture = spawnSync(ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
        'testsrc2=size=320x180:rate=15', '-t', '1', '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p', '-y', input,
      ], { timeout: 20000 });
      expect(fixture.status).toBe(0);
      const result = await transcodeLocalHls(root, {
        inputPath: 'fixture.mp4', outputName: 'fixture', qualities: ['360p', '480p'],
      });
      expect(result).toBe('/uploads/videos/fixture/master.m3u8');
      const dir = path.join(root, 'videos', 'fixture');
      const master = fs.readFileSync(path.join(dir, 'master.m3u8'), 'utf8');
      for (const quality of ['360p', '480p']) {
        expect(master).toContain(`${quality}/playlist.m3u8`);
        const variant = path.join(dir, quality);
        const playlist = fs.readFileSync(path.join(variant, 'playlist.m3u8'), 'utf8');
        expect(playlist).toContain('#EXTINF');
        expect(playlist).toContain('#EXT-X-ENDLIST');
        const segments = fs.readdirSync(variant).filter(f => f.endsWith('.ts'));
        expect(segments.length).toBeGreaterThan(0);
        for (const segment of segments) {
          expect(playlist).toContain(segment);
          expect(fs.statSync(path.join(variant, segment)).size).toBeGreaterThan(0);
        }
      }
      await expect(transcodeLocalHls(root, {
        inputPath: 'fixture.mp4', outputName: 'fixture', qualities: ['360p'],
      })).resolves.toBe(result);
      // Reject unexpected entries even when requested variants are complete.
      fs.appendFileSync(path.join(dir, 'master.m3u8'), '#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://example.invalid/other.m3u8\n');
      await expect(transcodeLocalHls(root, {
        inputPath: 'fixture.mp4', outputName: 'fixture', qualities: ['360p'],
      })).rejects.toThrow('Incomplete existing HLS output');
      fs.writeFileSync(path.join(dir, 'master.m3u8'), master);
      const variant = path.join(dir, '360p', 'playlist.m3u8');
      const original = fs.readFileSync(variant, 'utf8');
      fs.writeFileSync(variant, original.replace('#EXT-X-ENDLIST', '#EXT-X-KEY:METHOD=AES-128,URI="https://example.invalid/key"\n#EXT-X-ENDLIST'));
      await expect(transcodeLocalHls(root, {
        inputPath: 'fixture.mp4', outputName: 'fixture', qualities: ['360p'],
      })).rejects.toThrow('Incomplete existing HLS output');

      // A playlist masquerading as an upload must fail rather than read
      // referenced files. The fixture only references synthetic local media.
      fs.writeFileSync(path.join(root, 'disguised.mp4'), "ffconcat version 1.0\nfile fixture.mp4\n");
      await expect(transcodeLocalHls(root, {
        inputPath: 'disguised.mp4', outputName: 'disguised', qualities: ['360p'],
      })).rejects.toThrow();
      expect(fs.existsSync(path.join(root, 'videos', 'disguised'))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 120000);
});
