import path from 'path';
import fs from 'fs';
import { jobQueue, JOB_TYPES } from './queue.service';

function getSharp() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('sharp');
  } catch {
    return null;
  }
}

// Image optimization configuration
const IMAGE_SIZES = {
  AVATAR: { width: 150, height: 150 },
  THUMBNAIL: { width: 320, height: 180 },
  SMALL: { width: 480, height: 480 },
  MEDIUM: { width: 800, height: 800 },
  LARGE: { width: 1200, height: 1200 },
  BANNER: { width: 1920, height: 480 },
  COVER: { width: 1920, height: 1080 },
};

const QUALITY = {
  HIGH: 85,
  MEDIUM: 70,
  LOW: 50,
};

interface OptimizeOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: 'webp' | 'avif' | 'jpeg' | 'png';
  crop?: 'cover' | 'contain' | 'fill';
}

class ImageOptimizer {
  private uploadDir: string;

  constructor() {
    this.uploadDir = path.resolve(process.env.UPLOAD_STORAGE_DIR || path.resolve(__dirname, '../../public/uploads'));
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  // Optimize an image with multiple format outputs
  async optimize(
    inputPath: string,
    filename: string,
    options: OptimizeOptions = {}
  ): Promise<{ webp?: string; avif?: string; original: string }> {
    const { width, height, quality = QUALITY.HIGH, format = 'webp' } = options;
    const baseName = path.parse(filename).name;
    const outputDir = path.join(this.uploadDir, 'optimized');
    
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const results: { webp?: string; avif?: string; original: string } = { original: inputPath };

    // Never relabel source bytes as WebP. Browsers reject that mismatch when
    // `nosniff` is enabled, so the upload service must retain the original URL.
    if (!getSharp()) return results;

    // Generate WebP
    const webpPath = path.join(outputDir, `${baseName}.webp`);
    await this.convertImage(inputPath, webpPath, { ...options, format: 'webp' });
    results.webp = `/uploads/optimized/${baseName}.webp`;

    // Generate AVIF (better compression)
    try {
      const avifPath = path.join(outputDir, `${baseName}.avif`);
      await this.convertImage(inputPath, avifPath, { ...options, format: 'avif', quality: quality - 5 });
      results.avif = `/uploads/optimized/${baseName}.avif`;
    } catch {
      // AVIF not supported, skip
    }

    // Generate responsive sizes
    const sizes: Record<string, string> = {};
    for (const [sizeName, dimensions] of Object.entries(IMAGE_SIZES)) {
      if (dimensions.width <= (width || Infinity)) {
        try {
          const sizePath = path.join(outputDir, `${baseName}_${sizeName}.webp`);
          await this.convertImage(inputPath, sizePath, {
            width: dimensions.width,
            height: dimensions.height,
            format: 'webp',
            quality: quality - 10,
            crop: 'cover',
          });
          sizes[sizeName] = `/uploads/optimized/${baseName}_${sizeName}.webp`;
        } catch {
          // Skip if conversion fails
        }
      }
    }

    // Queue cleanup of original
    await jobQueue.add(JOB_TYPES.CLEANUP_TEMP, { path: inputPath, delay: 3600000 }, 1);

    return results;
  }

  // Convert single image
  private async convertImage(
    inputPath: string,
    outputPath: string,
    options: OptimizeOptions
  ): Promise<void> {
    const { width, height, quality = QUALITY.MEDIUM, format = 'webp', crop = 'cover' } = options;
    
    const sharpLib = getSharp();
    if (!sharpLib) throw new Error('Image encoder is unavailable');
    let pipeline = sharpLib(inputPath);

    // Resize if dimensions provided
    if (width || height) {
      pipeline = pipeline.resize(width, height, {
        fit: crop as any,
        withoutEnlargement: true,
      });
    }

    // Convert format
    switch (format) {
      case 'webp':
        pipeline = pipeline.webp({ quality, effort: 6 });
        break;
      case 'avif':
        pipeline = pipeline.avif({ quality, effort: 6 });
        break;
      case 'jpeg':
        pipeline = pipeline.jpeg({ quality, mozjpeg: true });
        break;
      case 'png':
        pipeline = pipeline.png({ quality, compressionLevel: 9 });
        break;
    }

    await pipeline.toFile(outputPath);
  }

  // Generate a blur placeholder (tiny base64)
  async generateBlurPlaceholder(inputPath: string): Promise<string> {
    const sharpLib = getSharp();
    if (!sharpLib) {
      return `data:image/webp;base64,`;
    }
    const buffer = await sharpLib(inputPath)
      .resize(10, 10, { fit: 'cover' })
      .webp({ quality: 20 })
      .toBuffer();
    
    return `data:image/webp;base64,${buffer.toString('base64')}`;
  }

  // Generate thumbnail
  async generateThumbnail(inputPath: string, outputName?: string): Promise<string> {
    const baseName = outputName || path.parse(inputPath).name;
    const outputPath = path.join(this.uploadDir, 'thumbnails', `${baseName}_thumb.webp`);
    
    if (!fs.existsSync(path.dirname(outputPath))) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    }

    await this.convertImage(inputPath, outputPath, {
      width: IMAGE_SIZES.THUMBNAIL.width,
      height: IMAGE_SIZES.THUMBNAIL.height,
      format: 'webp',
      quality: QUALITY.MEDIUM,
      crop: 'cover',
    });

    return `/uploads/thumbnails/${baseName}_thumb.webp`;
  }

  // Queue image optimization job
  queueOptimization(inputPath: string, filename: string, options?: OptimizeOptions) {
    return jobQueue.add(JOB_TYPES.IMAGE_OPTIMIZE, { inputPath, filename, options }, 5);
  }

  // Queue thumbnail generation job
  queueThumbnail(inputPath: string, outputName?: string) {
    return jobQueue.add(JOB_TYPES.THUMBNAIL_GENERATE, { inputPath, outputName }, 5);
  }
}

export const imageOptimizer = new ImageOptimizer();