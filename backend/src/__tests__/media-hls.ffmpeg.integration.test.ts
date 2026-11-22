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
        inputPath: 'fixture.mp4', outputName: 'fixture', qualities: ['360p'],
      });
      expect(result).toBe('/uploads/videos/fixture/master.m3u8');
      const dir = path.join(root, 'videos', 'fixture');
      expect(fs.readFileSync(path.join(dir, 'master.m3u8'), 'utf8')).toContain('360p/playlist.m3u8');
      const variant = path.join(dir, '360p');
      expect(fs.readFileSync(path.join(variant, 'playlist.m3u8'), 'utf8')).toContain('#EXTINF');
      expect(fs.readdirSync(variant).some(f => f.endsWith('.ts'))).toBe(true);
      await expect(transcodeLocalHls(root, {
        inputPath: 'fixture.mp4', outputName: 'fixture', qualities: ['360p'],
      })).resolves.toBe(result);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 120000);
});
