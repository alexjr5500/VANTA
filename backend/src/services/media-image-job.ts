import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { resolveLocalMediaInput, safeMediaOutputName } from './media-job-paths';

export interface OptimizeImageJob { inputPath: string; outputName: string; maxWidth?: number; }

export async function optimizeLocalImage(storageRoot: string, job: OptimizeImageJob): Promise<string> {
  const input = resolveLocalMediaInput(storageRoot, job.inputPath);
  const name = safeMediaOutputName(job.outputName);
  const maxWidth = job.maxWidth ?? 1200;
  if (!Number.isInteger(maxWidth) || maxWidth < 64 || maxWidth > 3840) {
    throw new Error('Invalid image width');
  }
  const root = fs.realpathSync(path.resolve(storageRoot));
  const dir = path.join(root, 'optimized');
  fs.mkdirSync(dir, { recursive: true });
  if (fs.realpathSync(dir) !== dir) throw new Error('Unsafe image output directory');
  const destination = path.join(dir, name + '.webp');
  if (fs.existsSync(destination)) {
    if (!fs.lstatSync(destination).isFile() || fs.statSync(destination).size === 0) {
      throw new Error('Unsafe or incomplete optimized image');
    }
    return '/uploads/optimized/' + name + '.webp';
  }
  let sharp: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    sharp = require('sharp');
  } catch {
    throw new Error('Sharp must be installed in the media worker image');
  }
  const temporary = destination + '.' + crypto.randomBytes(12).toString('hex') + '.tmp';
  try {
    await sharp(input).rotate().resize({ width: maxWidth, withoutEnlargement: true })
      .webp({ quality: 80 }).toFile(temporary);
    if (fs.statSync(temporary).size === 0) throw new Error('Encoder produced an empty image');
    try {
      fs.linkSync(temporary, destination);
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      if (!fs.lstatSync(destination).isFile() || fs.statSync(destination).size === 0) {
        throw new Error('Concurrent optimized image output is invalid');
      }
    }
    return '/uploads/optimized/' + name + '.webp';
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
