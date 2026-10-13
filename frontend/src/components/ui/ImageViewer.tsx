'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ImageViewerProps {
  /** Fully-resolved image URL to display, or null to keep the viewer closed. */
  src: string | null;
  /** Accessible description of the image (e.g. "Alex's profile picture"). */
  alt?: string;
  onClose: () => void;
}

/**
 * Reusable, accessible full-screen image viewer for profile pictures and cover
 * photos. Keeps VANTA's dark premium surface, preserves the image aspect ratio,
 * centres it, and provides an obvious close action (button, Escape, tap outside).
 * Prevents background scrolling while open and shows loading / error states.
 *
 * A single component is shared by avatars and cover photos so behaviour stays
 * identical everywhere (no divergent second implementation).
 */
export default function ImageViewer({ src, alt = 'Image', onClose }: ImageViewerProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  // Reset per-image state whenever a new source is opened.
  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [src]);

  // Escape to close + prevent background scroll while open.
  useEffect(() => {
    if (!src) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [src, onClose]);

  const handleClose = useCallback(() => onClose(), [onClose]);

  return (
    <AnimatePresence>
      {src && (
        <motion.div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 p-3 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onClick={handleClose}
        >
          {/* Close button */}
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close image"
            className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-10 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <X size={20} aria-hidden="true" />
          </button>

          {/* Loading spinner */}
          {!loaded && !failed && (
            <div className="absolute grid place-items-center text-white/60">
              <Loader2 size={28} className="animate-spin" aria-hidden="true" />
            </div>
          )}

          {/* Error state */}
          {failed ? (
            <div className="max-w-xs text-center text-sm text-white/60">
              This image could not be loaded.
            </div>
          ) : (
            <motion.img
              key={src}
              src={src}
              alt={alt}
              draggable={false}
              onClick={(event) => event.stopPropagation()}
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: loaded ? 1 : 0, scale: loaded ? 1 : 0.97 }}
              transition={{ duration: 0.18 }}
              className={cn(
                'max-h-[calc(100dvh-1.5rem)] max-w-full rounded-[var(--radius-lg)] object-contain shadow-2xl',
                loaded ? 'block' : 'invisible'
              )}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
