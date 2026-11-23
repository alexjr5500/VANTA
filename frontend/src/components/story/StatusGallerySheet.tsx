'use client';

import React from 'react';
import { ArrowRight, Camera, ChevronDown, Film, Image as ImageIcon, LayoutTemplate, Mic, Pencil, Plus, Video, X } from 'lucide-react';
import type { DraftMedia, MediaStorySource } from '@/components/story/StoryMediaEditor';
import { MAX_STATUS_MEDIA_FILES } from '@/lib/storyMedia';
import { formatVideoTime } from '@/lib/videoTrim';

type SelectedStatusMedia = Pick<DraftMedia, 'id' | 'name' | 'kind' | 'thumbUrl' | 'objectUrl' | 'duration'>;

interface StatusGallerySheetProps {
  source: MediaStorySource;
  selected: ReadonlyArray<SelectedStatusMedia>;
  selectionLimit: number;
  error?: string;
  onGallery: () => void;
  onCameraPhoto: () => void;
  onCameraVideo: () => void;
  onRemove: (id: string) => void;
  onNext: () => void;
  onText?: () => void;
}

/**
 * Gallery-first Status selection. All previews below are real thumbnails of
 * media the user chose, never fabricated device gallery placeholders.
 *
 * Browsers and WebViews cannot enumerate the private camera roll without
 * permission: Recents explicitly invokes the native photo picker instead.
 */
export default function StatusGallerySheet({
  source,
  selected,
  selectionLimit,
  error,
  onGallery,
  onCameraPhoto,
  onCameraVideo,
  onRemove,
  onNext,
  onText,
}: StatusGallerySheetProps) {
  const camera = source === 'camera-photo' || source === 'camera-video';
  const count = selected.length;
  const limit = Math.min(MAX_STATUS_MEDIA_FILES, Math.max(0, selectionLimit));

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#121719]">
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        <section className="mx-auto grid w-full max-w-[440px] grid-cols-3 gap-2 px-7 pb-6 pt-2" aria-label="Status type">
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
          <button type="button" onClick={onGallery} className="flex min-h-11 items-center gap-2 text-[19px] font-light text-white/80 transition hover:text-white" aria-label="Open device recent photos and videos">
            Recents <ChevronDown size={18} fill="currentColor" />
          </button>
          <span className="text-[11px] text-white/55" aria-live="polite">{count} / {limit} selected</span>
        </div>

        <section className="grid grid-cols-3 gap-[3px]" aria-label={count ? 'Selected Status photos and videos' : 'Choose Status media'}>
          <button type="button" onClick={onCameraPhoto} aria-label="Take a photo" className="flex aspect-square flex-col items-center justify-center gap-2 bg-[#0b1116] text-[#3aa66e] transition hover:bg-[#152027]">
            <Camera size={31} />
            <span className="text-sm text-white/60">Camera</span>
          </button>

          {selected.map((item, index) => (
            <div key={item.id} className="relative aspect-square overflow-hidden bg-[#1e262e]">
              {item.kind === 'image' || item.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.thumbUrl || item.objectUrl} alt={item.name} className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-white/65"><Film size={26} /></div>
              )}
              <span className="absolute bottom-1 left-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-[#c9a227] px-1 text-[11px] font-bold text-black" aria-label={`Selected media ${index + 1}`}>{index + 1}</span>
              {item.kind === 'video' && (
                <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1.5 py-0.5 text-[10px] text-white">
                  {item.duration ? formatVideoTime(item.duration) : 'Video'}
                </span>
              )}
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                aria-label={`Remove ${item.name}`}
                className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full border border-white/20 bg-black/80 text-white transition hover:bg-[#e5484d]"
              >
                <X size={16} />
              </button>
            </div>
          ))}

          {count < limit && (
            <button type="button" onClick={onGallery} aria-label={count ? 'Choose more photos and videos' : 'Browse recent photos and videos'} className="flex aspect-square flex-col items-center justify-center gap-2 bg-[#1e262e] text-white/85 transition hover:bg-[#2a3540]">
              {count ? <Plus size={29} /> : <ImageIcon size={30} />}
              <span className="px-1 text-center text-sm">{count ? 'Add more' : 'Photos & videos'}</span>
            </button>
          )}

          {count === 0 && (
            <button type="button" onClick={onCameraVideo} aria-label="Record a video" className="flex aspect-square flex-col items-center justify-center gap-2 bg-[#1e262e] text-white/85 transition hover:bg-[#2a3540]">
              <Video size={30} />
              <span className="text-sm">Record video</span>
            </button>
          )}
        </section>

        {error && <p role="alert" className="px-5 pt-4 text-center text-xs leading-5 text-[#ff9b9b]">{error}</p>}

        <div className="px-6 py-6 text-center">
          <p className="text-sm text-white/60">
            {count ? 'Review the selected thumbnails, or add more media from your phone.' : camera ? 'Capture your moment, or open your recent photos and videos.' : 'Tap Recents to browse the real photos and videos on your device.'}
          </p>
          <p className="mt-2 text-xs text-white/40">
            {count ? 'Tap Next to preview, add a caption, and post.' : 'Only photos and videos you choose are added to VANTA.'}
          </p>
        </div>
      </div>

      {count > 0 && (
        <footer className="shrink-0 border-t border-white/[0.07] bg-[#0b0b0e]/95 px-4 pt-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}>
          <button type="button" onClick={onNext} className="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-[#c9a227] text-[15px] font-bold text-black transition hover:bg-[#dfbd55] active:scale-[0.99]" aria-label={`Preview ${count} selected Status items`}>
            Next ({count}) <ArrowRight size={19} />
          </button>
        </footer>
      )}
    </div>
  );
}
