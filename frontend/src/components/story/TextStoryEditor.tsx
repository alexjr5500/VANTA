'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  CaseUpper,
  Check,
  Italic,
  Loader2,
  MoveVertical,
  Palette,
  Type,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { publishTextStory } from '@/lib/storyApi';
import { notifyStoryFeedChanged } from '@/lib/storyEvents';
import {
  STATUS_MAX_CHARS,
  STATUS_MAX_LINES,
  normalizeStatusEditorValue,
  statusCounts,
} from '@/lib/statusLimits';
import {
  DEFAULT_TEXT_STYLE,
  STORY_BACKGROUNDS,
  STORY_FONTS,
  STORY_TEXT_COLORS,
  STORY_TEXT_SIZES,
  backgroundById,
  fontById,
} from '@/components/story/storyPresets';

export interface TextStoryEditorProps {
  onBack?: () => void;
  onClose?: () => void;
  onPublished?: () => void;
}

type AlignY = 'top' | 'middle' | 'bottom';

const ALIGNS = [
  { id: 'left', label: 'Align left', icon: AlignLeft },
  { id: 'center', label: 'Align center', icon: AlignCenter },
  { id: 'right', label: 'Align right', icon: AlignRight },
] as const;

const ALIGN_YS = [
  { id: 'top', label: 'Top' },
  { id: 'middle', label: 'Middle' },
  { id: 'bottom', label: 'Bottom' },
] as const;

const SIZE_MIN = 24;
const SIZE_MAX = 120;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function fitFontSize(text: string, size: number, lineHeight: number): string {
  const parts = text ? text.split('\n') : [''];
  const logicalLines = Math.max(1, parts.length);
  const longest = parts.reduce((m, p) => Math.max(m, p.length), 1);
  const px = clamp(size, SIZE_MIN, SIZE_MAX);
  const widthDiv = Math.max(1, Math.round(longest * 0.62));
  const heightDiv = Math.max(1, Math.round(logicalLines * lineHeight));
  return `min(${px}px, calc(62vw / ${widthDiv}), calc(52dvh / ${heightDiv}))`;
}

