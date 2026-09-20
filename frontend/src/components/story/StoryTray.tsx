'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import StoryCard from '@/components/story/StoryCard';
import {
  fetchStoryGroups,
  fetchStatusUsage,
  type StoryGroup,
  type StoryUsage,
} from '@/lib/storyApi';
import { onStoryFeedChanged } from '@/lib/storyEvents';

export interface StoryTrayProps {
  /** Imperative refresh trigger (increments after publish/delete). */
  refreshKey?: number;
  onCreate?: () => void;
  /** Fires whenever the tray data changes (used by pages for their own state). */
  onStoriesChange?: (groups: StoryGroup[]) => void;
  compact?: boolean;
  className?: string;
}

const SKELETON = [0, 1, 2, 3, 4];

/**
 * The premium VANTA Story/Status tray.
 *
 * One clear presentation of: who has Stories, who does not, the current user's
 * own Status, the add action, viewed/unviewed rings and the live daily quota.
 * Fetches the existing `/api/stories` + `/api/stories/usage` endpoints — no
 * new backend surface.
 */
export default function StoryTray({
  refreshKey = 0,
  onCreate,
  onStoriesChange,
  compact = false,
  className,
}: StoryTrayProps) {
  const { token, user } = useAuth();
  const router = useRouter();
  const [groups, setGroups] = useState<StoryGroup[]>([]);
  const [usage, setUsage] = useState<StoryUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const [storyGroups, usageData] = await Promise.all([
        fetchStoryGroups(token),
        fetchStatusUsage(token).catch(() => null),
      ]);
      if (!mountedRef.current) return;
      setGroups(storyGroups);
      setUsage(usageData);
      onStoriesChange?.(storyGroups);
    } catch {
      if (!mountedRef.current) return;
      setError(true);
      setGroups([]);
      onStoriesChange?.([]);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [token, onStoriesChange]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    const unsubscribe = onStoryFeedChanged(() => void load());
    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, [load, refreshKey]);

  const openViewer = useCallback(
    (owner: { id?: string }, storyId?: string) => {
      const ownerId = owner.id;
      if (!ownerId) return;
      const target = storyId
        ? `/stories/${encodeURIComponent(ownerId)}?start=${encodeURIComponent(storyId)}`
        : `/stories/${encodeURIComponent(ownerId)}`;
      router.push(target);
    },
    [router]
  );

  const ownGroup = groups.find(
    group => String(group.user.id) === String(user?.id)
  );

  const otherGroups = groups.filter(
    group => String(group.user.id) !== String(user?.id)
  );

  const holdEmpty = !ownGroup && otherGroups.length === 0;

  return (
    <section
      aria-label="Stories and Status"
      className={cn(
        'border-b border-white/[0.07]',
        compact ? 'py-3' : 'px-1 py-4',
        className
      )}
    >
      <div className={cn('mb-3 flex items-center justify-between', compact ? 'px-1' : 'px-3')}>
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8a8a8a]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#c9a227]" aria-hidden="true" />
          Stories &amp; Status
        </h2>
        {usage && !usage.unlimited && (
          <span
            className="rounded-full border border-white/[0.07] bg-white/[0.03] px-2.5 py-1 text-[10px] font-medium tabular-nums text-[#8a8a8a]"
            title={`${usage.used} Status posts published today out of ${usage.limit}`}
          >
            {usage.used}
            <span className="text-[#555]"> / {usage.limit} today</span>
          </span>
        )}
      </div>

      {error ? (
        <div className="flex items-center gap-3 px-3 py-4">
          <p className="text-xs leading-5 text-[#666]">Couldn&apos;t load Stories.</p>
          <button
            type="button"
            aria-label="Retry loading Stories"
            onClick={() => void load()}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-3 py-2 text-xs text-[#b8b8b8] transition hover:bg-white/[0.05]"
          >
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      ) : (
        <div className={cn('flex gap-4 overflow-x-auto pb-1 scrollbar-hide', compact ? 'px-1' : 'px-3')}>
          {/* Own Status card — always present */}
          <StoryCard
            user={{
              id: user?.id || 'me',
              username: user?.username || 'you',
              fullName: user?.fullName,
              avatar: user?.avatar || null,
              verified: Boolean(user?.verified),
            }}
            stories={ownGroup?.stories || []}
            hasUnviewed={Boolean(ownGroup?.hasUnviewed)}
            isOwn
            onCreate={onCreate}
            onOpen={() => {
              const opener = ownGroup?.stories.find(s => !s.viewed) || ownGroup?.stories[0];
              openViewer({ id: user?.id }, opener?.id);
            }}
            compact={compact}
          />

          {loading ? (
            SKELETON.map(index => (
              <div key={index} className="flex w-[74px] shrink-0 flex-col items-center gap-1.5">
                <span className={cn('block animate-pulse rounded-full bg-white/[0.05]', compact ? 'h-12 w-12' : 'h-[66px] w-[66px]')} />
                <span className="h-2.5 w-12 animate-pulse rounded bg-white/[0.04]" />
              </div>
            ))
          ) : (
            otherGroups.map(group => {
              const opener = group.hasUnviewed
                ? (group.stories.find(item => !item.viewed) || group.stories[0])
                : group.stories[0];
              return (
                <StoryCard
                  key={group.user.id}
                  user={group.user}
                  stories={group.stories}
                  hasUnviewed={group.hasUnviewed}
                  onOpen={() => openViewer(group.user, opener?.id)}
                  compact={compact}
                />
              );
            })
          )}

          {!loading && holdEmpty && (
            <button
              type="button"
              onClick={onCreate}
              className="flex w-[74px] shrink-0 flex-col items-center gap-1.5 outline-none"
              aria-label="Share your first story"
            >
              <span className="grid h-[66px] w-[66px] place-items-center rounded-full border border-dashed border-white/[0.16] bg-white/[0.02] text-[#8a8a8a] transition hover:border-[#c9a227]/50 hover:text-[#dfbd55]">
                <Sparkles size={22} />
              </span>
              <span className="text-[11px] text-[#666]">First story</span>
            </button>
          )}
        </div>
      )}

      {!loading && !holdEmpty && (
        <p className={cn('mt-2 flex items-center gap-1.5 text-[11px] text-[#555]', compact ? 'px-1' : 'px-3')}>
          <X size={11} className="text-[#c9a227]/70" aria-hidden="true" />
          Stories disappear after 24 hours · unseen rings are gold
        </p>
      )}
    </section>
  );
}