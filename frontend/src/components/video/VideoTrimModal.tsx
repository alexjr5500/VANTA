'use client';

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clapperboard, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import VideoTrimEditor, { type VideoTrimResult, type VideoTrimReviewContext } from './VideoTrimEditor';

interface VideoTrimModalProps {
  open: boolean;
  file: File | null;
  onClose: () => void;
  onConfirm: (result: VideoTrimResult) => void;
  title?: string;
  subtitle?: string;
  reviewExtras?: (context: VideoTrimReviewContext) => React.ReactNode;
  confirmLabel?: string;
  trimActionLabel?: string;
  maxDurationSeconds?: number;
  maxSizeBytes?: number;
  className?: string;
}

/**
 * Reusable VANTA sheet that hosts the shared <VideoTrimEditor />.
 * Every feature that accepts a video upload (Reel, Post, Story, Chat,
 * Fundraiser cover) uses the same trimmer chrome — only the surrounding
 * title/subtitle and review-step fields are feature-specific.
 */
export default function VideoTrimModal({
  open,
  file,
  onClose,
  onConfirm,
  title = 'Trim Video',
  subtitle = 'Preview and trim the timeline before uploading',
  reviewExtras,
  confirmLabel,
  trimActionLabel,
  maxDurationSeconds,
  maxSizeBytes,
  className,
}: VideoTrimModalProps) {
  // Esc closes the trimmer (aborting any in-progress capture).
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // Lock background scroll while open.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && file && (
        <>
          <motion.div
            className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0, transition: { type: 'spring', damping: 30, stiffness: 320 } }}
            exit={{ y: '100%', transition: { duration: 0.2, ease: 'easeIn' } }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={cn(
              'fixed inset-x-0 bottom-0 z-[111] mx-auto flex h-[94dvh] w-full max-w-[480px] flex-col overflow-hidden rounded-t-[28px] border border-b-0 border-white/[0.08] bg-[#0d0d0f] shadow-[0_-12px_48px_rgba(0,0,0,0.6)]',
              className
            )}
          >
            <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/15" />

            <header className="relative flex shrink-0 items-center justify-between border-b border-white/[0.06] px-3 py-1.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-full text-[#c9a227]">
                <Clapperboard size={18} />
              </div>
              <div className="pointer-events-none min-w-0 flex-1 text-center">
                <h2 className="truncate text-[15px] font-semibold tracking-tight text-[#f5f5f5]">{title}</h2>
                <p className="truncate text-[11px] text-white/40">{subtitle}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close trimmer"
                className="grid h-10 w-10 place-items-center rounded-full text-[#c8c8cc] transition hover:bg-white/[0.06] hover:text-white active:scale-95"
              >
                <X size={19} />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide overscroll-contain px-4 pb-4">
              <VideoTrimEditor
                file={file}
                onConfirm={onConfirm}
                reviewExtras={reviewExtras}
                confirmLabel={confirmLabel}
                trimActionLabel={trimActionLabel}
                maxDurationSeconds={maxDurationSeconds}
                maxSizeBytes={maxSizeBytes}
              />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}