export default function TextStoryEditor({ onBack, onClose, onPublished }: TextStoryEditorProps) {
  const { token } = useAuth();
  const toast = useToast();
  const [text, setText] = useState('');
  const [background, setBackground] = useState<string>(DEFAULT_TEXT_STYLE.background);
  const [fontId, setFontId] = useState<string>(DEFAULT_TEXT_STYLE.font);
  const [size, setSize] = useState<number>(DEFAULT_TEXT_STYLE.size);
  const [color, setColor] = useState<string>(DEFAULT_TEXT_STYLE.color);
  const [align, setAlign] = useState<'left' | 'center' | 'right'>(DEFAULT_TEXT_STYLE.align);
  const [weight, setWeight] = useState<number>(DEFAULT_TEXT_STYLE.weight);
  const [italic, setItalic] = useState<boolean>(DEFAULT_TEXT_STYLE.italic);
  const [wide, setWide] = useState<boolean>(false);
  const [alignY, setAlignY] = useState<AlignY>(DEFAULT_TEXT_STYLE.alignY);
  const [uppercase, setUppercase] = useState<boolean>(DEFAULT_TEXT_STYLE.uppercase);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const bg = useMemo(() => backgroundById(background), [background]);
  const font = useMemo(() => fontById(fontId), [fontId]);
  const counts = useMemo(() => statusCounts(text), [text]);
  const lineHeight = useMemo(() => (wide ? 1.2 : font.lineHeight), [wide, font]);
  const letterSpacing = useMemo(() => (wide ? 0.08 : font.letterSpacing), [wide, font]);
  const fitSize = useMemo(() => fitFontSize(text, size, lineHeight), [text, size, lineHeight]);
  const canPublish = Boolean(
    token && text.trim() && !counts.overChars && !counts.overLines && !publishing,
  );

  useEffect(() => {
    const root = document.documentElement;
    const onResize = () => {
      const kb = window.visualViewport ? window.visualViewport.height - window.innerHeight : 0;
      root.style.setProperty('--vanta-kb', `${Math.max(0, kb)}px`);
    };
    window.addEventListener('resize', onResize);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onResize);
      window.visualViewport.addEventListener('scroll', onResize, true);
    }
    onResize();
    return () => {
      window.removeEventListener('resize', onResize);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', onResize);
        window.visualViewport.removeEventListener('scroll', onResize, true);
      }
    };
  }, []);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const onChangeText = useCallback((value: string) => {
    setText(normalizeStatusEditorValue(value));
  }, []);

  const handlePublish = useCallback(async () => {
    if (!token) {
      setError('Please sign in to publish your story.');
      return;
    }
    if (!text.trim()) {
      setError('Write something first.');
      return;
    }
    if (publishing) return;
    if (counts.overChars || counts.overLines) {
      setError('Your story is too long.');
      return;
    }
    setError('');
    setPublishing(true);
    try {
      await publishTextStory(token, text.trim(), {
        background,
        font: fontId,
        size,
        color,
        align,
        weight,
        italic,
        letterSpacing,
        lineHeight,
        alignY,
        uppercase,
      });
      notifyStoryFeedChanged();
      toast.success('Story published');
      onPublished?.();
      onClose?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish story.');
    } finally {
      setPublishing(false);
    }
  }, [
    token, text, background, fontId, size, color, align, weight, italic,
    letterSpacing, lineHeight, alignY, uppercase, counts, publishing, toast,
    onPublished, onClose,
  ]);

  const goBack = onBack ?? onClose;
  const justify =
    alignY === 'top' ? 'justify-start pt-8' : alignY === 'bottom' ? 'justify-end pb-8' : 'justify-center';
  const textAlignCls = align === 'left' ? 'text-left' : align === 'right' ? 'text-right' : 'text-center';
  const fontFamily = font.css;
  const remaining = STATUS_MAX_CHARS - counts.chars;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0b0b0e] text-white" data-testid="text-story-editor">
      <header className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-2.5">
        {goBack ? (
          <button
            type="button"
            onClick={goBack}
            aria-label="Close text story editor"
            className="rounded-full p-2 text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            <X size={20} />
          </button>
        ) : null}
        <h2 className="flex-1 text-sm font-semibold tracking-wide">Text Story</h2>
        <span
          aria-live="polite"
          className={cn(
            'rounded-full px-2.5 py-1 text-[11px] font-medium tabular-nums',
            remaining < 0 ? 'bg-red-500/20 text-red-300' : 'bg-white/10 text-white/70',
          )}
        >
          {remaining}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
        <section aria-label="Story preview" className="mx-auto w-full max-w-sm">
          <div
            className={cn('relative aspect-[9/16] w-full overflow-hidden rounded-2xl', justify, 'flex')}
            style={{ background: bg.css, boxShadow: '0 12px 40px rgba(0,0,0,0.45)' }}
          >
            <div className={cn('flex max-h-full w-full flex-col px-6', textAlignCls)}>
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => onChangeText(e.target.value)}
                placeholder="Tap to write your story..."
                aria-label="Story text"
                rows={4}
                maxLength={STATUS_MAX_CHARS + 50}
                className={cn(
                  'max-h-full w-full resize-none overflow-y-auto bg-transparent outline-none placeholder:text-white/50',
                  textAlignCls,
                )}
                style={{
                  fontFamily,
                  fontSize: fitSize,
                  lineHeight,
                  letterSpacing: `${letterSpacing}em`,
                  color,
                  fontWeight: weight,
                  fontStyle: italic ? 'italic' : 'normal',
                  textTransform: uppercase ? 'uppercase' : 'none',
                  textShadow: '0 1px 12px rgba(0,0,0,0.35)',
                  caretColor: color,
                }}
              />
              {!text ? (
                <p className={cn('pointer-events-none mt-2 text-xs text-white/60', textAlignCls)}>
                  {STATUS_MAX_CHARS} characters max - {STATUS_MAX_LINES} lines max
                </p>
              ) : null}
            </div>
          </div>
          <p className="mt-2 text-center text-[11px] text-white/50" aria-live="polite">
            {counts.lines}/{STATUS_MAX_LINES} lines
          </p>
        </section>

        <section aria-label="Background" className="mx-auto mt-3 w-full max-w-sm">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/50">
            Background
          </p>
          <div
            className="flex gap-2 overflow-x-auto pb-1"
            role="radiogroup"
            aria-label="Story background"
          >
            {STORY_BACKGROUNDS.map((b) => {
              const selected = b.id === background;
              return (
                <button
                  key={b.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`Background ${b.id}`}
                  title={b.id}
                  onClick={() => setBackground(b.id)}
                  className={cn(
                    'h-12 w-12 shrink-0 rounded-xl transition',
                    selected
                      ? 'ring-2 ring-amber-400 ring-offset-2 ring-offset-[#0b0b0e]'
                      : 'ring-1 ring-white/15 hover:ring-white/40',
                  )}
                  style={{ background: b.css }}
                >
                  {selected ? (
                    <Check size={16} className="mx-auto text-white drop-shadow" aria-hidden />
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>

        <section aria-label="Font" className="mx-auto mt-3 w-full max-w-sm">
          <p className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-white/50">
            <Type size={12} aria-hidden /> Font
          </p>
          <div className="flex gap-1.5 overflow-x-auto pb-1" role="radiogroup" aria-label="Font">
            {STORY_FONTS.map((f) => {
              const selected = f.id === fontId;
              return (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setFontId(f.id)}
                  className={cn(
                    'shrink-0 rounded-lg px-3 py-2 text-sm transition',
                    selected
                      ? 'bg-amber-400 font-semibold text-black'
                      : 'bg-white/10 text-white/80 hover:bg-white/15',
                  )}
                  style={{ fontFamily: f.css }}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </section>

        <section aria-label="Text size" className="mx-auto mt-3 w-full max-w-sm">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/50">
            Size - {size}px
          </p>
          <div className="flex gap-1.5 overflow-x-auto pb-1" role="radiogroup" aria-label="Text size">
            {STORY_TEXT_SIZES.map((s) => {
              const selected = s === size;
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setSize(s)}
                  className={cn(
                    'shrink-0 rounded-lg px-3 py-1.5 text-sm transition',
                    selected
                      ? 'bg-amber-400 font-semibold text-black'
                      : 'bg-white/10 text-white/80 hover:bg-white/15',
                  )}
                >
                  {s}
                </button>
              );
            })}
          </div>
          <input
            type="range"
            min={SIZE_MIN}
            max={SIZE_MAX}
            step={2}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            aria-label="Adjust text size"
            className="mt-2 w-full accent-amber-400"
          />
        </section>

        <section aria-label="Text color" className="mx-auto mt-3 w-full max-w-sm">
          <p className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-white/50">
            <Palette size={12} aria-hidden /> Color
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1" role="radiogroup" aria-label="Text color">
            {STORY_TEXT_COLORS.map((c) => {
              const selected = c === color;
              return (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`Text color ${c}`}
                  onClick={() => setColor(c)}
                  className={cn(
                    'h-9 w-9 shrink-0 rounded-full border border-white/25 transition',
                    selected && 'ring-2 ring-amber-400 ring-offset-2 ring-offset-[#0b0b0e]',
                  )}
                  style={{ backgroundColor: c }}
                />
              );
            })}
          </div>
        </section>

        <section aria-label="Alignment and style" className="mx-auto mt-3 w-full max-w-sm">
          <p className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-white/50">
            <MoveVertical size={12} aria-hidden /> Layout
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex gap-1 rounded-lg bg-white/10 p-1" role="radiogroup" aria-label="Text alignment">
              {ALIGNS.map((a) => {
                const Icon = a.icon;
                const selected = a.id === align;
                return (
                  <button
                    key={a.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={a.label}
                    onClick={() => setAlign(a.id)}
                    className={cn(
                      'rounded-md p-2 transition',
                      selected ? 'bg-amber-400 text-black' : 'text-white/70 hover:text-white',
                    )}
                  >
                    <Icon size={16} aria-hidden />
                  </button>
                );
              })}
            </div>
            <div className="flex gap-1 rounded-lg bg-white/10 p-1" role="radiogroup" aria-label="Vertical position">
              {ALIGN_YS.map((a) => {
                const selected = a.id === alignY;
                return (
                  <button
                    key={a.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setAlignY(a.id)}
                    className={cn(
                      'rounded-md px-2.5 py-1.5 text-xs font-medium transition',
                      selected ? 'bg-amber-400 text-black' : 'text-white/70 hover:text-white',
                    )}
                  >
                    {a.label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              aria-pressed={weight >= 700}
              aria-label="Toggle bold"
              onClick={() => setWeight((w) => (w >= 700 ? 400 : 800))}
              className={cn(
                'rounded-lg p-2 transition',
                weight >= 700 ? 'bg-amber-400 text-black' : 'bg-white/10 text-white/70 hover:text-white',
              )}
            >
              <Bold size={16} aria-hidden />
            </button>
            <button
              type="button"
              aria-pressed={italic}
              aria-label="Toggle italic"
              onClick={() => setItalic((v) => !v)}
              className={cn(
                'rounded-lg p-2 transition',
                italic ? 'bg-amber-400 text-black' : 'bg-white/10 text-white/70 hover:text-white',
              )}
            >
              <Italic size={16} aria-hidden />
            </button>
            <button
              type="button"
              aria-pressed={uppercase}
              aria-label="Toggle uppercase"
              onClick={() => setUppercase((v) => !v)}
              className={cn(
                'rounded-lg p-2 transition',
                uppercase ? 'bg-amber-400 text-black' : 'bg-white/10 text-white/70 hover:text-white',
              )}
            >
              <CaseUpper size={16} aria-hidden />
            </button>
            <button
              type="button"
              aria-pressed={wide}
              aria-label="Toggle wide letter spacing"
              onClick={() => setWide((v) => !v)}
              className={cn(
                'rounded-lg px-2.5 py-1.5 text-xs font-medium transition',
                wide ? 'bg-amber-400 text-black' : 'bg-white/10 text-white/70 hover:text-white',
              )}
            >
              Wide
            </button>
          </div>
        </section>

        {error ? (
          <p role="alert" className="mx-auto mt-3 w-full max-w-sm rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        ) : null}
      </div>

      <footer
        className="shrink-0 border-t border-white/10 bg-[#0b0b0e]/95 px-4 pt-2 backdrop-blur"
        style={{ paddingBottom: 'max(0.75rem, calc(env(safe-area-inset-bottom) + var(--vanta-kb, 0px)))' }}
      >
        <button
          type="button"
          onClick={handlePublish}
          disabled={!canPublish}
          className={cn(
            'flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition',
            canPublish ? 'bg-amber-400 text-black hover:bg-amber-300' : 'cursor-not-allowed bg-white/10 text-white/40',
          )}
        >
          {publishing ? (
            <>
              <Loader2 size={18} className="animate-spin" aria-hidden /> Publishing...
            </>
          ) : (
            'Publish Text Story'
          )}
        </button>
      </footer>
    </div>
  );
}
