'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import StoryCard from '@/components/story/StoryCard';
import StatusUploadProgress from '@/components/story/StatusUploadProgress';
import {
  fetchStoryGroups,
  type StoryGroup,
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
  /** Scroll container used to collapse the user's own Status while browsing. */
  scrollRef?: { current: HTMLElement | null };
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
  scrollRef,
}: StoryTrayProps) {
  const { token, user } = useAuth();
  const router = useRouter();
  const [groups, setGroups] = useState<StoryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusCollapsed, setStatusCollapsed] = useState(false);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const storyGroups = await fetchStoryGroups(token);
      if (!mountedRef.current) return;
      setGroups(storyGroups);
      onStoriesChange?.(storyGroups);
    } catch {
      if (!mountedRef.current) return;
      // Retain the last successfully loaded stories during transient failures.
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [token, onStoriesChange]);

  useEffect(() => {
    const scroller = scrollRef?.current;
    if (!scroller) return;
    const onScroll = () => setStatusCollapsed(scroller.scrollTop > 84);
    onScroll();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [scrollRef]);

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


  return (
    <section
      aria-label="Stories and Status"
      className={cn(
        // Keep the Home top strip fully opaque. On installed web apps, extend
        // that same slate surface through the iOS safe-area/status-bar inset.
        // Native Android already reserves the status bar in the WebView host.
        'sticky top-0 z-30 border-b border-white/[0.07] bg-[var(--header-surface)] transition-[padding] duration-300',
        compact
          ? (statusCollapsed ? 'pt-[env(safe-area-inset-top)] pb-0.5 [html.vanta-native-android_&]:pt-0.5' : 'pt-[max(4px,env(safe-area-inset-top))] pb-1 [html.vanta-native-android_&]:pt-1')
          : 'px-0 py-2',
        className
      )}
    >

      <div className={cn('flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide', compact ? (statusCollapsed ? 'px-1 gap-1' : 'px-1 gap-1.5') : 'px-2')}>
          {/* Own Status card — always present */}
          {<StoryCard
            user={{
              id: user?.id || 'me',
              username: user?.username || 'you',
              fullName: user?.fullName,
              // Auth sessions can expose the Profile table's avatarUrl
              // separately from the legacy User.avatar field.
              avatar: (typeof user?.avatar === 'string' ? user.avatar : null) || (typeof user?.avatarUrl === 'string' ? user.avatarUrl : null) || (typeof user?.profile?.avatarUrl === 'string' ? user.profile.avatarUrl : null) || (typeof user?.profile?.avatar === 'string' ? user.profile.avatar : null),
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
            collapsed={statusCollapsed}
          />}

          {loading ? (
            SKELETON.map(index => (
              <div key={index} className={cn("flex shrink-0 flex-col items-center transition-all duration-300", statusCollapsed ? "w-14 gap-0.5" : "w-[74px] gap-1.5")}>
                <span className={cn('block animate-pulse rounded-full bg-white/[0.05]', statusCollapsed ? 'h-11 w-11' : compact ? 'h-[55px] w-[55px]' : 'h-[66px] w-[66px]')} />
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
                  collapsed={statusCollapsed}
                />
              );
            })
          )}

        </div>
    <StatusUploadProgress />
    </section>
  );
}
