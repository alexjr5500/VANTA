'use client';

import React from 'react';
import { ArrowRight, Camera, ChevronDown, Film, Image as ImageIcon, Pencil, Plus, X } from 'lucide-react';
import type { MediaStorySource } from '@/components/story/StoryMediaEditor';
import { getStatusGallerySelection, type StatusGalleryMedia } from '@/lib/statusGallerySelection';
import { formatVideoTime } from '@/lib/videoTrim';
import type { NativeRecentMedia, NativeGalleryStatus } from '@/lib/nativeStatusGallery';

type SelectedStatusMedia = StatusGalleryMedia;

interface StatusGallerySheetProps {
  source: MediaStorySource;
  selected: ReadonlyArray<SelectedStatusMedia>;
  selectionLimit: number;
  error?: string;
  recentMedia?: ReadonlyArray<NativeRecentMedia>;
  nativeGalleryStatus?: NativeGalleryStatus;
  pickingRecentId?: string | null;
  onPickRecent?: (item: NativeRecentMedia) => void;
  onGrantGallery?: () => void;
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
  selected,
  selectionLimit,
  error,
  recentMedia = [],
  nativeGalleryStatus = 'unavailable',
  pickingRecentId,
  onPickRecent,
  onGrantGallery,
  onGallery,
  onCameraPhoto,
  onRemove,
  onNext,
  onText,
}: StatusGallerySheetProps) {
  const { count, limit, canAddMore, tiles } = getStatusGallerySelection(selected, selectionLimit);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#121719]">
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        <section className="flex items-center justify-center py-3" aria-label="Status type">
          <button type="button" onClick={onText} disabled={!onText} className="flex flex-col items-center gap-1.5 text-white/90 disabled:opacity-40">
            <span className="grid h-[48px] w-[48px] place-items-center rounded-full bg-[#2a3034]"><Pencil size={19} /></span>
            <span className="text-xs font-light">Text</span>
          </button>
        </section>

        <div className="flex items-center justify-between px-5 pb-3">
          <button type="button" onClick={onGallery} className="flex min-h-11 items-center gap-2 text-[19px] font-light text-white/80 transition hover:text-white" aria-label="Open device recent photos and videos">
            Recents <ChevronDown size={18} fill="currentColor" />
          </button>
          <span className="text-[11px] text-white/55" aria-live="polite">{count} / {limit} selected</span>
        </div>

        <section className="grid grid-cols-3 gap-[3px]" aria-label="Recent and selected Status photos and videos">
          <button type="button" onClick={onCameraPhoto} aria-label="Take a photo" className="flex aspect-square flex-col items-center justify-center gap-2 bg-[#0b1116] text-[#3aa66e] transition hover:bg-[#152027]">
            <Camera size={31} />
            <span className="text-sm text-white/60">Camera</span>
          </button>

          {tiles.map((item) => (
            <div key={item.id} className="relative aspect-square overflow-hidden bg-[#1e262e]">
              {item.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.previewUrl} alt={item.name} className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-white/65"><Film size={26} /></div>
              )}
              <span className="absolute bottom-1 left-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-[#c9a227] px-1 text-[11px] font-bold text-black" aria-label={`Selected media ${item.selectionNumber}`}>{item.selectionNumber}</span>
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

          {recentMedia.map((item) => {
            const selectedAlready = selected.some(file => file.name === item.name);
            return (
              <button
                type="button"
                key={item.id}
                onClick={() => onPickRecent?.(item)}
                disabled={!onPickRecent || !canAddMore || selectedAlready || pickingRecentId !== null && pickingRecentId !== undefined}
                aria-label={selectedAlready ? `Already selected ${item.name}` : `Select ${item.name}`}
                className="relative aspect-square overflow-hidden bg-[#1e262e] text-white disabled:opacity-60"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.thumbnailUrl} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                {item.mimeType.startsWith('video/') && <Film className="absolute bottom-2 left-2 drop-shadow" size={19} />}
                {selectedAlready && <span className="absolute right-2 top-2 rounded-full bg-[#c9a227] px-2 py-0.5 text-xs font-bold text-black">✓</span>}
                {pickingRecentId === item.id && <span className="absolute inset-0 grid place-items-center bg-black/55 text-xs">Adding…</span>}
              </button>
            );
          })}

          {canAddMore && (nativeGalleryStatus !== 'ready' || recentMedia.length === 0) && (
            <button type="button" onClick={onGallery} aria-label={count ? 'Choose more photos and videos' : 'Browse recent photos and videos'} className="flex aspect-square flex-col items-center justify-center gap-2 bg-[#1e262e] text-white/85 transition hover:bg-[#2a3540]">
              {count ? <Plus size={29} /> : <ImageIcon size={30} />}
              <span className="px-1 text-center text-sm">{count ? 'Add more' : 'Photos & videos'}</span>
            </button>
          )}

        </section>

        {error && <p role="alert" className="px-5 pt-4 text-center text-xs leading-5 text-[#ff9b9b]">{error}</p>}

        {nativeGalleryStatus !== 'ready' && (
          <div className="px-6 py-6 text-center">
            <p className="text-sm text-white/60">
              {nativeGalleryStatus === 'loading'
                ? 'Loading your recent photos…'
                : nativeGalleryStatus === 'permission'
                  ? 'Allow VANTA access to your selected photos to show them here.'
                  : 'Choose Photos & videos to browse your device gallery.'}
            </p>
            {nativeGalleryStatus === 'permission' && onGrantGallery && (
              <button type="button" onClick={onGrantGallery} className="mt-3 rounded-lg bg-[#c9a227] px-4 py-2 text-sm font-semibold text-black">
                Show recent photos
              </button>
            )}
            <p className="mt-2 text-xs text-white/40">Photos stay on your phone until you choose to post them.</p>
          </div>
        )}
        {nativeGalleryStatus === 'ready' && recentMedia.length === 0 && !count && (
          <p className="px-6 py-6 text-center text-sm text-white/60">No accessible recent photos. Use Photos & videos to choose from Android.</p>
        )}
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
