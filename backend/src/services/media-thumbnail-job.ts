import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { resolveLocalMediaInput, safeMediaOutputName } from './media-job-paths';

type SharpLike = (input: string) => {
  rotate(): any;
  resize(width: number, height: number, options: { fit: 'cover'; withoutEnlargement: boolean }): any;
  webp(options: { quality: number }): any;
  toFile(output: string): Promise<unknown>;
};

export interface MediaImageJob {
  inputPath: string;
  outputName: string;
}

function encoder(): SharpLike {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('sharp') as SharpLike;
  } catch {
    throw new Error('Sharp is required for media image jobs; install it in the worker image');
  }
}

/**
 * Process a local thumbnail without overwriting its source. An existing output
 * is a retry-safe no-op. No worker is started by importing this module.
 */
export async function generateLocalThumbnail(
  storageRoot: string,
  job: MediaImageJob,
  sharp?: SharpLike,
): Promise<string> {
  const input = resolveLocalMediaInput(storageRoot, job.inputPath);
  const name = safeMediaOutputName(job.outputName);
  const root = fs.realpathSync(path.resolve(storageRoot));
  const dir = path.join(root, 'thumbnails');
  fs.mkdirSync(dir, { recursive: true });
  if (fs.lstatSync(dir).isSymbolicLink() || fs.realpathSync(dir) !== dir) {
    throw new Error('Unsafe thumbnail output directory');
  }
  const destination = path.join(dir, name + '_thumb.webp');
  if (fs.existsSync(destination)) {
    if (!fs.lstatSync(destination).isFile()) throw new Error('Unsafe thumbnail output');
    if (fs.statSync(destination).size > 0) return '/uploads/thumbnails/' + name + '_thumb.webp';
    throw new Error('Existing thumbnail is empty');
  }
  const temporary = destination + '.' + crypto.randomBytes(12).toString('hex') + '.tmp';
  try {
    await (sharp ?? encoder())(input).rotate().resize(320, 180, { fit: 'cover', withoutEnlargement: true })
      .webp({ quality: 70 }).toFile(temporary);
    if (fs.statSync(temporary).size === 0) throw new Error('Encoder produced empty thumbnail');
    // Exclusive destination creation prevents concurrent jobs overwriting output.
    try {
      fs.linkSync(temporary, destination);
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      if (!fs.lstatSync(destination).isFile() || fs.statSync(destination).size === 0) {
        throw new Error('Concurrent thumbnail output is invalid');
      }
    }
    return '/uploads/thumbnails/' + name + '_thumb.webp';
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
