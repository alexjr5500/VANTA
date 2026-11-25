/** Capture ONE small JPEG from the already-published host camera, not a new camera session. */
export async function captureLivePreviewFrame(track: MediaStreamTrack, signal: AbortSignal): Promise<Blob | null> {
  if (signal.aborted || track.kind !== 'video' || track.readyState !== 'live' || !track.enabled || track.muted) return null;
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.appendChild(video);
  try {
    video.srcObject = new MediaStream([track]);
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); video.removeEventListener('loadeddata', ready); video.removeEventListener('error', fail); signal.removeEventListener('abort', fail); };
      const ready = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(new Error('No live preview frame')); };
      const timer = setTimeout(fail, 5000);
      video.addEventListener('loadeddata', ready, {once:true});
      video.addEventListener('error', fail, {once:true});
      signal.addEventListener('abort', fail, {once:true});
      if (signal.aborted) fail();
      else if (video.readyState >= 2) ready();
      else void video.play().catch(fail);
    });
    if (signal.aborted || !track.enabled || track.muted || track.readyState !== 'live' || !video.videoWidth || !video.videoHeight) return null;
    const scale = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .72));
    return signal.aborted ? null : blob;
  } catch {
    return null;
  } finally {
    video.pause();
    video.srcObject = null;
    video.remove();
    // Do not stop the underlying track: it is still broadcasting.
  }
}
