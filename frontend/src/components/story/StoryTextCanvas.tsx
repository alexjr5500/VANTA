'use client';

import { useMemo } from 'react';
import { backgroundById, fontById } from '@/components/story/storyPresets';
import type { TextStoryStyle } from '@/lib/storyApi';
import { renderTextWithLinks } from '@/lib/linkify';

export interface StoryTextCanvasProps {
  caption?: string | null;
  /** Raw `textStyle` JSON stored on the Story row. */
  styleJson?: string | null;
  className?: string;
}

const DEFAULT_STYLE: Partial<TextStoryStyle> = {
  background: 'ink',
  font: 'sans',
  size: 44,
  color: '#f5f5f7',
  align: 'center',
  weight: 700,
  letterSpacing: -0.01,
  lineHeight: 1.18,
  alignY: 'middle',
};

/**
 * Renders a TEXT Story/Status exactly as the creator designed it — the same
 * curated background, fonts and layout used by the premium composer.
 *
 * Typography auto-fits via CSS min() (smart for both tiny and huge stories):
 *   width  → caps by longest logical line,
 *   height → caps by number of lines.
 */
export default function StoryTextCanvas({
  caption,
  styleJson,
  className,
}: StoryTextCanvasProps) {
  const style = useMemo<Partial<TextStoryStyle>>(() => {
    if (!styleJson) return DEFAULT_STYLE;
    try {
      return { ...DEFAULT_STYLE, ...(JSON.parse(styleJson) as Partial<TextStoryStyle>) };
    } catch {
      return DEFAULT_STYLE;
    }
  }, [styleJson]);

  const background = backgroundById(style.background);
  const font = fontById(style.font);
  const text = caption || '';
  const alignY = style.alignY || 'middle';
  const offsetY = style.offsetY || 0;

  // Fit heuristics.
  const lines = text ? text.split('\n') : [];
  const logicalLines = Math.max(1, lines.length);
  const longestLine = Math.max(1, ...lines.map(line => line.length));
  const size = Number(style.size) > 0 ? style.size! : 44;
  const lineHeight = Number(style.lineHeight) > 0 ? style.lineHeight! : 1.18;
  const fontSize = `min(${size}px, calc(92vw / ${Math.max(1, Math.round(longestLine * 0.62))}), calc(86dvh / ${Math.max(1, Math.round(logicalLines * lineHeight))}))`;

  const flexPosition =
    alignY === 'top'
      ? { justifyContent: 'flex-start', alignItems: 'center' }
      : alignY === 'bottom'
        ? { justifyContent: 'flex-end', alignItems: 'center' }
        : { justifyContent: 'center', alignItems: 'center' };

  return (
    <div
      className={className}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: 'clamp(16px, 5vh, 40px)',
        background: background.css,
        ...flexPosition,
      }}
    >
      <div
        role="text"
        aria-label={text}
        style={{
          width: '92%',
          maxWidth: '92%',
          fontFamily: font.css,
          fontSize,
          fontWeight: Number(style.weight) > 0 ? style.weight : 700,
          fontStyle: style.italic ? 'italic' : 'normal',
          letterSpacing: typeof style.letterSpacing === 'number' ? `${style.letterSpacing}em` : '-0.01em',
          lineHeight,
          color: style.color || '#f5f5f7',
          textAlign: style.align || 'center',
          textTransform: style.uppercase ? 'uppercase' : 'none',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
          wordBreak: 'break-word',
          transform: `translateY(${offsetY || 0}px)`,
        }}
      >
        {renderTextWithLinks(text, 'linkify')}
      </div>
    </div>
  );
}