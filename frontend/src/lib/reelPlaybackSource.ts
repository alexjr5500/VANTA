/**
 * Prefer adaptive HLS only on browsers that support it natively.
 * On any failure or unsupported browser, keep the original MP4 unchanged.
 */
export function chooseReelPlaybackSource(
  mp4Url: string,
  hlsUrl: string | null | undefined,
  nativeHlsSupported: boolean,
  hlsFailed: boolean,
): string {
  return nativeHlsSupported && !hlsFailed && hlsUrl ? hlsUrl : mp4Url;
}
