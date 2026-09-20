'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Bold,
  CaseUpper,
  Check,
  Italic,
  Loader2,
  MoveVertical,
  Palette,
  Type,
  Undo2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { publishTextStory, type TextStoryStyle } from '@/lib/storyApi';
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

// ============================================================================
// Text Story Editor — the premium 2026 text canvas composer.
//
// Designs a TEXT Story/Status on a live, WYSIWYG canvas: curated backgrounds,
// fonts, sizes, palette, alignment, weight, italics, tracking, case and
// vertical placement. What you see is exactly what the viewer renders
// (StoryTextCanvas shares the same presets + style payload).
//
// HARD LIMITS: 700 characters AND 10 lines, enforced live while typing and
// re-validated before publish — mirrored on the backend.
// ============================================================================

export interface TextStoryEditorProps {
  onBack?: () => void;
  onClose: () => void;
}

type AlignY = 'top' | 'middle' | 'bottom';

interface AlignItem {
  id: 'left' | 'center' | 'right';
  label: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
}

const ALIGNS: AlignItem[] = [
  { id: 'left', label: 'Align left', icon: AlignLeft },
  { id: 'center', label: 'Align center', icon: AlignCenter },
  { id: 'right', label: 'Align right', icon: AlignRight },
];

const ALIGN_YS: Array<{ id: AlignY; label: string }> = [
  { id: 'top', label: 'Top' },
  { id: 'middle', label: 'Middle' },
  { id: 'bottom', label: 'Bottom' },
];

const SIZE_MIN = 24;
const SIZE_MAX = 120;

