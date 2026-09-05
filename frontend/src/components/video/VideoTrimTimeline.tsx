'use client';

import { useEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VIDEO_MIN_GAP_SECONDS, clampTime, formatVideoTime, parseVideoTimeInput } from '@/lib/videoTrim';

export interface VideoTrimTimelineProps {
  duration: number;
  start: number;
  end: number;
  currentTime: number;
  filmstrip: string | null;
  onRangeChange: (start: number, end: number) => void;
  onSeek: (time: number) => void;
  className?: string;
}

type DragMode = 'start' | 'end' | 'seek' | null;

function NudgeButton({
  direction,
  onClick,
  label,
}: {
  direction: 'minus' | 'plus';
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-white/[0.08] bg-white/[0.04] text-white/50 transition hover:bg-white/[0.08] hover:text-white active:scale-90"
    >
      {direction === 'minus' ? <Minus size={12} /> : <Plus size={12} />}
    </button>
  );
}

function TimeInput({
  value,
  min,
  max,
  onCommit,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
  label: string;
}) {
  const [text, setText] = useState(formatVideoTime(value));

  useEffect(() => {
    setText(formatVideoTime(value));
  }, [value]);

  const commit = () => {
    const parsed = parseVideoTimeInput(text);
    if (parsed === null) {
      setText(formatVideoTime(value));
      return;
    }
    onCommit(clampTime(parsed, min, max));
  };

  return (
    <input
      type="text"
      value={text}
      aria-label={label}
      inputMode="numeric"
      enterKeyHint="done"
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit();
          event.currentTarget.blur();
        }
      }}
      className="w-[54px] rounded-md border border-white/[0.06] bg-white/[0.04] px-1 py-1 text-center text-[11px] font-medium tabular-nums text-white/80 outline-none transition focus:border-white/20 focus:bg-white/[0.07] focus:text-white"
    />
  );
}
/**
 * VANTA video timeline trimmer (shared across Reel, Post, Story, Chat and
 * any future video upload flow): draggable start/end handles, filmstrip,
 * live playhead, precise mm:ss inputs and keyboard access. No custom
 * dependency â€” pointer events power mouse + touch.
 */
