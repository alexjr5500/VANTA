'use client';

import { forwardRef, useEffect, useRef, useState, type CSSProperties, type TextareaHTMLAttributes } from 'react';
import { highlightedParts } from '@/lib/mentionTokens';

/** Render @username and #hashtag in VANTA gold *while typing* in a native
 * textarea. Native editing/selection/IME remains intact; the visual mirror
 * never intercepts clicks, never inserts HTML and cannot execute input text.
 */
type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  value: string;
  surfaceClassName?: string;
  mirrorTextColor?: string;
};

/** Keep real textarea on top; mirror exact computed metrics, resize and scroll. */
export const MentionTextarea = forwardRef<HTMLTextAreaElement, Props>(function MentionTextarea(
  { value, className = '', surfaceClassName = '', mirrorTextColor, style, onScroll, ...props },
  forwardedRef,
) {
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<CSSProperties>({});
  const parts = highlightedParts(value);

  useEffect(() => {
    const input = textarea.current;
    if (!input) return;
    const update = () => {
      const css = window.getComputedStyle(input);
      setMetrics({
        fontFamily: css.fontFamily, fontSize: css.fontSize, fontWeight: css.fontWeight,
        fontStyle: css.fontStyle, lineHeight: css.lineHeight, letterSpacing: css.letterSpacing,
        textAlign: css.textAlign as CSSProperties['textAlign'],
        paddingTop: css.paddingTop, paddingRight: css.paddingRight,
        paddingBottom: css.paddingBottom, paddingLeft: css.paddingLeft,
        borderTopWidth: css.borderTopWidth, borderRightWidth: css.borderRightWidth,
        borderBottomWidth: css.borderBottomWidth, borderLeftWidth: css.borderLeftWidth,
        wordBreak: css.wordBreak as CSSProperties['wordBreak'],
      });
      if (mirror.current) mirror.current.scrollTop = input.scrollTop;
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(input);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={`relative min-w-0 flex-1 ${surfaceClassName}`}>
      <div
        aria-hidden="true"
        ref={mirror}
        className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap [overflow-wrap:break-word]"
        style={{ ...metrics, color: mirrorTextColor || 'var(--text-primary)' }}
      >
        {parts.map((part, index) => (
          <span key={index} style={part.highlighted ? { color: 'var(--vanta-gold-bright)' } : undefined}>{part.text}</span>
        ))}
        {'\u200b'}
      </div>
      <textarea
        {...props}
        value={value}
        ref={element => {
          textarea.current = element;
          if (typeof forwardedRef === 'function') forwardedRef(element);
          else if (forwardedRef) forwardedRef.current = element;
        }}
        className={`vanta-highlighted-input relative w-full ${className}`}
        style={{ ...style, color: 'transparent', WebkitTextFillColor: 'transparent', caretColor: 'var(--text-primary)', backgroundColor: 'transparent' }}
        onScroll={event => {
          if (mirror.current) mirror.current.scrollTop = event.currentTarget.scrollTop;
          onScroll?.(event);
        }}
      />
    </div>
  );
});
