'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Loader2, MessagesSquare, X } from 'lucide-react';
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

export interface StatusComposerProps {
  onBack?: () => void;
  onClose: () => void;
}

/**
 * The VANTA Status composer — an elegant, keyboard-safe writing surface.
 *
 * HARD LIMITS: 700 characters AND 10 lines. Enforced while typing, while
 * pasting (re-clamped), before submission and mirrored on the backend.
 */
export default function StatusComposer({ onBack, onClose }: StatusComposerProps) {
  const { token } = useAuth();
  const toast = useToast();
  const [text, setText] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const counts = useMemo(() => statusCounts(text), [text]);
  const limitReached = counts.chars >= STATUS_MAX_CHARS || counts.lines >= STATUS_MAX_LINES;

  // Auto-grow + focus on mount.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const adjust = () => {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
    };
    adjust();
    el.addEventListener('input', adjust);
    return () => el.removeEventListener('input', adjust);
  }, []);

  const publish = useCallback(async () => {
    const normalized = normalizeStatusEditorValue(text);
    if (!normalized.trim() || !token || publishing) return;
    setPublishing(true);
    setError('');
    try {
      // A Status is rendered on the Ink background with clean centered type.
      await publishTextStory(token, normalized, {
        background: 'ink',
        font: 'sans',
        size: 30,
        color: '#f5f5f7',
        align: 'center',
        weight: 500,
        italic: false,
        letterSpacing: 0,
        lineHeight: 1.35,
        alignY: 'middle',
        uppercase: false,
      });
      notifyStoryFeedChanged();
      toast.success('Status published');
      onClose();
    } catch (reason: any) {
      setError(reason?.message || 'Your Status could not be published. Please try again.');
    } finally {
      setPublishing(false);
    }
  }, [publishing, text, token, onClose, toast]);

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
          <MessagesSquare size={16} className="text-[#c9a227]" />
          New Status
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

      {/* Composer surface — the text is the focus */}
      <div className="flex min-h-0 flex-1 flex-col px-6 pt-6">
        <div className="flex min-h-0 flex-1 items-stretch">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={event => setText(normalizeStatusEditorValue(event.target.value))}
            onPaste={event => {
              event.preventDefault();
              const pasted = event.clipboardData?.getData('text/plain') || '';
              setText(previous => normalizeStatusEditorValue(previous + pasted));
            }}
            placeholder="Share what's on your mind…"
            aria-label="Write your Status"
            className="min-h-0 w-full resize-none bg-transparent text-[26px] leading-snug text-white outline-none placeholder:text-white/25"
            style={{ minHeight: '40vh' }}
          />
        </div>

        {/* Live counters */}
        <div className="flex shrink-0 items-center justify-between pb-3">
          <p className={cn('text-xs leading-5', counts.overLines ? 'text-[#e5484d]' : 'text-white/35')}>
            {counts.lines}/{STATUS_MAX_LINES} lines
          </p>
          <p
            className={cn(
              'text-sm font-semibold tabular-nums tracking-wide transition-colors',
              counts.overChars ? 'text-[#e5484d]' : limitReached ? 'text-[#dfbd55]' : 'text-white/45'
            )}
            aria-live="polite"
          >
            {counts.chars} / {STATUS_MAX_CHARS}
          </p>
        </div>
      </div>

      {error && (
        <p role="alert" className="shrink-0 px-6 pb-2 text-xs text-[#ff9b9b]">{error}</p>
      )}

      {/* Publish bar — keyboard + safe-area aware */}
      <footer
        className="shrink-0 border-t border-white/[0.07] bg-[#0b0b0e]/95 px-4 pt-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + var(--vanta-kb, 0px) + 16px)' }}
      >
        <button
          type="button"
          onClick={() => void publish()}
          disabled={!text.trim() || publishing}
          aria-label="Publish Status"
          className="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-[#c9a227] text-[15px] font-bold text-black transition hover:bg-[#dfbd55] active:scale-[0.99] disabled:opacity-30"
        >
          {publishing ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
          {publishing ? 'Publishing…' : 'Publish Status'}
        </button>
      </footer>
    </div>
  );
}