export default function VideoTrimTimeline({
  duration,
  start,
  end,
  currentTime,
  filmstrip,
  onRangeChange,
  onSeek,
  className,
}: VideoTrimTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragMode>(null);
  const [dragging, setDragging] = useState<DragMode>(null);

  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const startPct = safeDuration > 0 ? (start / safeDuration) * 100 : 0;
  const endPct = safeDuration > 0 ? (end / safeDuration) * 100 : 0;
  const currentPct = safeDuration > 0 ? (clampTime(currentTime, 0, safeDuration) / safeDuration) * 100 : 0;

  const timeFromPointer = (clientX: number): number => {
    const track = trackRef.current;
    if (!track || safeDuration <= 0) return 0;
    const rect = track.getBoundingClientRect();
    const ratio = clampTime((clientX - rect.left) / rect.width, 0, 1);
    return ratio * safeDuration;
  };

  const startDrag = (mode: Exclude<DragMode, null>) => {
    dragRef.current = mode;
    setDragging(mode);
  };

  const endDrag = () => {
    dragRef.current = null;
    setDragging(null);
  };

  const matchHandle = (event: React.PointerEvent) =>
    (event.target as HTMLElement).closest?.('[data-handle]');

  const handleTrackPointerDown = (event: React.PointerEvent) => {
    if (matchHandle(event)) return;
    event.preventDefault();
    startDrag('seek');
    onSeek(timeFromPointer(event.clientX));
  };

  const handleTrackPointerMove = (event: React.PointerEvent) => {
    if (dragRef.current !== 'seek') return;
    onSeek(timeFromPointer(event.clientX));
  };

  const handleHandlePointerDown = (which: 'start' | 'end', event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    startDrag(which);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleHandlePointerMove = (event: React.PointerEvent) => {
    const mode = dragRef.current;
    if (mode !== 'start' && mode !== 'end') return;
    const time = timeFromPointer(event.clientX);
    if (mode === 'start') {
      onRangeChange(clampTime(time, 0, end - VIDEO_MIN_GAP_SECONDS), end);
    } else {
      onRangeChange(start, clampTime(time, start + VIDEO_MIN_GAP_SECONDS, safeDuration));
    }
  };

  const handleHandleKeyDown = (which: 'start' | 'end', event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 5 : 1;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (which === 'start') onRangeChange(clampTime(start - step, 0, end - VIDEO_MIN_GAP_SECONDS), end);
      else onRangeChange(start, clampTime(end - step, start + VIDEO_MIN_GAP_SECONDS, safeDuration));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (which === 'start') onRangeChange(clampTime(start + step, 0, end - VIDEO_MIN_GAP_SECONDS), end);
      else onRangeChange(start, clampTime(end + step, start + VIDEO_MIN_GAP_SECONDS, safeDuration));
    }
  };
if (safeDuration <= 0) {
    return (
      <div className={cn('space-y-3', className)}>
        <div className="h-14 w-full animate-pulse rounded-xl border border-white/[0.06] bg-white/[0.03]" />
        <p className="text-center text-[11px] text-white/35">Preparing timelineâ€¦</p>
      </div>
    );
  }

  return (
    <div className={cn('select-none', className)}>
      {/* Track */}
      <div
        ref={trackRef}
        role="group"
        aria-label="Video timeline trimmer"
        className="relative h-[68px] w-full cursor-crosshair touch-none overflow-hidden rounded-xl border border-white/[0.08] bg-[#111113]"
        onPointerDown={handleTrackPointerDown}
        onPointerMove={handleTrackPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {filmstrip ? (
          <img
            src={filmstrip}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-70"
          />
        ) : (
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#202023]/70 via-[#151517] to-[#202023]/70" />
        )}
        <div className="pointer-events-none absolute inset-0 bg-[#050505]/25" />

        {/* Unselected regions */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 bg-black/55 transition-[width] duration-100"
          style={{ width: `${startPct}%` }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 bg-black/55 transition-[width] duration-100"
          style={{ width: `${100 - endPct}%` }}
        />

        {/* Selected range */}
        <div
          className="pointer-events-none absolute inset-y-0 border-x border-[#dfbd55]/70 bg-[#c9a227]/20"
          style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
        />

        {/* Duration chip */}
        <span className="pointer-events-none absolute left-1/2 top-1 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/60 px-2 py-0.5 text-[9px] font-bold tabular-nums tracking-wider text-[#dfbd55] backdrop-blur">
          {formatVideoTime(end - start)}
        </span>

        {/* Playhead */}
        <div
          className="pointer-events-none absolute inset-y-0 w-[2px] -translate-x-1/2 bg-white/90"
          style={{ left: `${currentPct}%` }}
        >
          <span className="absolute -left-[3px] top-0 h-[5px] w-[8px] rounded-b-sm bg-white/90" />
        </div>

        {/* Start handle */}
        <button
          type="button"
          role="slider"
          aria-label="Trim start handle"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, end - VIDEO_MIN_GAP_SECONDS)}
          aria-valuenow={Math.round(start * 10) / 10}
          data-handle="start"
          tabIndex={0}
          onPointerDown={(event) => handleHandlePointerDown('start', event)}
          onPointerMove={handleHandlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={(event) => handleHandleKeyDown('start', event)}
          className={cn(
            'absolute top-1/2 z-10 flex h-[calc(100%+10px)] w-7 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0d0d0f]',
            dragging === 'start' && 'scale-y-105'
          )}
          style={{ left: `${startPct}%` }}
        >
          <span className="pointer-events-none h-full w-[5px] rounded-full bg-[#dfbd55] shadow-[0_0_10px_rgba(214,168,63,0.55)]" />
          <span className="pointer-events-none absolute top-[-3px] h-[13px] w-[13px] rounded-full border-2 border-[#dfbd55] bg-[#0d0d0f] shadow-[0_0_8px_rgba(214,168,63,0.6)]" />
        </button>

        {/* End handle */}
        <button
          type="button"
          role="slider"
          aria-label="Trim end handle"
          aria-valuemin={start + VIDEO_MIN_GAP_SECONDS}
          aria-valuemax={safeDuration}
          aria-valuenow={Math.round(end * 10) / 10}
          data-handle="end"
          tabIndex={0}
          onPointerDown={(event) => handleHandlePointerDown('end', event)}
          onPointerMove={handleHandlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={(event) => handleHandleKeyDown('end', event)}
          className={cn(
            'absolute top-1/2 z-10 flex h-[calc(100%+10px)] w-7 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[#0d0d0f]',
            dragging === 'end' && 'scale-y-105'
          )}
          style={{ left: `${endPct}%` }}
        >
          <span className="pointer-events-none h-full w-[5px] rounded-full bg-[#dfbd55] shadow-[0_0_10px_rgba(214,168,63,0.55)]" />
          <span className="pointer-events-none absolute bottom-[-3px] h-[13px] w-[13px] rounded-full border-2 border-[#dfbd55] bg-[#0d0d0f] shadow-[0_0_8px_rgba(214,168,63,0.6)]" />
        </button>
      </div>
{/* Precision controls */}
      <div className="mt-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <NudgeButton
            direction="minus"
            label="Decrease start time"
            onClick={() => onRangeChange(clampTime(start - 1, 0, end - VIDEO_MIN_GAP_SECONDS), end)}
          />
          <TimeInput
            value={start}
            min={0}
            max={Math.max(0, end - VIDEO_MIN_GAP_SECONDS)}
            label="Start time in minutes and seconds"
            onCommit={(value) => onRangeChange(value, end)}
          />
          <NudgeButton
            direction="plus"
            label="Increase start time"
            onClick={() => onRangeChange(clampTime(start + 1, 0, end - VIDEO_MIN_GAP_SECONDS), end)}
          />
          <span className="ml-0.5 text-xs text-white/30">Start</span>
        </div>

        <span className="pt-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-white/35">
          {formatVideoTime(end - start)} selected
        </span>

        <div className="flex items-center gap-1.5">
          <span className="mr-0.5 text-xs text-white/30">End</span>
          <NudgeButton
            direction="minus"
            label="Decrease end time"
            onClick={() => onRangeChange(start, clampTime(end - 1, start + VIDEO_MIN_GAP_SECONDS, safeDuration))}
          />
          <TimeInput
            value={end}
            min={start + VIDEO_MIN_GAP_SECONDS}
            max={safeDuration}
            label="End time in minutes and seconds"
            onCommit={(value) => onRangeChange(start, value)}
          />
          <NudgeButton
            direction="plus"
            label="Increase end time"
            onClick={() => onRangeChange(start, clampTime(end + 1, start + VIDEO_MIN_GAP_SECONDS, safeDuration))}
          />
        </div>
      </div>
    </div>
  );
}