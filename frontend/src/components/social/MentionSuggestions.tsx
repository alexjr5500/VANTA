'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Loader2 } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';
import { apiGet } from '@/lib/apiClient';
import type { VerificationType } from '@/types/verification';

/** Shared by post, replies, comments and chat; a mention is a username, never raw HTML. */
export type MentionUser = {
  id: string;
  username: string;
  fullName?: string | null;
  avatar?: string | null;
  verified?: boolean;
  verificationType?: VerificationType | null;
  following?: boolean;
};

export type ActiveMention = { prefixStart: number; end: number; query: string };

/** Only query the @token immediately before the caret, not earlier mentions or email addresses. */
export function mentionAtCaret(value: string, caret: number): ActiveMention | null {
  if (caret < 0 || caret > value.length) return null;
  const preceding = value.slice(0, caret);
  const match = /(?:^|[\s([{])@([a-zA-Z0-9_]{1,30})$/.exec(preceding);
  if (!match) return null;
  const prefixStart = caret - match[1].length - 1;
  return { prefixStart, end: caret, query: match[1] };
}

export function applyMention(value: string, mention: ActiveMention, username: string): { value: string; caret: number } {
  const insertion = `@${username} `;
  return {
    value: value.slice(0, mention.prefixStart) + insertion + value.slice(mention.end),
    caret: mention.prefixStart + insertion.length,
  };
}

type Args = {
  value: string;
  onChange: (next: string) => void;
  token: string | null | undefined;
  inputRef: RefObject<HTMLTextAreaElement | null>;
};

export function useMentionSuggestions({ value, onChange, token, inputRef }: Args) {
  const [caret, setCaret] = useState(-1);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [users, setUsers] = useState<MentionUser[]>([]);
  const [following, setFollowing] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const followingLoaded = useRef<string | null>(null);
  const request = useRef(0);
  const mention = useMemo(() => mentionAtCaret(value, caret), [value, caret]);
  const mentionKey = mention ? `${mention.prefixStart}:${mention.query}` : null;
  const open = Boolean(token && mention && mentionKey !== dismissed);

  const syncCaret = useCallback((input: HTMLTextAreaElement) => {
    setCaret(input.selectionStart);
    setDismissed(null);
  }, []);

  // Fetch only discoverable users through VANTA's existing authenticated search,
  // once per @prefix. Discard stale results when the user types again quickly.
  useEffect(() => {
    const sequence = ++request.current;
    if (!open || !mention || !token) { setUsers([]); setLoading(false); return; }
    setLoading(true);
    setActiveIndex(0);
    const timer = window.setTimeout(() => {
      void apiGet<{ users?: MentionUser[] }>(
        `/api/search?q=${encodeURIComponent(mention.query)}&type=users&limit=20`,
        token,
        { skipCache: true },
      ).then(result => {
        if (request.current === sequence) setUsers(Array.isArray(result.users) ? result.users : []);
      }).catch(() => {
        if (request.current === sequence) setUsers([]);
      }).finally(() => {
        if (request.current === sequence) setLoading(false);
      });
    }, 180);
    return () => { ++request.current; window.clearTimeout(timer); };
  }, [mentionKey, open, token]);

  // Used for "Following" labels and the preferred ordering in the reference.
  // Never show hidden users: the actual candidate list still comes from search.
  useEffect(() => {
    if (!open || !token || followingLoaded.current === token) return;
    followingLoaded.current = token;
    setFollowing(new Set());
    void apiGet<{ items?: MentionUser[] }>('/api/feed/following?limit=50', token, { skipCache: true })
      .then(result => setFollowing(new Set((result.items || []).map(u => u.id))))
      .catch(() => setFollowing(new Set()));
  }, [open, token]);

  const matches = useMemo(
    () => [...users].map(user => ({ ...user, following: following.has(user.id) })).sort((a, b) => Number(b.following) - Number(a.following)),
    [users, following],
  );

  const pick = useCallback((user: MentionUser) => {
    if (!mention) return;
    const updated = applyMention(value, mention, user.username);
    onChange(updated.value);
    setCaret(-1);
    setDismissed(null);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.setSelectionRange(updated.caret, updated.caret);
    });
  }, [inputRef, mention, onChange, value]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(mentionKey);
      return true;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(index => Math.max(0, Math.min(matches.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
      return true;
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && matches[activeIndex] && !event.nativeEvent.isComposing) {
      event.preventDefault();
      pick(matches[activeIndex]);
      return true;
    }
    return false;
  };

  return { open, loading, matches, activeIndex, setActiveIndex, pick, onKeyDown, syncCaret, close: () => setDismissed(mentionKey) };
}

/** Reusable nonmodal suggestions list: avatar, account, badge and following status. */
export function MentionSuggestions({ mention, className = '' }: {
  mention: ReturnType<typeof useMentionSuggestions>;
  className?: string;
}) {
  if (!mention.open) return null;
  return (
    <div
      role="listbox"
      aria-label="Mention accounts"
      className={`relative z-[120] max-h-[min(42dvh,360px)] w-full overflow-y-auto overscroll-contain border-y border-[var(--border)] bg-[var(--background)] shadow-2xl ${className}`}
    >
      {mention.loading && (
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin" /> Finding accounts…</div>
      )}
      {!mention.loading && mention.matches.length === 0 && <div className="px-4 py-3 text-sm text-[var(--text-muted)]">No matching accounts</div>}
      {mention.matches.map((user, i) => (
        <button
          key={user.id}
          type="button"
          role="option"
          aria-selected={i === mention.activeIndex}
          onMouseDown={event => event.preventDefault()}
          onClick={() => mention.pick(user)}
          onMouseEnter={() => mention.setActiveIndex(i)}
          className={`flex min-h-[70px] w-full items-center gap-3 px-4 py-2.5 text-left transition ${i === mention.activeIndex ? 'bg-[var(--surface)]' : 'hover:bg-[var(--surface)]'}`}
        >
          <Avatar src={user.avatar} alt={user.username} size="lg" />
          <span className="min-w-0 flex-1">
            {user.following && <span className="block text-[11px] text-[var(--text-muted)]">Following</span>}
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold text-[var(--text-primary)]">{user.fullName || user.username}</span>
              {user.verified && user.verificationType && <VerificationBadge type={user.verificationType} size="xs" />}
            </span>
            <span className="block truncate text-xs text-[var(--text-muted)]">@{user.username}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
