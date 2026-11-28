export interface CurrentReelVideo {
  id: string;
  videoUrl: string | null;
}
export interface LinkedReelDerivative {
  recordId: string | null;
  url: string;
  hlsUrl: string | null;
}

/**
 * Only expose a completed HLS stream for the very same uploaded file that is
 * currently published as the Reel's MP4 fallback. Stale linked uploads must
 * never override it, even when their HLS job finished most recently.
 */
export function mapCurrentReelHls(
  reels: readonly CurrentReelVideo[],
  files: readonly LinkedReelDerivative[],
): Map<string, string> {
  const currentUrls = new Map(reels
    .filter((reel): reel is CurrentReelVideo & { videoUrl: string } =>
      typeof reel.videoUrl === 'string' && reel.videoUrl.length > 0)
    .map(reel => [reel.id, reel.videoUrl]));
  const result = new Map<string, string>();
  for (const file of files) {
    if (!file.recordId || !file.hlsUrl || result.has(file.recordId)) continue;
    if (file.url !== currentUrls.get(file.recordId)) continue;
    result.set(file.recordId, file.hlsUrl);
  }
  return result;
}
