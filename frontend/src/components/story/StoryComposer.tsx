'use client';

import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  Camera,
  Image as ImageIcon,
  MessagesSquare,
  Sparkles,
  Video,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import StoryComposerTextStory from '@/components/story/TextStoryEditor';
import StatusComposer from '@/components/story/StatusComposer';
import StoryMediaEditor, { MediaStorySource } from '@/components/story/StoryMediaEditor';

export type StoryComposerMode = 'menu' | 'text' | 'status' | 'media';

export interface StoryComposerProps {
  open: boolean;
  onClose: () => void;
}

export interface StoryComposerOpenDetails {
  mode: StoryComposerMode;
  mediaSource?: MediaStorySource;
}

export type StoryComposerOpener = (details: StoryComposerOpenDetails) => void;

// Global open command so any consumer (Home tray, header button, profile) can
// open the composer without prop drilling into every page.
let openCommand: ((details: StoryComposerOpenDetails) => void) | null = null;
export function setStoryComposerOpener(fn: StoryComposerOpener | null): void {
  openCommand = fn;
}
export function openStoryComposer(details: StoryComposerOpenDetails): void {
  openCommand?.(details);
}

export interface StoryComposerMenuItem {
  id: Exclude<StoryComposerMode, 'menu'>;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  label: string;
  description: string;
  accent: string;
  mediaSource?: MediaStorySource;
}

export const STORY_MENU_ITEMS: StoryComposerMenuItem[] = [
  { id: 'media', icon: Camera, label: 'Camera', description: 'Capture a photo instantly', accent: 'bg-[#dce7ff] text-[#17264a]', mediaSource: 'camera-photo' },
  { id: 'media', icon: ImageIcon, label: 'Photo', description: 'Choose a photo from your gallery', accent: 'bg-[#dff2e7] text-[#0f3d24]', mediaSource: 'gallery-image' },
  { id: 'media', icon: Video, label: 'Video', description: 'Record or pick a short video', accent: 'bg-[#f7e5d8] text-[#5a2b10]', mediaSource: 'gallery-video' },
  { id: 'status', icon: MessagesSquare, label: 'Text Story', description: 'Write a Status · up to 700 characters', accent: 'bg-white/[0.07] text-[#c9a227]' },
];

/**
 * Full-screen Story/Status creation environment.
 * No traditional forms — an edge-to-edge canvas-first composer with minimal
 * chrome, safe-area awareness and a clear menu between Story modes.
 */
export default function StoryComposer({ open, onClose }: StoryComposerProps) {
  const [mode, setMode] = useState<StoryComposerMode>('menu');
  const [mediaSource, setMediaSource] = useState<MediaStorySource>('gallery-image');

  // Receive global open commands (e.g. from the Home tray's add button).
  useEffect(() => {
    setStoryComposerOpener(details => {
      if (details.mode === 'media') setMediaSource(details.mediaSource || 'gallery-image');
      setMode(details.mode);
    });
    return () => setStoryComposerOpener(null);
  }, []);

  // Lock scroll while the composer is open.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const handleClose = () => {
    setMode('menu');
    onClose();
  };

  const closed = !open;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Create a Story or Status"
          className="fixed inset-0 z-[55] bg-[#050506] text-white"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          {mode === 'menu' && (
            <Menu
              onPick={(next, source) => {
                if (next === 'media' && source) setMediaSource(source);
                setMode(next);
              }}
              onClose={handleClose}
            />
          )}

          <AnimatePresence mode="wait">
            {mode === 'text' && (
              <motion.div
                key="text"
                className="fixed inset-0"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 24 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              >
                <StoryComposerTextStory onBack={() => setMode('menu')} onClose={handleClose} />
              </motion.div>
            )}

            {mode === 'status' && (
              <motion.div
                key="status"
                className="fixed inset-0"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 24 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              >
                <StatusComposer onBack={() => setMode('menu')} onClose={handleClose} />
              </motion.div>
            )}

            {mode === 'media' && (
              <motion.div
                key="media"
                className="fixed inset-0"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 24 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              >
                <StoryMediaEditor
                  source={mediaSource}
                  onBack={() => setMode('menu')}
                  onClose={handleClose}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {closed && null}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Menu({
  onPick,
  onClose,
}: {
  onPick: (mode: Exclude<StoryComposerMode, 'menu'>, source?: MediaStorySource) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between px-4 pb-2 pt-[max(env(safe-area-inset-top,0px),14px)]">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-[#c9a227]/15 text-[#dfbd55]">
            <Sparkles size={18} />
          </span>
          <div>
            <h2 className="text-[17px] font-semibold leading-tight">New Story or Status</h2>
            <p className="text-xs text-white/45">Pick how you want to share.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close creation"
          className="grid h-11 w-11 place-items-center rounded-full text-[#8a8a8a] transition hover:bg-white/[0.06] hover:text-white"
        >
          <X size={20} />
        </button>
      </header>

      {/* Options */}
      <div className="flex-1 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom,0px),20px)]">
        <div className="space-y-2.5">
          {STORY_MENU_ITEMS.map((item, index) => {
            const Icon = item.icon;
            return (
              <motion.button
                key={`${item.id}-${item.label}`}
                type="button"
                onClick={() => onPick(item.id, item.mediaSource)}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.04 + index * 0.035, duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                className="group flex min-h-[72px] w-full items-center gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3.5 text-left transition hover:border-white/[0.16] hover:bg-white/[0.055] active:scale-[0.99]"
              >
                <span className={cn('grid h-12 w-12 shrink-0 place-items-center rounded-xl transition-transform group-hover:scale-105', item.accent)}>
                  <Icon size={21} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold">{item.label}</span>
                  <span className="mt-0.5 block text-xs text-white/45">{item.description}</span>
                </span>
                <ArrowLeft size={16} className="ml-auto -rotate-180 text-white/20 transition group-hover:text-white/50" />
              </motion.button>
            );
          })}
        </div>

        <p className="mt-7 text-center text-[11px] leading-5 text-[#555]">
          Stories vanish after 24 hours.
          <br />
          Your Status keeps a daily quota — verified creators go unlimited.
        </p>
      </div>
    </div>
  );
}