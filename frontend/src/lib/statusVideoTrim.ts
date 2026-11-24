import { buildTrimmedVideoFile, trimVideoSegment, VIDEO_MIN_GAP_SECONDS } from './videoTrim';
import { validateStoryMediaFile } from './storyMedia';

export type StatusTrimRange = { start: number; end: number };

export function statusRangeNeedsTrim(range: StatusTrimRange | undefined, duration: number | null): boolean {
  return Boolean(range && (range.start > 0.01 || (duration && range.end < duration - 0.01)));
}

/** Materialize the selected range BEFORE creating any server drafts. */
export async function prepareStatusVideo(file: File, src: string, range: StatusTrimRange, signal: AbortSignal): Promise<File> {
  if (signal.aborted) throw new DOMException('Trimming cancelled', 'AbortError');
  const video = document.createElement('video');
  video.playsInline = true;
  video.preload = 'auto';
  video.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.appendChild(video);
  try {
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = () => { clearTimeout(timer); video.removeEventListener('loadeddata', ready); video.removeEventListener('error', fail); signal.removeEventListener('abort', abort); };
      const ready = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(new Error('This video could not be opened for trimming.')); };
      const abort = () => { cleanup(); reject(new DOMException('Trimming cancelled', 'AbortError')); };
      timer = setTimeout(fail, 12000);
      video.addEventListener('loadeddata', ready, { once: true });
      video.addEventListener('error', fail, { once: true });
      signal.addEventListener('abort', abort, { once: true });
      video.src = src;
      video.load();
      if (video.readyState >= 2) ready();
      if (signal.aborted) abort();
    });
    const start = Math.max(0, range.start);
    const end = Math.min(range.end, video.duration);
    if (!Number.isFinite(end) || end - start < VIDEO_MIN_GAP_SECONDS) throw new Error('Select a valid video range.');
    if (start <= 0.01 && end >= video.duration - 0.01) return file;
    if (signal.aborted) throw new DOMException('Trimming cancelled', 'AbortError');
    const blob = await trimVideoSegment({ video, start, end, signal });
    if (signal.aborted) throw new DOMException('Trimming cancelled', 'AbortError');
    if (!blob.size) throw new Error('The trimmed video is empty. Adjust the range and try again.');
    const result = buildTrimmedVideoFile(blob, file.name);
    const issue = validateStoryMediaFile(result);
    if (issue) throw new Error(issue);
    return result;
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
  }
}
