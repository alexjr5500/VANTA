'use client';

import React, { useMemo, useRef, useState } from 'react';
import { Camera, Loader2, Mic, Palette, Type, Video, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { publishTextStory } from '@/lib/storyApi';
import { notifyStoryFeedChanged } from '@/lib/storyEvents';
import { STATUS_MAX_CHARS, STATUS_MAX_LINES, normalizeStatusEditorValue, statusCounts } from '@/lib/statusLimits';
import { DEFAULT_TEXT_STYLE, STORY_BACKGROUNDS, STORY_FONTS, backgroundById, fontById } from '@/components/story/storyPresets';

export interface TextStoryEditorProps {
  onBack?: () => void;
  onClose?: () => void;
  onPublished?: () => void;
  onPhoto?: () => void;
  onVideo?: () => void;
}

/**
 * Immersive, full-screen text Status editor.
 * Font and background choices go through the existing textStoryStyle payload,
 * so the Status viewer shows exactly what was composed here.
 */
export default function TextStoryEditor({ onBack, onClose, onPublished, onPhoto, onVideo }: TextStoryEditorProps) {
  const { token } = useAuth();
  const toast = useToast();
  const [text, setText] = useState('');
  const [background, setBackground] = useState('slate');
  const [fontId, setFontId] = useState(DEFAULT_TEXT_STYLE.font);
  const [showPalette, setShowPalette] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const counts = useMemo(() => statusCounts(text), [text]);
  const selectedBackground = useMemo(() => backgroundById(background), [background]);
  const selectedFont = useMemo(() => fontById(fontId), [fontId]);
  const canPublish = Boolean(token && text.trim() && !counts.overChars && !counts.overLines && !publishing);

  const changeText = (value: string) => {
    setText(normalizeStatusEditorValue(value));
    setError('');
  };

  const cycleFont = () => {
    const current = STORY_FONTS.findIndex((entry) => entry.id === fontId);
    setFontId(STORY_FONTS[(current + 1) % STORY_FONTS.length].id);
  };

  const handlePublish = async () => {
    if (!token) { setError('Please sign in to publish your Status.'); return; }
    if (!canPublish) return;
    setError('');
    setPublishing(true);
    try {
      await publishTextStory(token, text.trim(), {
        background, font: fontId, size: DEFAULT_TEXT_STYLE.size,
        color: selectedBackground.ink, align: 'center',
        weight: fontId === 'display' ? 600 : 400,
        italic: false, letterSpacing: selectedFont.letterSpacing,
        lineHeight: selectedFont.lineHeight, alignY: 'middle', uppercase: false,
      });
      notifyStoryFeedChanged();
      toast.success('Status published');
      onPublished?.();
      onClose?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to publish Status.');
    } finally { setPublishing(false); }
  };

  return (
    <div
      className="relative flex h-full min-h-0 w-full flex-col overflow-hidden text-white"
      style={{ background: selectedBackground.css }}
      data-testid="text-story-editor"
    >
      <header className="z-10 flex h-[82px] shrink-0 items-start justify-between px-5 pt-5">
        <button
          type="button"
          onClick={onBack || onClose}
          aria-label="Close text Status"
          className="grid h-12 w-12 place-items-center rounded-full bg-black/20 text-white hover:bg-black/30"
        >
          <X size={29} />
        </button>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={cycleFont}
            aria-label="Change Status font"
            title={`Font: ${selectedFont.label}`}
            className="grid h-12 w-12 place-items-center rounded-full bg-black/20 text-[20px] font-medium text-white hover:bg-black/30"
          >
            Aa
          </button>
          <button
            type="button"
            onClick={() => setShowPalette((current) => !current)}
            aria-label="Choose Status background"
            aria-expanded={showPalette}
            className="grid h-12 w-12 place-items-center rounded-full bg-black/20 text-white hover:bg-black/30"
          >
            <Palette size={24} />
          </button>
        </div>
      </header>

      {showPalette && (
        <div className="absolute left-4 right-4 top-[88px] z-20 flex gap-3 overflow-x-auto rounded-2xl bg-black/60 p-3 backdrop-blur-md scrollbar-hide" role="group" aria-label="Status backgrounds">
          {STORY_BACKGROUNDS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => { setBackground(option.id); setShowPalette(false); }}
              aria-label={option.label}
              aria-pressed={background === option.id}
              title={option.label}
              className={cn('h-10 w-10 shrink-0 rounded-full border border-white/30 transition', background === option.id && 'ring-2 ring-[#dfbd55] ring-offset-2 ring-offset-transparent')}
              style={{ background: option.css }}
            />
          ))}
        </div>
      )}

      <main className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-5">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => changeText(event.target.value)}
          placeholder="Type a status"
          aria-label="Write text Status"
          rows={3}
          maxLength={STATUS_MAX_CHARS}
          className="max-h-full min-h-[132px] w-full max-w-[620px] resize-none overflow-y-auto border-0 bg-transparent text-center text-[clamp(28px,7vw,46px)] font-light leading-snug outline-none placeholder:opacity-30 placeholder:text-current"
          style={{ color: selectedBackground.ink, fontFamily: selectedFont.css, letterSpacing: `${selectedFont.letterSpacing}em`, lineHeight: selectedFont.lineHeight }}
        />
        {(text.length > 0 || error) && (
          <div className="mt-4 flex w-full max-w-[440px] flex-col items-center gap-2">
            <span className="text-xs tabular-nums opacity-65" style={{ color: selectedBackground.ink }}>
              {counts.chars}/{STATUS_MAX_CHARS} · {counts.lines}/{STATUS_MAX_LINES} lines
            </span>
            {error && <p role="alert" className="rounded-lg bg-black/50 px-3 py-2 text-center text-xs text-red-200">{error}</p>}
            <button
              type="button"
              disabled={!canPublish}
              onClick={() => void handlePublish()}
              className="flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#dfbd55] px-7 text-sm font-semibold text-[#101112] shadow-lg disabled:cursor-not-allowed disabled:opacity-40"
            >
              {publishing && <Loader2 size={16} className="animate-spin" />}
              {publishing ? 'Posting…' : 'Post status'}
            </button>
          </div>
        )}
      </main>

      <nav className="z-10 grid h-[76px] shrink-0 grid-cols-4 items-center bg-[#0b1115] px-3" aria-label="Status creation type">
        <button type="button" onClick={onVideo} disabled={!onVideo} className="flex h-11 items-center justify-center gap-1 text-[15px] text-white/85 disabled:opacity-40"><Video size={16} className="hidden sm:block" />Video</button>
        <button type="button" onClick={onPhoto} disabled={!onPhoto} className="flex h-11 items-center justify-center gap-1 text-[15px] text-white/85 disabled:opacity-40"><Camera size={16} className="hidden sm:block" />Photo</button>
        <span aria-current="page" className="flex h-11 items-center justify-center gap-1 rounded-full bg-white/[0.12] text-[15px] text-white"><Type size={16} className="hidden sm:block" />Text</span>
        <button type="button" disabled title="Voice Status is not yet supported" aria-label="Voice Status is not yet supported" className="flex h-11 items-center justify-center gap-1 text-[15px] text-white/35"><Mic size={16} className="hidden sm:block" />Voice</button>
      </nav>
    </div>
  );
}