/** Shared autofit formula drives the editor canvas (the viewer uses the same math). */
function fitFontSize(text: string, size: number, lineHeight: number): string {
  const parts = text ? text.split('\n') : [''];
  const logicalLines = Math.max(1, parts.length);
  const longest = Math.max(1, ...parts.map(part => part.length));
  const px = Math.max(SIZE_MIN, Math.min(SIZE_MAX, size));
  return `min(${px}px, calc(90vw / ${Math.max(1, Math.round(longest * 0.62))}), calc(48dvh / ${Math.max(1, Math.round(logicalLines * lineHeight))}))`;
}
export default function TextStoryEditor({ onBack, onClose }: TextStoryEditorProps) {
  const { token } = useAuth();
  const toast = useToast();

  const [text, setText] = useState('');
  const [background, setBackground] = useState(DEFAULT_TEXT_STYLE.background);
  const [fontId, setFontId] = useState(DEFAULT_TEXT_STYLE.font);
  const [size, setSize] = useState(DEFAULT_TEXT_STYLE.size);
  const [color, setColor] = useState(DEFAULT_TEXT_STYLE.color);
  const [align, setAlign] = useState<'left' | 'center' | 'right'>(DEFAULT_TEXT_STYLE.align);
  const [weight, setWeight] = useState(DEFAULT_TEXT_STYLE.weight);
  const [italic, setItalic] = useState(DEFAULT_TEXT_STYLE.italic);
  const [wide, setWide] = useState(false);
  const [alignY, setAlignY] = useState<AlignY>(DEFAULT_TEXT_STYLE.alignY);
  const [uppercase, setUppercase] = useState(DEFAULT_TEXT_STYLE.uppercase);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const bg = useMemo(() => backgroundById(background), [background]);
  const font = useMemo(() => fontById(fontId), [fontId]);
  const counts = useMemo(() => statusCounts(text), [text]);
  const lineHeight = useMemo(() => (wide ? 1.2 : font.lineHeight), [wide, font]);
  const letterSpacing = useMemo(() => (wide ? 0.08 : font.letterSpacing), [wide, font]);
  const fitSize = useMemo(() => fitFontSize(text, size, lineHeight), [text, size, lineHeight]);
  const canPublish = Boolean(token && text.trim() && !counts.overChars && !counts.overLines && !publishing);

  // Focus the canvas so the user can start typing immediately.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const resetStyle = useCallback(() => {
    setBackground(DEFAULT_TEXT_STYLE.background);
    setFontId(DEFAULT_TEXT_STYLE.font);
    setSize(DEFAULT_TEXT_STYLE.size);
    setColor(DEFAULT_TEXT_STYLE.color);
    setAlign(DEFAULT_TEXT_STYLE.align);
    setWeight(DEFAULT_TEXT_STYLE.weight);
    setItalic(DEFAULT_TEXT_STYLE.italic);
    setWide(false);
    setAlignY(DEFAULT_TEXT_STYLE.alignY);
    setUppercase(DEFAULT_TEXT_STYLE.uppercase);
  }, []);

  const stepSize = useCallback((delta: number) => {
    setSize(prev => Math.max(SIZE_MIN, Math.min(SIZE_MAX, prev + delta)));
  }, []);

  const toggleWeight = useCallback(() => {
    setWeight(prev => (prev >= 600 ? 400 : 700));
  }, []);

  const publish = useCallback(async () => {
    const body = normalizeStatusEditorValue(text);
    if (!body.trim() || !token || publishing || counts.overChars || counts.overLines) return;
    setPublishing(true);
    setError('');
    try {
      const style: TextStoryStyle = {
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
      };
      await publishTextStory(token, body, style);
      notifyStoryFeedChanged();
      toast.success('Text story published');
      onClose();
    } catch (reason: any) {
      setError(reason?.message || 'Your Text Story could not be published. Please try again.');
    } finally {
      setPublishing(false);
    }
  }, [text, token, publishing, counts.overChars, counts.overLines, background, fontId, size, color, align, weight, italic, letterSpacing, lineHeight, alignY, uppercase, onClose, toast]);

  return (
    <div className="flex h-full flex-col bg-[#050506]">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between px-3 pb-1 pt-[max(env(safe-area-inset-top,0px),6px)]">
        <button
          type="button"
          onClick={onBack || onClose}
          aria-label="Back to creation menu"
          className="grid h-10 w-10 place-items-center rounded-full text-[#8a8a8a] transition hover:bg-white/[0.06] hover:text-white"
        >
          <ArrowLeft size={18} />
        </button>
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Type size={16} className="text-[#c9a227]" />
          New Text Story
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close creation"
          className="grid h-10 w-10 place-items-center rounded-full text-[#8a8a8a] transition hover:bg-white/[0.06] hover:text-white"
        >
          <X size={18} />
        </button>
      </header>

      {/* Canvas + design controls */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-3 pb-4 md:flex-row md:gap-6 md:px-6">
        {/* Live canvas */}
        <section className="flex min-h-0 flex-1 flex-col gap-2" aria-label="Text Story preview">
          <div
            className="relative flex min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-white/[0.08] shadow-[0_10px_40px_rgba(0,0,0,0.35)]"
            style={{ background: bg.css, height: 'min(56dvh, 560px)' }}
          >
            <div
              className="flex min-h-0 w-full flex-col items-stretch px-4"
              style={{
                justifyContent: alignY === 'top' ? 'flex-start' : alignY === 'bottom' ? 'flex-end' : 'center',
              }}
            >
              <textarea
                ref={textareaRef}
                value={text}
                onChange={event => setText(normalizeStatusEditorValue(event.target.value))}
                onPaste={event => {
                  event.preventDefault();
                  const pasted = event.clipboardData?.getData('text/plain') || '';
                  setText(previous => normalizeStatusEditorValue(previous + pasted));
                }}
                placeholder="Type something beautiful…"
                aria-label="Text Story content"
                rows={Math.max(1, counts.lines)}
                className="min-h-0 w-full resize-none bg-transparent outline-none placeholder:text-white/25"
                style={{
                  fontFamily: font.css,
                  fontSize: fitSize,
                  fontWeight: weight,
                  fontStyle: italic ? 'italic' : 'normal',
                  letterSpacing: `${letterSpacing}em`,
                  lineHeight,
                  color,
                  textAlign: align,
                  textTransform: uppercase ? 'uppercase' : 'none',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'break-word',
                  wordBreak: 'break-word',
                  caretColor: color,
                }}
              />
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-between">
            <p className={cn('text-xs leading-5', counts.overLines ? 'text-[#e5484d]' : 'text-white/35')}>
              {counts.lines}/{STATUS_MAX_LINES} lines
            </p>
            <p
              className={cn(
                'text-sm font-semibold tabular-nums tracking-wide',
                counts.overChars ? 'text-[#e5484d]' : counts.chars >= STATUS_MAX_CHARS ? 'text-[#dfbd55]' : 'text-white/45'
              )}
              aria-live="polite"
            >
              {counts.chars} / {STATUS_MAX_CHARS}
            </p>
          </div>
        </section>
<DesignControls
          background={background}
          onBackground={setBackground}
          fontId={fontId}
          onFont={setFontId}
          size={size}
          onSize={setSize}
          stepSize={stepSize}
          color={color}
          onColor={setColor}
          align={align}
          onAlign={setAlign}
          weight={weight}
          onToggleWeight={toggleWeight}
          italic={italic}
          onItalic={setItalic}
          uppercase={uppercase}
          onUppercase={setUppercase}
          wide={wide}
          onWide={setWide}
          alignY={alignY}
          onAlignY={setAlignY}
          onReset={resetStyle}
        />
      </div>

      {error && (
        <p role="alert" className="shrink-0 px-4 pb-2 text-xs text-[#ff9b9b]">{error}</p>
      )}

      {/* Publish bar — keyboard + safe-area aware */}
      <footer
        className="shrink-0 border-t border-white/[0.07] bg-[#0b0b0e]/95 px-4 pt-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + var(--vanta-kb, 0px) + 16px)' }}
      >
        <button
          type="button"
          onClick={() => void publish()}
          disabled={!canPublish}
          aria-label="Publish Text Story"
          className="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-[#c9a227] text-[15px] font-bold text-black transition hover:bg-[#dfbd55] active:scale-[0.99] disabled:opacity-30"
        >
          {publishing ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
          {publishing ? 'Publishing…' : 'Publish Text Story'}
        </button>
      </footer>
    </div>
  );
}
// ============================================================================
// Design controls rail — every knob a creator needs on the premium canvas.
// ============================================================================

interface DesignControlsProps {
  background: string;
  onBackground: (id: string) => void;
  fontId: string;
  onFont: (id: string) => void;
  size: number;
  onSize: (px: number) => void;
  stepSize: (delta: number) => void;
  color: string;
  onColor: (hex: string) => void;
  align: 'left' | 'center' | 'right';
  onAlign: (align: 'left' | 'center' | 'right') => void;
  weight: number;
  onToggleWeight: () => void;
  italic: boolean;
  onItalic: (value: boolean) => void;
  uppercase: boolean;
  onUppercase: (value: boolean) => void;
  wide: boolean;
  onWide: (value: boolean) => void;
  alignY: AlignY;
  onAlignY: (value: AlignY) => void;
  onReset: () => void;
}

function DesignControls(props: DesignControlsProps) {
  return (
    <section
      className="flex min-w-0 flex-col gap-4 overflow-y-auto md:h-full md:w-[340px] md:shrink-0"
      aria-label="Text Story style controls"
    >
      <ControlSection>
        <ControlTitle icon={Palette}>Background</ControlTitle>
        <div className="flex flex-wrap gap-1.5">
          {STORY_BACKGROUNDS.map(bg => (
            <button
              key={bg.id}
              type="button"
              onClick={() => props.onBackground(bg.id)}
              aria-label={`Background: ${bg.label}`}
              aria-pressed={props.background === bg.id}
              className={cn(
                'h-8 rounded-full border px-3 text-[11px] font-medium transition',
                props.background === bg.id
                  ? 'border-[#dfbd55] bg-white/[0.06] text-[#dfbd55]'
                  : 'border-white/[0.1] bg-white/[0.03] text-white/60 hover:border-white/[0.2] hover:text-white/85'
              )}
              style={{ background: bg.css }}
            >
              {bg.label}
            </button>
          ))}
        </div>
      </ControlSection>

      <ControlSection>
        <ControlTitle icon={Type}>Font</ControlTitle>
        <div className="flex flex-wrap gap-1.5">
          {STORY_FONTS.map(font => (
            <button
              key={font.id}
              type="button"
              onClick={() => props.onFont(font.id)}
              aria-label={`Font: ${font.label}`}
              aria-pressed={props.fontId === font.id}
              className={cn(
                'h-8 rounded-lg border px-2.5 text-[12px] transition',
                props.fontId === font.id
                  ? 'border-[#dfbd55] bg-white/[0.06] text-[#dfbd55]'
                  : 'border-white/[0.1] bg-white/[0.03] text-white/75 hover:border-white/[0.2] hover:text-white'
              )}
              style={{ fontFamily: font.css }}
            >
              {font.label}
            </button>
          ))}
        </div>
      </ControlSection>
<ControlSection>
        <ControlTitle icon={Type}>Size</ControlTitle>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => props.stepSize(-6)}
            aria-label="Smaller text"
            className="grid h-7 w-7 place-items-center rounded-full border border-white/[0.1] bg-white/[0.03] text-[13px] font-bold text-white/70 transition hover:bg-white/[0.08] hover:text-white"
          >
            −
          </button>
          {STORY_TEXT_SIZES.map(px => (
            <button
              key={px}
              type="button"
              onClick={() => props.onSize(px)}
              aria-label={`${px}px text`}
              aria-pressed={props.size === px}
              className={cn(
                'h-8 min-w-8 rounded-lg border px-2 text-[11px] tabular-nums transition',
                props.size === px
                  ? 'border-[#dfbd55] bg-white/[0.06] text-[#dfbd55]'
                  : 'border-white/[0.1] bg-white/[0.03] text-white/70 hover:border-white/[0.2] hover:text-white'
              )}
            >
              {px}
            </button>
          ))}
          <button
            type="button"
            onClick={() => props.stepSize(6)}
            aria-label="Larger text"
            className="grid h-7 w-7 place-items-center rounded-full border border-white/[0.1] bg-white/[0.03] text-[13px] font-bold text-white/70 transition hover:bg-white/[0.08] hover:text-white"
          >
            +
          </button>
        </div>
      </ControlSection>

      <ControlSection>
        <ControlTitle icon={Palette}>Color</ControlTitle>
        <div className="flex flex-wrap gap-2">
          {STORY_TEXT_COLORS.map(hex => (
            <button
              key={hex}
              type="button"
              onClick={() => props.onColor(hex)}
              aria-label={`Text color ${hex}`}
              aria-pressed={props.color === hex}
              className={cn(
                'grid h-8 w-8 place-items-center rounded-full border border-white/[0.12] transition',
                props.color === hex && 'ring-2 ring-[#dfbd55] ring-offset-1'
              )}
              style={{ background: hex }}
            >
              {props.color === hex && (
                <Check size={14} className="text-black/80" />
              )}
            </button>
          ))}
        </div>
      </ControlSection>
<ControlSection>
        <ControlTitle icon={AlignCenter}>Layout</ControlTitle>
        <div className="flex flex-wrap items-center gap-1.5">
          {ALIGNS.map(option => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => props.onAlign(option.id)}
                aria-label={option.label}
                aria-pressed={props.align === option.id}
                className={cn(
                  'grid h-8 w-9 place-items-center rounded-lg border transition',
                  props.align === option.id
                    ? 'border-[#dfbd55] bg-white/[0.06] text-[#dfbd55]'
                    : 'border-white/[0.1] bg-white/[0.03] text-white/70 hover:border-white/[0.2] hover:text-white'
                )}
              >
                <Icon size={15} />
              </button>
            );
          })}
          <span className="mx-1 h-4 w-[1px] bg-white/[0.12]" aria-hidden="true" />
          {ALIGN_YS.map(option => (
            <button
              key={option.id}
              type="button"
              onClick={() => props.onAlignY(option.id)}
              aria-label={`Place text ${option.label.toLowerCase()}`}
              aria-pressed={props.alignY === option.id}
              className={cn(
                'h-8 rounded-lg border px-2.5 text-[11px] transition',
                props.alignY === option.id
                  ? 'border-[#dfbd55] bg-white/[0.06] text-[#dfbd55]'
                  : 'border-white/[0.1] bg-white/[0.03] text-white/70 hover:border-white/[0.2] hover:text-white'
              )}
            >
              <MoveVertical size={13} className="mr-1" />
              {option.label}
            </button>
          ))}
        </div>
      </ControlSection>

      <ControlSection>
        <ControlTitle icon={Undo2}>Type</ControlTitle>
        <div className="flex flex-wrap gap-1.5">
          <ToggleButton
            active={props.weight >= 600}
            onClick={props.onToggleWeight}
            label="Bold"
            icon={Bold}
          />
          <ToggleButton
            active={props.italic}
            onClick={() => props.onItalic(!props.italic)}
            label="Italic"
            icon={Italic}
          />
          <ToggleButton
            active={props.uppercase}
            onClick={() => props.onUppercase(!props.uppercase)}
            label="Uppercase"
            icon={CaseUpper}
          />
          <ToggleButton
            active={props.wide}
            onClick={() => props.onWide(!props.wide)}
            label="Wide"
          />
        </div>
        <button
          type="button"
          onClick={props.onReset}
          className="mt-2.5 text-[11px] font-medium text-white/35 underline-offset-2 transition hover:text-white/70 hover:underline"
        >
          Reset style
        </button>
      </ControlSection>
    </section>
  );
}
function ControlSection({ children }: { children: React.ReactNode }) {
  return <div className="shrink-0 border-b border-white/[0.07] pb-3">{children}</div>;
}

function ControlTitle({
  icon: Icon,
  children,
}: {
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
      {Icon && <Icon size={13} className="text-white/40" />}
      {children}
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
}) {
  const Icon = icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'h-8 rounded-lg border px-2.5 text-[11px] transition',
        active
          ? 'border-[#dfbd55] bg-[#c9a227]/15 text-[#dfbd55]'
          : 'border-white/[0.1] bg-white/[0.03] text-white/70 hover:border-white/[0.2] hover:text-white'
      )}
    >
      <span className="flex items-center gap-1.5">
        {Icon && <Icon size={13} />}
        {label}
      </span>
    </button>
  );
}