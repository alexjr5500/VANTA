'use client';

import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Volume2, VolumeX } from 'lucide-react';
import VideoTrimTimeline from '@/components/video/VideoTrimTimeline';
import { generateFilmstrip, formatVideoTime, formatFileSize } from '@/lib/videoTrim';

export type StatusTrimRange = { start: number; end: number };
type Props = {
  src: string;
  duration: number | null;
  size: number;
  poster: string | null;
  range?: StatusTrimRange;
  onRange: (range: StatusTrimRange) => void;
};

export default function StatusVideoPreview({ src, duration, size, poster, range, onRange }: Props) {
  const player = useRef<HTMLVideoElement>(null);
  const [detected, setDetected] = useState(duration || 0);
  const [filmstrip, setFilmstrip] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [error, setError] = useState(false);
  const start = range?.start ?? 0;
  const end = range?.end ?? detected;
  useEffect(() => {
    if (!detected) return;
    let current = true;
    void generateFilmstrip(src, detected).then(strip => { if (current) setFilmstrip(strip); }).catch(() => undefined);
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
    if (!video.paused) { video.pause(); return; }
    if (video.currentTime < start || video.currentTime >= end) seek(start);
    void video.play().catch(() => setError(true));
  };
  return <div className="flex h-full min-h-0 w-full flex-col">
    <div className="shrink-0 px-3 pb-1 pt-1">
      <VideoTrimTimeline compact duration={detected} start={start} end={end} currentTime={position} filmstrip={filmstrip}
        onRangeChange={(start, end) => { player.current?.pause(); onRange({ start, end }); seek(start); }}
        onSeek={time => { player.current?.pause(); seek(time); }} />
      <div className="mt-1 flex items-center justify-between text-[10px] text-white/55">
        <button type="button" aria-label={muted ? 'Unmute video preview' : 'Mute video preview'} onClick={() => setMuted(v => !v)} className="text-[#dfbd55]">{muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
        <span>{formatVideoTime(Math.max(0,end-start))} · {formatFileSize(size)}</span>
        {range && <button type="button" onClick={() => { onRange({ start: 0, end: detected }); seek(0); }} className="text-[#dfbd55]">Reset</button>}
      </div>
    </div>
    <div className="relative min-h-0 flex-1 overflow-hidden bg-[var(--background)]">
      <video ref={player} src={src} poster={poster || undefined} preload="auto" playsInline muted={muted}
        className="absolute inset-0 h-full w-full object-contain"
        onLoadedMetadata={e => { const v=e.currentTarget; if (Number.isFinite(v.duration) && v.duration>0) {setDetected(v.duration); if (start>0) v.currentTime=start;} }}
        onTimeUpdate={e => { const v=e.currentTarget; setPosition(v.currentTime); if (!v.paused && end>0 && v.currentTime>=end) {v.pause(); v.currentTime=start;} }}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => setError(true)} />
      <button type="button" aria-label={playing ? 'Pause video' : 'Play video'} onClick={toggle} className="absolute inset-0 grid place-items-center">
        <span className={playing ? 'sr-only' : 'grid h-12 w-12 place-items-center rounded-full bg-black/55 text-[#dfbd55]'}>{playing ? <Pause size={23} /> : <Play size={23} fill="currentColor" />}</span>
      </button>
      {error && <p role="alert" className="absolute inset-x-3 bottom-2 rounded-lg bg-black/80 p-2 text-center text-xs text-white">This device could not play the selected video. Try another video if playback remains unavailable.</p>}
    </div>
  </div>;
}
