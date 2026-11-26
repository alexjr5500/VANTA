'use client';

import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Volume2, VolumeX } from 'lucide-react';
import VideoTrimTimeline from '@/components/video/VideoTrimTimeline';
import { generateFilmstrip, formatVideoTime, formatFileSize, estimatedStatusTrimSize } from '@/lib/videoTrim';

export type StatusTrimRange = { start: number; end: number };
type Props = {
  src: string;
  duration: number | null;
  size: number;
  poster: string | null;
  range?: StatusTrimRange;
  onRange: (range: StatusTrimRange) => void;
  showSize?: boolean;
  onDuration?: (duration: number) => void;
};

export default function StatusVideoPreview({ src, duration, size, poster, range, onRange, showSize = true, onDuration }: Props) {
  const player = useRef<HTMLVideoElement>(null);
  const [detected, setDetected] = useState(duration || 0);
  const [filmstrip, setFilmstrip] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const video = player.current;
    return () => { if (video) { video.pause(); video.muted = true; } };
  }, [src]);
  const start = Math.min(range?.start ?? 0, detected || Infinity);
  const end = Math.min(range?.end ?? detected, detected || Infinity);
  const trimmed = detected > 0 && (start > 0.01 || end < detected - 0.01);
  const displaySize = trimmed ? estimatedStatusTrimSize(size, detected, end - start) : size;
  useEffect(() => {
    if (!detected) return;
    let current = true;
    void generateFilmstrip(src, detected, 9, undefined, true).then(strip => { if (current) setFilmstrip(strip); }).catch(() => undefined);
    return () => { current = false; };
  }, [src, detected]);
  const seek = (time: number) => {
    const video = player.current;
    if (!video || !Number.isFinite(video.duration)) return;
    const next = Math.max(0, Math.min(time, video.duration));
    video.currentTime = next;
    setPosition(next);
  };
  const toggle = () => {
    const video = player.current;
    if (!video) return;
    setError(false);
    if (!video.paused) { video.pause(); return; }
    if (Number.isFinite(video.duration) && (video.currentTime < start || (end > start && video.currentTime >= end))) seek(start);
    void video.play().catch(() => setError(true));
  };
  return <div className="flex h-full min-h-0 w-full flex-1 flex-col">
    <div className="shrink-0 px-3 pb-1 pt-1">
      <VideoTrimTimeline statusStyle compact duration={detected} start={start} end={end} currentTime={position} filmstrip={filmstrip || poster}
        onRangeChange={(start, end) => { player.current?.pause(); onRange({ start, end }); seek(start); }}
        onSeek={time => { player.current?.pause(); seek(time); }} />
      <div className="mt-2 flex items-center gap-2 text-[14px] text-white">
        <button type="button" aria-label={muted ? 'Unmute video preview' : 'Mute video preview'} aria-pressed={!muted} onClick={() => setMuted(v => !v)} className="grid h-8 w-10 place-items-center rounded-full bg-[var(--surface)]">{muted ? <VolumeX size={17} /> : <Volume2 size={17} />}</button>
        <span className="rounded-full bg-black/40 px-3 py-1.5 font-normal tabular-nums">{formatVideoTime(Math.floor(Math.max(0, end-start))).replace(/^0(?=\d:)/, '')}{showSize && <> • {trimmed ? 'Est. ' : ''}{formatFileSize(displaySize)}</>}</span>
      </div>
    </div>
    <div className="relative min-h-[100px] flex-1 overflow-hidden bg-[var(--background)]">
      <video ref={player} src={src} poster={poster || undefined} preload="auto" playsInline muted={muted}
        className="absolute inset-0 h-full w-full object-contain" onCanPlay={() => { setReady(true); setError(false); }}
        onLoadedMetadata={e => { const v=e.currentTarget; if (Number.isFinite(v.duration) && v.duration>0) {setDetected(v.duration); onDuration?.(v.duration); if (start>0) v.currentTime=start;} }}
        onTimeUpdate={e => { const v=e.currentTarget; setPosition(v.currentTime); if (!v.paused && end>0 && v.currentTime>=end) {v.pause(); v.currentTime=start;} }}
        onVolumeChange={e => setMuted(e.currentTarget.muted)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => setError(true)} />
      <button type="button" aria-label={playing ? "Pause video" : "Play video"} onClick={toggle} className={`absolute inset-0 z-10 flex items-center justify-center ${playing ? "group" : ""}`}><span className={`grid h-12 w-12 place-items-center rounded-full bg-black/65 text-[var(--vanta-gold-bright)] transition-opacity ${playing ? "opacity-0 group-focus-visible:opacity-100 group-hover:opacity-100" : ""}`}>{playing ? <Pause size={23} fill="currentColor" /> : <Play size={23} fill="currentColor" />}</span></button>
      {!ready && !error && <span className="pointer-events-none absolute left-3 top-3 text-xs text-white/60">Loading video…</span>}
      {error && <p role="alert" className="pointer-events-none absolute inset-x-3 bottom-2 z-20 rounded-lg bg-black/80 p-2 text-center text-xs text-white">This device could not play the selected video. Try another video if playback remains unavailable.</p>}
    </div>
  </div>;
}
