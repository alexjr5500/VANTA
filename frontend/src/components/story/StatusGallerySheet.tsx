'use client';

import React from 'react';
import { Camera, ChevronDown, Image as ImageIcon, LayoutTemplate, Mic, Pencil, Video } from 'lucide-react';
import type { MediaStorySource } from '@/components/story/StoryMediaEditor';
import { MAX_STATUS_MEDIA_FILES } from '@/lib/storyMedia';

interface StatusGallerySheetProps {
  source: MediaStorySource;
  onGallery: () => void;
  onCameraPhoto: () => void;
  onCameraVideo: () => void;
  onText?: () => void;
}

/**
 * Camera-roll-first Status entry point.
 * Native Android opens its secure photo library; browsers cannot enumerate a
 * user's private gallery without a file-selection gesture.
 */
export default function StatusGallerySheet({
  source,
  onGallery,
  onCameraPhoto,
  onCameraVideo,
  onText,
}: StatusGallerySheetProps) {
  const camera = source === 'camera-photo' || source === 'camera-video';

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#121719] scrollbar-hide">
      <section className="mx-auto grid w-full max-w-[440px] grid-cols-3 gap-2 px-7 pb-7 pt-2" aria-label="Status type">
        <button type="button" onClick={onText} disabled={!onText} className="flex flex-col items-center gap-2.5 text-white/90 disabled:opacity-40">
          <span className="grid h-[76px] w-[76px] place-items-center rounded-full bg-[#2a3034]"><Pencil size={28} /></span>
          <span className="text-sm font-light">Text</span>
        </button>
        <button type="button" onClick={onText} disabled={!onText} className="flex flex-col items-center gap-2.5 text-white/90 disabled:opacity-40" aria-label="Choose a text Status layout">
          <span className="grid h-[76px] w-[76px] place-items-center rounded-full bg-[#2a3034]"><LayoutTemplate size={29} /></span>
          <span className="text-sm font-light">Layout</span>
        </button>
        <button type="button" disabled aria-label="Voice status is not yet supported" title="Voice status is not yet supported" className="flex flex-col items-center gap-2.5 text-white/40">
          <span className="grid h-[76px] w-[76px] place-items-center rounded-full bg-[#2a3034]"><Mic size={30} /></span>
          <span className="text-sm font-light">Voice</span>
        </button>
      </section>

      <div className="flex items-center justify-between px-5 pb-3">
        <button type="button" onClick={onGallery} className="flex min-h-11 items-center gap-2 text-[19px] font-light text-white/55 transition hover:text-white" aria-label="Open recent photos and videos">
          Recents <ChevronDown size={18} fill="currentColor" />
        </button>
        <span className="text-[11px] text-white/35">Choose up to {MAX_STATUS_MEDIA_FILES}</span>
      </div>

      <section className="grid grid-cols-3 gap-[3px]" aria-label="Choose Status media">
        <button type="button" onClick={onCameraPhoto} aria-label="Take a photo" className="flex aspect-square flex-col items-center justify-center gap-2 bg-[#0b1116] text-[#3aa66e] transition hover:bg-[#152027]">
          <Camera size={31} />
          <span className="text-sm text-white/50">Camera</span>
        </button>
        <button type="button" onClick={onGallery} aria-label="Browse recent photos and videos" className="flex aspect-square flex-col items-center justify-center gap-2 bg-[#1e262e] text-white/80 transition hover:bg-[#2a3540]">
          <ImageIcon size={30} />
          <span className="text-sm">Photos &amp; videos</span>
        </button>
        <button type="button" onClick={onCameraVideo} aria-label="Record a video" className="flex aspect-square flex-col items-center justify-center gap-2 bg-[#1e262e] text-white/80 transition hover:bg-[#2a3540]">
          <Video size={30} />
          <span className="text-sm">Record video</span>
        </button>
      </section>
      <div className="px-6 pt-6 text-center">
        <p className="text-sm text-white/55">
          {camera ? 'Capture your moment, or choose from recent photos and videos.' : 'Tap Recents to choose photos and videos from your device.'}
        </p>
        <p className="mt-2 text-xs text-white/35">Your chosen media will appear here before posting.</p>
      </div>
    </div>
  );
}
