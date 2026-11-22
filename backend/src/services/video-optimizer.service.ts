import path from 'path';
import fs from 'fs';
import { jobQueue, JOB_TYPES } from './queue.service';
import { transcodeLocalHls } from './media-hls-job';
import { uploadStorageDir } from './upload.service';

// Video optimization configuration
const VIDEO_QUALITIES = {
  '144p': { width: 256, height: 144, bitrate: '150k' },
  '240p': { width: 426, height: 240, bitrate: '300k' },
  '360p': { width: 640, height: 360, bitrate: '500k' },
  '480p': { width: 854, height: 480, bitrate: '1000k' },
  '720p': { width: 1280, height: 720, bitrate: '2500k' },
  '1080p': { width: 1920, height: 1080, bitrate: '5000k' },
};

interface VideoOptimizeOptions {
  qualities?: string[]; // ['144p', '240p', '360p', '480p', '720p', '1080p']
  generateThumbnail?: boolean;
  generatePreview?: boolean;
}

class VideoOptimizer {
  private uploadDir: string;

  constructor() {
    this.uploadDir = uploadStorageDir;
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  // Queue video optimization job
  queueOptimization(inputPath: string, filename: string, options?: VideoOptimizeOptions) {
    return jobQueue.add(JOB_TYPES.VIDEO_TRANSCODE, { inputPath, filename, options }, 10);
  }

  // Generate HLS playlist and segments
  async generateHLS(inputPath: string, outputName: string, qualities: string[] = ['360p', '480p', '720p']): Promise<{
    masterPlaylist: string;
    variants: Record<string, string>;
    thumbnail: string;
  }> {
    const baseName = path.parse(outputName).name;
    const masterPlaylist = await transcodeLocalHls(this.uploadDir, {
      inputPath, outputName: baseName, qualities,
    });
    const variants = Object.fromEntries(qualities.map(quality => [
      quality, `/uploads/videos/${baseName}/${quality}/playlist.m3u8`,
    ]));
    // No thumbnail URL is advertised until a real thumbnail is generated.
    return { masterPlaylist, variants, thumbnail: '' };
  }

  // Generate DASH manifest
  async generateDASH(inputPath: string, outputName: string, qualities: string[] = ['360p', '480p', '720p']): Promise<{
    manifest: string;
    variants: Record<string, string>;
  }> {
    // Never claim that a DASH manifest exists when it has not been encoded.
    throw new Error('DASH encoding is not implemented; use generateHLS for playable video');
  }

  // Queue thumbnail generation
  queueThumbnail(inputPath: string, outputName?: string) {
    return jobQueue.add(JOB_TYPES.THUMBNAIL_GENERATE, { inputPath, outputName, type: 'video' }, 5);
  }
}

export const videoOptimizer = new VideoOptimizer();
export { VIDEO_QUALITIES };