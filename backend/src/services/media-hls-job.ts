import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { resolveLocalMediaInput, safeMediaOutputName } from './media-job-paths';

const execFileAsync = promisify(execFile);

/**
 * Check every referenced TS segment before treating an existing output as a
 * successful retry. A playlist can reference a missing segment even when all
 * the files that happen to be present are nonempty.
 */
const MAX_PLAYLIST_BYTES = 1024 * 1024;
function readPlaylist(file: string): string[] | null {
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size === 0 || stat.size > MAX_PLAYLIST_BYTES) return null;
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function completeHlsVariant(variant: string): boolean {
  const playlist = path.join(variant, 'playlist.m3u8');
  if (!fs.existsSync(variant) || !fs.lstatSync(variant).isDirectory() ||
      fs.realpathSync(variant) !== variant ||
      !fs.existsSync(playlist) || !fs.lstatSync(playlist).isFile()) return false;
  const lines = readPlaylist(playlist);
  if (!lines || lines[0] !== '#EXTM3U' || lines[lines.length - 1] !== '#EXT-X-ENDLIST') return false;
  // This worker creates plain, self-contained VOD TS playlists only. Reject
  // key/map/alternate-media URIs or any unexpected tag on an existing output.
  if (lines.some(line => line.startsWith('#') &&
      !/^(?:#EXTM3U|#EXT-X-ENDLIST|#EXT-X-VERSION:\d+|#EXT-X-TARGETDURATION:\d+|#EXT-X-MEDIA-SEQUENCE:\d+|#EXT-X-PLAYLIST-TYPE:VOD|#EXTINF:\d+(?:\.\d+)?,)$/.test(line))) return false;
  const referenced = lines.filter(line => !line.startsWith('#'));
  const durationEntries = lines.filter(line => line.startsWith('#EXTINF:'));
  if (referenced.length === 0 || referenced.length !== durationEntries.length ||
      referenced.some(file => !/^segment-\d{5}\.ts$/.test(file)) ||
      new Set(referenced).size !== referenced.length) return false;
  const onDisk = fs.readdirSync(variant).filter(file => /^segment-\d{5}\.ts$/.test(file));
  if (onDisk.length !== referenced.length) return false;
  return referenced.every(file => {
    const segment = path.join(variant, file);
    return fs.existsSync(segment) && fs.lstatSync(segment).isFile() && fs.statSync(segment).size > 0;
  });
}
const QUALITIES: Record<string, { width: number; height: number; bitrate: string; bandwidth: number }> = {
  '360p': { width: 640, height: 360, bitrate: '600k', bandwidth: 800000 },
  '480p': { width: 854, height: 480, bitrate: '1100k', bandwidth: 1400000 },
  '720p': { width: 1280, height: 720, bitrate: '2600k', bandwidth: 3100000 },
};
// Explicitly align keyframes with segment boundaries: hls_time alone can
// otherwise wait for a much longer encoder GOP. Preserve vertical framing.
const SEGMENT_SECONDS = 2;
async function isPortraitInput(input: string): Promise<boolean> {
  const { stdout } = await execFileAsync(process.env.FFPROBE_PATH || 'ffprobe', [
    '-v', 'error', '-protocol_whitelist', 'file', '-format_whitelist', 'mov,matroska,webm',
    '-select_streams', 'v:0', '-show_entries',
    'stream=width,height,sample_aspect_ratio:stream_side_data=rotation:stream_tags=rotate',
    '-of', 'json', input,
  ], { timeout: 10000, maxBuffer: 65536 });
  const stream = JSON.parse(stdout).streams?.[0];
  if (!stream || !Number.isSafeInteger(stream.width) || !Number.isSafeInteger(stream.height) ||
      stream.width <= 0 || stream.height <= 0) throw new Error('Invalid video dimensions');
  const sar = /^(\d+):(\d+)$/.exec(stream.sample_aspect_ratio || '');
  const ratio = sar && Number(sar[1]) > 0 && Number(sar[2]) > 0 ? Number(sar[1]) / Number(sar[2]) : 1;
  const rotation = Number(stream.side_data_list?.find((entry: { rotation?: number }) => entry.rotation !== undefined)?.rotation ?? stream.tags?.rotate ?? 0);
  const quarterTurn = Number.isFinite(rotation) && Math.abs(rotation % 180) === 90;
  const portrait = stream.width * ratio < stream.height;
  return quarterTurn ? !portrait && stream.width * ratio > stream.height : portrait;
}
export interface TranscodeJob { inputPath: string; outputName: string; qualities?: string[]; }

/** Encode real HLS segments before publishing the master playlist. */
export async function transcodeLocalHls(storageRoot: string, job: TranscodeJob): Promise<string> {
  const input = resolveLocalMediaInput(storageRoot, job.inputPath);
  const name = safeMediaOutputName(job.outputName);
  const requested = job.qualities ?? ['360p', '480p'];
  if (!Array.isArray(requested) || !requested.length || requested.length > 3 ||
      requested.some(q => typeof q !== 'string' || !Object.prototype.hasOwnProperty.call(QUALITIES, q)) ||
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
      const lines = readPlaylist(master);
      if (lines && lines[0] === '#EXTM3U' && lines[1] === '#EXT-X-VERSION:3' &&
          lines.length >= 4 && (lines.length - 2) % 2 === 0) {
        const found = new Set<string>();
        let valid = true;
        for (let i = 2; i < lines.length; i += 2) {
          const quality = Object.keys(QUALITIES).find(q => lines[i + 1] === q + '/playlist.m3u8');
          const preset = quality ? QUALITIES[quality] : undefined;
          if (!quality || !preset || found.has(quality) ||
              ![`#EXT-X-STREAM-INF:BANDWIDTH=${preset.bandwidth},RESOLUTION=${preset.width}x${preset.height}`,
                `#EXT-X-STREAM-INF:BANDWIDTH=${preset.bandwidth},RESOLUTION=${preset.height}x${preset.width}`].includes(lines[i]) ||
              !completeHlsVariant(path.join(destination, quality))) { valid = false; break; }
          found.add(quality);
        }
        if (valid && requested.every(q => found.has(q))) return '/uploads/videos/' + name + '/master.m3u8';
      }
    }
    throw new Error('Incomplete existing HLS output requires manual recovery');
  }
  const portrait = await isPortraitInput(input);
  const staging = path.join(videos, '.hls-' + crypto.randomBytes(12).toString('hex'));
  fs.mkdirSync(staging, { recursive: false });
  try {
    const variants: string[] = [];
    for (const quality of requested) {
      const preset = QUALITIES[quality];
      const width = portrait ? preset.height : preset.width;
      const height = portrait ? preset.width : preset.height;
      const dir = path.join(staging, quality);
      fs.mkdirSync(dir);
      const args = [
        '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
        // Permit local, self-contained video containers only; no playlist or
        // network input protocols, even when a file has a misleading extension.
        '-protocol_whitelist', 'file', '-format_whitelist', 'mov,matroska,webm',
        '-i', input,
        '-map', '0:v:0', '-map', '0:a:0?', '-vf',
        `scale=w=${width}:h=${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-threads', '2', '-filter_threads', '2', '-b:v', preset.bitrate,
        '-force_key_frames', `expr:gte(t,n_forced*${SEGMENT_SECONDS})`, '-sc_threshold', '0',
        '-maxrate', preset.bitrate, '-bufsize', `${parseInt(preset.bitrate, 10) * 2}k`,
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k',
        '-f', 'hls', '-hls_time', String(SEGMENT_SECONDS), '-hls_playlist_type', 'vod',
        '-hls_segment_filename', path.join(dir, 'segment-%05d.ts'),
        path.join(dir, 'playlist.m3u8'),
      ];
      await execFileAsync(process.env.FFMPEG_PATH || 'ffmpeg', args, {
        timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024,
      });
      if (!completeHlsVariant(dir)) {
        throw new Error('FFmpeg did not produce playable HLS segments');
      }
      variants.push(`#EXT-X-STREAM-INF:BANDWIDTH=${preset.bandwidth},RESOLUTION=${width}x${height}\n${quality}/playlist.m3u8`);
    }
    fs.writeFileSync(path.join(staging, 'master.m3u8'), '#EXTM3U\n#EXT-X-VERSION:3\n' + variants.join('\n') + '\n', { flag: 'wx' });
    // Do not overwrite another worker's output if two leases race.
    if (fs.existsSync(destination)) {
      throw new Error('Concurrent HLS output publication detected; retry after inspecting output');
    }
    fs.renameSync(staging, destination);
    return '/uploads/videos/' + name + '/master.m3u8';
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
