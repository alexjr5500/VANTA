/**
 * Read-only CDN acceptance probe. Run only on staging assets you control.
 * Unlike a returned eager URL, a playable stream must have a valid master,
 * variant playlist and a retrievable, nonempty media segment.
 */
export interface CloudinaryHlsProbeResult {
  variantsChecked: number;
  segmentsChecked: number;
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;
const MANIFEST_LIMIT = 256 * 1024;
const SEGMENT_SAMPLE_LIMIT = 4096;
const REQUEST_TIMEOUT_MS = 10000;

function allowedUrl(value: string, cloudName: string, extension: RegExp): URL {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(cloudName)) {
    throw new Error('Invalid staging Cloudinary account name');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid staging media URL');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com' ||
      url.port || url.username || url.password || url.search || url.hash ||
      !url.pathname.startsWith('/' + cloudName + '/video/upload/') ||
      !extension.test(url.pathname)) {
    throw new Error('Staging media URL must remain on the expected public Cloudinary account');
  }
  return url;
}

async function readBounded(response: Response, limit: number, allowSample: boolean): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Media response body is empty');
  const chunks: Buffer[] = [];
  let received = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value || !value.byteLength) continue;
      if (received + value.byteLength > limit) {
        if (!allowSample) throw new Error('HLS manifest exceeds safe size limit');
        const remaining = limit - received;
        if (remaining > 0) chunks.push(Buffer.from(value.slice(0, remaining)));
        received = limit;
        break;
      }
      chunks.push(Buffer.from(value));
      received += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks);
}

interface ByteRange { start: number; length: number }
async function retrieve(url: URL, fetcher: Fetcher, playlist: boolean, range?: ByteRange): Promise<Buffer> {
  const start = range?.start ?? 0;
  const end = start + Math.min(range?.length ?? SEGMENT_SAMPLE_LIMIT, SEGMENT_SAMPLE_LIMIT) - 1;
  const response = await fetcher(url.href, {
    method: 'GET',
    redirect: 'manual',
    headers: playlist ? { Accept: 'application/vnd.apple.mpegurl' } : { Range: 'bytes=' + start + '-' + end },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (playlist ? response.status !== 200 : ![200, 206].includes(response.status)) {
    throw new Error('HLS resource unavailable (HTTP ' + response.status + ')');
  }
  if (range) {
    const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(response.headers.get('content-range') || '');
    if (response.status !== 206 || !match || Number(match[1]) !== start || Number(match[2]) !== end) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error('HLS segment byte range was not honored');
    }
  }
  const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (mime === 'text/html' ||
      (playlist && mime && !['application/vnd.apple.mpegurl', 'application/x-mpegurl',
                            'audio/mpegurl', 'application/octet-stream', 'text/plain'].includes(mime))) {
    throw new Error('HLS endpoint did not return a playlist or media segment');
  }
  const bytes = await readBounded(response, playlist ? MANIFEST_LIMIT : Math.min(range?.length ?? SEGMENT_SAMPLE_LIMIT, SEGMENT_SAMPLE_LIMIT), !playlist);
  if (range && bytes.length !== end - start + 1) throw new Error('HLS segment byte range is incomplete');
  return bytes;
}

function playlistLines(bytes: Buffer): string[] {
  if (!bytes.length) throw new Error('HLS playlist is empty');
  const lines = bytes.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
    .map(line => line.trim()).filter(Boolean);
  if (lines[0] !== '#EXTM3U') throw new Error('HLS playlist is missing the required header');
  return lines;
}

function resolveChild(base: URL, reference: string, account: string, extension: RegExp): URL {
  if (!reference || reference.startsWith('#')) throw new Error('Invalid HLS playlist reference');
  // URL resolves ordinary relative HLS paths; account validation rejects
  // absolute external links, protocol-relative URLs, query tokens and traversal.
  return allowedUrl(new URL(reference, base).href, account, extension);
}

export async function verifyPublicCloudinaryHls(
  manifestUrl: string,
  cloudName: string,
  fetcher: Fetcher = fetch,
): Promise<CloudinaryHlsProbeResult> {
  const masterUrl = allowedUrl(manifestUrl, cloudName, /\.m3u8$/i);
  const master = playlistLines(await retrieve(masterUrl, fetcher, true));
  const variants: URL[] = [];
  for (let i = 0; i < master.length; i++) {
    if (master[i].startsWith('#EXT-X-STREAM-INF:')) {
      const next = master[i + 1];
      variants.push(resolveChild(masterUrl, next, cloudName, /\.m3u8$/i));
      i++;
    }
  }
  if (!variants.length || variants.length > 6) {
    throw new Error('HLS master must reference 1-6 variant playlists');
  }
  const visited = new Set<string>();
  for (const variantUrl of variants) {
    if (visited.has(variantUrl.href)) throw new Error('Duplicate HLS variant URL');
    visited.add(variantUrl.href);
    const lines = playlistLines(await retrieve(variantUrl, fetcher, true));
    if (!lines.includes('#EXT-X-ENDLIST')) {
      throw new Error('HLS variant is incomplete: missing ENDLIST');
    }
    // EXTINF describes the next media URI, not necessarily the next line.
    // RFC 8216 permits EXT-X-BYTERANGE and other segment metadata between them.
    let firstSegment: string | undefined;
    let range: ByteRange | undefined;
    let durationSeen = false;
    for (const line of lines.slice(1)) {
      if (line.startsWith('#EXTINF:')) {
        if (durationSeen) throw new Error('Invalid HLS playlist reference');
        durationSeen = true;
      } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
        const match = /^#EXT-X-BYTERANGE:(\d+)@(\d+)$/.exec(line);
        // The first segment cannot inherit an offset from a previous segment.
        if (!match || range) throw new Error('Invalid first HLS segment byte range');
        const length = Number(match[1]);
        const start = Number(match[2]);
        if (!Number.isSafeInteger(length) || length <= 0 || !Number.isSafeInteger(start) ||
            !Number.isSafeInteger(start + length - 1)) throw new Error('Invalid first HLS segment byte range');
        range = { start, length };
      } else if (!line.startsWith('#')) {
        if (!durationSeen) throw new Error('Invalid HLS playlist reference');
        firstSegment = line;
        break;
      } else if (line === '#EXT-X-ENDLIST' ||
                 (durationSeen && line.startsWith('#EXT') &&
                  !line.startsWith('#EXT-X-PROGRAM-DATE-TIME:') && line !== '#EXT-X-DISCONTINUITY')) {
        throw new Error('Invalid HLS playlist reference');
      }
    }
    if (!firstSegment) throw new Error('HLS variant has no media segments');
    const segmentUrl = resolveChild(variantUrl, firstSegment, cloudName, /\.(?:ts|m4s|mp4)$/i);
    const sample = await retrieve(segmentUrl, fetcher, false, range);
    if (!sample.length || (segmentUrl.pathname.toLowerCase().endsWith('.ts') && sample[0] !== 0x47)) {
      throw new Error('HLS variant segment is empty or not valid transport-stream media');
    }
  }
  return { variantsChecked: variants.length, segmentsChecked: visited.size };
}
