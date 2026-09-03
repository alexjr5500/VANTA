import path from 'path';
import fs from 'fs';
import { jobQueue, JOB_TYPES } from './queue.service';

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
    this.uploadDir = path.resolve(__dirname, '../../public/uploads');
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
    const outputDir = path.join(this.uploadDir, 'videos', baseName);
    
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const variants: Record<string, string> = {};
    const variantStreams: string[] = [];

    for (const quality of qualities) {
      const q = VIDEO_QUALITIES[quality as keyof typeof VIDEO_QUALITIES];
      if (!q) continue;

      const variantDir = path.join(outputDir, quality);
      if (!fs.existsSync(variantDir)) {
        fs.mkdirSync(variantDir, { recursive: true });
      }

      const playlistPath = `/uploads/videos/${baseName}/${quality}/playlist.m3u8`;
      variants[quality] = playlistPath;
      
      variantStreams.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${parseInt(q.bitrate) * 1000},RESOLUTION=${q.width}x${q.height}\n${quality}/playlist.m3u8`
      );
    }

    // Generate master playlist
    const masterPlaylist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      ...variantStreams,
    ].join('\n');

    const masterPath = path.join(outputDir, 'master.m3u8');
    fs.writeFileSync(masterPath, masterPlaylist);

    // Generate thumbnail
    const thumbnail = `/uploads/videos/${baseName}/thumbnail.jpg`;

    return {
      masterPlaylist: `/uploads/videos/${baseName}/master.m3u8`,
      variants,
      thumbnail,
    };
  }

  // Generate DASH manifest
  async generateDASH(inputPath: string, outputName: string, qualities: string[] = ['360p', '480p', '720p']): Promise<{
    manifest: string;
    variants: Record<string, string>;
  }> {
    const baseName = path.parse(outputName).name;
    const outputDir = path.join(this.uploadDir, 'videos', baseName);
    
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const variants: Record<string, string> = {};
    const adaptationSets: string[] = [];

    for (const quality of qualities) {
      const q = VIDEO_QUALITIES[quality as keyof typeof VIDEO_QUALITIES];
      if (!q) continue;

      const variantDir = path.join(outputDir, quality);
      if (!fs.existsSync(variantDir)) {
        fs.mkdirSync(variantDir, { recursive: true });
      }

      const mpdPath = `/uploads/videos/${baseName}/${quality}/manifest.mpd`;
      variants[quality] = mpdPath;
    }

    const manifest = `/uploads/videos/${baseName}/manifest.mpd`;

    return { manifest, variants };
  }

  // Queue thumbnail generation
  queueThumbnail(inputPath: string, outputName?: string) {
    return jobQueue.add(JOB_TYPES.THUMBNAIL_GENERATE, { inputPath, outputName, type: 'video' }, 5);
  }
}

export const videoOptimizer = new VideoOptimizer();
export { VIDEO_QUALITIES };