'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  ChevronUp,
  Clapperboard,
  CloudUpload,
  RefreshCw,
  X,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUploadManager } from './UploadManagerContext';
import { formatFileSize } from '@/lib/videoTrim';
import type { UploadJob } from '@/lib/uploads/store';

/** Circular byte-based progress ring (VANTA gold on graphite). */
function ProgressRing({ progress, size = 34, stroke = 3 }: { progress: number; size?: number; stroke?: number }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, progress));
  const offset = circumference - (clamped / 100) * circumference;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="url(#vantaUploadGrad)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 150ms linear' }}
      />
      <defs>
        <linearGradient id="vantaUploadGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f2c75c" />
          <stop offset="100%" stopColor="#c9a227" />
        </linearGradient>
      </defs>
    </svg>
  );
}

const kindIcon = (kind: UploadJob['kind']) => (kind === 'story' ? <Zap size={13} /> : <Clapperboard size={13} />);

export default function UploadIndicator() {
  const { jobs, activeCount, retryUpload, cancelUpload, dismissUpload } = useUploadManager();
  const [open, setOpen] = useState(false);

  const visible = useMemo(() => jobs.filter((job) => job.phase !== 'cancelled'), [jobs]);
  const hasActive = visible.some((job) => job.phase === 'starting' || job.phase === 'uploading' || job.phase === 'processing');
  const hasFailed = visible.some((job) => job.phase === 'failed');

  // Auto-clear completed jobs once idle (no active/failed jobs left) so the
  // tray never accumulates stale "done" rows.
  useEffect(() => {
    const completed = visible.filter((job) => job.phase === 'completed');
    if (completed.length === 0) return;
    if (hasActive || hasFailed) return; // wait until the tray is quiet
    const timer = window.setTimeout(() => {
      for (const job of completed) dismissUpload(job.id);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [hasActive, hasFailed, visible, dismissUpload]);

  if (visible.length === 0) return null;

  // Representative job drives the collapsed pill status.
  const primary = visible.find((job) => job.phase === 'uploading' || job.phase === 'starting' || job.phase === 'processing') ?? visible[0];

  const statusLabel = (() => {
    if (hasFailed && !hasActive) return `${visible.filter((j) => j.phase === 'failed').length} upload needs attention`;
    if (primary.phase === 'starting') return `Preparing ${primary.label.toLowerCase()}…`;
    if (primary.phase === 'processing') return `Finalizing ${primary.label.toLowerCase()}…`;
    if (primary.phase === 'uploading') return `Uploading ${primary.label} · ${Math.round(primary.progress)}%`;
    if (primary.phase === 'completed') return `Uploaded ${primary.label}`;
    return `${visible.length} uploads`;
  })();

  const isIdle = !hasActive && !hasFailed;

  return (
    <div className="pointer-events-none fixed inset-x-0 z-[95] flex flex-col items-center px-4" style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 76px)' }}>
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            className="pointer-events-auto mb-3 w-full max-w-[360px] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#101012]/95 shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-xl"
            role="region"
            aria-label="Upload progress"
          >
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
              <p className="text-[12px] font-semibold text-white/80">Uploads {activeCount > 0 ? `· ${activeCount} running` : ''}</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Collapse uploads"
                className="grid h-8 w-8 place-items-center rounded-lg text-white/50 transition hover:bg-white/[0.06] hover:text-white"
              >
                <ChevronUp size={16} />
              </button>
            </div>
            <ul className="max-h-[300px] overflow-y-auto overscroll-contain p-2">
              {visible.map((job) => (
                <li key={job.id} className="rounded-xl px-2 py-2 transition hover:bg-white/[0.03]">
                  <div className="flex items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-[#dfbd55]">
                      {kindIcon(job.kind)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-[13px] font-medium text-white">
                          {job.kind === 'story' ? 'Story' : 'Reel'}
                          <span className="ml-1.5 text-[11px] font-normal text-white/40">{job.fileName}</span>
                        </p>
                        <span className="shrink-0 text-[11px] tabular-nums text-white/55">
                          {job.phase === 'uploading' || job.phase === 'starting'
                            ? `${Math.round(job.progress)}%`
                            : job.phase === 'processing'
                              ? '…'
                              : job.phase === 'failed'
                                ? 'Failed'
                                : 'Done'}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.08]">
                        <div
                          className={cn(
                            'h-full rounded-full transition-[width] duration-150',
                            job.phase === 'failed'
                              ? 'bg-[#e5484d]'
                              : job.phase === 'completed'
                                ? 'bg-emerald-500'
                                : 'bg-gradient-to-r from-[#c9a227] to-[#f2c75c]'
                          )}
                          style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }}
                        />
                      </div>
                      {job.phase === 'uploading' && (
                        <p className="mt-0.5 text-[10px] tabular-nums text-white/40">
                          {formatFileSize(job.bytesSent)} / {formatFileSize(job.bytesTotal)}
                        </p>
                      )}
                      {job.phase === 'failed' && job.error && (
                        <p className="mt-0.5 line-clamp-1 text-[10px] text-[#ff8b93]">{job.error}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {job.phase === 'failed' && (
                        <button
                          type="button"
                          onClick={() => retryUpload(job)}
                          disabled={job.disabled}
                          aria-label="Retry upload"
                          className="grid h-8 w-8 place-items-center rounded-lg bg-[#c9a227]/15 text-[#dfbd55] transition hover:bg-[#c9a227]/25 active:scale-90 disabled:opacity-40"
                        >
                          <RefreshCw size={14} className={job.disabled ? 'animate-spin' : ''} />
                        </button>
                      )}
                      {(job.phase === 'uploading' || job.phase === 'starting' || job.phase === 'processing') && (
                        <button
                          type="button"
                          onClick={() => cancelUpload(job)}
                          aria-label="Cancel upload"
                          className="grid h-8 w-8 place-items-center rounded-lg text-white/50 transition hover:bg-white/[0.06] hover:text-white active:scale-90"
                        >
                          <X size={15} />
                        </button>
                      )}
                      {(job.phase === 'completed' || job.phase === 'failed') && (
                        <button
                          type="button"
                          onClick={() => dismissUpload(job.id)}
                          aria-label="Dismiss"
                          className="grid h-8 w-8 place-items-center rounded-lg text-white/35 transition hover:bg-white/[0.06] hover:text-white"
                        >
                          <X size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Collapsed pill */}
      <motion.button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Upload progress"
        className={cn(
          'pointer-events-auto flex min-h-[44px] items-center gap-2.5 rounded-full border px-3.5 py-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.45)] backdrop-blur-xl transition active:scale-[0.98]',
          hasFailed && !hasActive ? 'border-[#e5484d]/40 bg-[#2a1214]/95 text-white' : 'border-white/[0.1] bg-[#101012]/95 text-white'
        )}
      >
        <span className="relative grid h-9 w-9 place-items-center">
          {hasActive || primary.phase === 'processing' ? (
            <ProgressRing progress={primary.phase === 'processing' ? 100 : primary.progress} />
          ) : (
            <span
              className={cn(
                'grid h-8 w-8 place-items-center rounded-full',
                hasFailed && !hasActive ? 'bg-[#e5484d]/20 text-[#ff8b93]' : 'bg-[#c9a227]/15 text-[#dfbd55]'
              )}
            >
              {hasFailed && !hasActive ? <RefreshCw size={15} /> : isIdle ? <Check size={15} /> : <CloudUpload size={15} />}
            </span>
          )}
          {activeCount > 0 && (
            <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#c9a227] px-0.5 text-[9px] font-bold text-black">
              {activeCount}
            </span>
          )}
        </span>
        <span className="text-left">
          <span className="block text-[12px] font-semibold leading-tight">{statusLabel}</span>
          <span className="block text-[10px] font-medium uppercase tracking-wide text-white/40">
            {open ? 'Tap to hide' : 'Tap for details'}
          </span>
        </span>
      </motion.button>
    </div>
  );
}