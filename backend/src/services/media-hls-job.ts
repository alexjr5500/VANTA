import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { resolveLocalMediaInput, safeMediaOutputName } from './media-job-paths';

const execFileAsync = promisify(execFile);
const QUALITIES: Record<string, { width: number; height: number; bitrate: string; bandwidth: number }> = {
  '360p': { width: 640, height: 360, bitrate: '600k', bandwidth: 800000 },
  '480p': { width: 854, height: 480, bitrate: '1100k', bandwidth: 1400000 },
  '720p': { width: 1280, height: 720, bitrate: '2600k', bandwidth: 3100000 },
};
export interface TranscodeJob { inputPath: string; outputName: string; qualities?: string[]; }

/** Encode real HLS segments before publishing the master playlist. */
export async function transcodeLocalHls(storageRoot: string, job: TranscodeJob): Promise<string> {
  const input = resolveLocalMediaInput(storageRoot, job.inputPath);
  const name = safeMediaOutputName(job.outputName);
  const requested = job.qualities ?? ['360p', '480p'];
  if (!Array.isArray(requested) || !requested.length || requested.length > 3 ||
      requested.some(q => typeof q !== 'string' || !QUALITIES[q]) ||
      new Set(requested).size !== requested.length) throw new Error('Unsupported HLS qualities');
  const root = fs.realpathSync(path.resolve(storageRoot));
  const videos = path.join(root, 'videos');
  fs.mkdirSync(videos, { recursive: true });
  if (fs.realpathSync(videos) !== videos) throw new Error('Unsafe HLS output directory');
  const destination = path.join(videos, name);
  const master = path.join(destination, 'master.m3u8');
  if (fs.existsSync(destination)) {
    if (!fs.lstatSync(destination).isDirectory() || fs.realpathSync(destination) !== destination) {
      throw new Error('Unsafe existing HLS output');
    }
    if (fs.existsSync(master) && fs.lstatSync(master).isFile() && fs.statSync(master).size > 0) {
      const valid = requested.every(quality => {
        const variant = path.join(destination, quality);
        const playlist = path.join(variant, 'playlist.m3u8');
        if (!fs.existsSync(variant) || !fs.lstatSync(variant).isDirectory() ||
            !fs.existsSync(playlist) || !fs.lstatSync(playlist).isFile()) return false;
        const segments = fs.readdirSync(variant).filter(file => /^segment-\d{5}\.ts$/.test(file));
        return segments.length > 0 && segments.every(file => {
          const segment = path.join(variant, file);
          return fs.lstatSync(segment).isFile() && fs.statSync(segment).size > 0;
        });
      });
      if (valid) return '/uploads/videos/' + name + '/master.m3u8';
    }
    throw new Error('Incomplete existing HLS output requires manual recovery');
  }
  const staging = path.join(videos, '.hls-' + crypto.randomBytes(12).toString('hex'));
  fs.mkdirSync(staging, { recursive: false });
  try {
    const variants: string[] = [];
    for (const quality of requested) {
      const preset = QUALITIES[quality];
      const dir = path.join(staging, quality);
      fs.mkdirSync(dir);
      const args = [
        '-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-i', input,
        '-map', '0:v:0', '-map', '0:a:0?', '-vf',
        `scale=w=${preset.width}:h=${preset.height}:force_original_aspect_ratio=decrease,pad=${preset.width}:${preset.height}:(ow-iw)/2:(oh-ih)/2`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', preset.bitrate,
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k',
        '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod',
        '-hls_segment_filename', path.join(dir, 'segment-%05d.ts'),
        path.join(dir, 'playlist.m3u8'),
      ];
      await execFileAsync(process.env.FFMPEG_PATH || 'ffmpeg', args, {
        timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024,
      });
      const playlist = path.join(dir, 'playlist.m3u8');
      const segments = fs.readdirSync(dir).filter(f => /^segment-\d{5}\.ts$/.test(f));
      if (!fs.existsSync(playlist) || !segments.length ||
          segments.some(f => fs.statSync(path.join(dir, f)).size === 0)) {
        throw new Error('FFmpeg did not produce playable HLS segments');
      }
      variants.push(`#EXT-X-STREAM-INF:BANDWIDTH=${preset.bandwidth},RESOLUTION=${preset.width}x${preset.height}\n${quality}/playlist.m3u8`);
    }
    fs.writeFileSync(path.join(staging, 'master.m3u8'), '#EXTM3U\n#EXT-X-VERSION:3\n' + variants.join('\n') + '\n', { flag: 'wx' });
    fs.renameSync(staging, destination);
    return '/uploads/videos/' + name + '/master.m3u8';
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
