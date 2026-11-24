'use client';

import { cn } from '@/lib/utils';
import StoryCircle from '@/components/ui/StoryCircle';
import VerificationBadge from '@/components/ui/VerificationBadge';
import type { StoryAuthor, StoryItem } from '@/lib/storyApi';

export interface StoryCardProps {
  user: StoryAuthor;
  stories: StoryItem[];
  hasUnviewed: boolean;
  /** Own tray card (shows the add-story affordance). */
  isOwn?: boolean;
  onCreate?: () => void;
  onOpen: () => void;
  /** Smaller 48px treatment for dense trays. */
  compact?: boolean;
  collapsed?: boolean;
}

const TRUNCATE = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * One premium VANTA Story card. Distinctive treatment: refined gold ring for
 * unseen stories, faint silver ring for fully-viewed, a segmented arc ring for
 * multi-story users, a NEW dot, and the owner's "add" card.
 */
export default function StoryCard({
  user,
  stories,
  hasUnviewed,
  isOwn = false,
  onCreate,
  onOpen,
  compact = false,
  collapsed = false,
}: StoryCardProps) {
  const segments = (stories || []).map(story => ({ id: story.id, viewed: Boolean(story.viewed) }));
  const name = TRUNCATE(user.fullName || user.username || 'VANTA', compact ? 12 : 14);

  if (isOwn) {
    return (
      <div className={cn("flex shrink-0 flex-col items-center transition-all duration-300 ease-out", collapsed ? "w-[52px] gap-0" : compact ? "w-[74px] gap-1" : "w-[94px] gap-1.5")} data-story-card="own">
        <span className="group relative">
          <button
            type="button"
            aria-label={stories.length ? 'View your Status' : 'Add a Status'}
            onClick={stories.length ? onOpen : onCreate}
            className="block rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#dfbd55]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d0d0f]"
          >
            <StoryCircle
              src={user.avatar}
              alt="Your Story"
              active={hasUnviewed}
              showDot
              segments={stories.length ? segments : undefined}
              size={collapsed ? 'xs' : compact ? 'sm' : 'xl'}
              verified={Boolean(user.verified && user.verificationType)}
              verificationType={user.verificationType}
            />
          </button>
          {onCreate && (
            <button
              type="button"
              aria-label="Add a Status or Story"
              onClick={onCreate}
              className={cn('absolute grid place-items-center rounded-full border-2 border-[#0d0d0f] bg-[#c9a227] text-black transition-all duration-300 active:scale-90', collapsed ? '-bottom-0.5 -right-0.5 h-5 w-5' : compact ? '-bottom-0.5 -right-0.5 h-6 w-6' : '-bottom-1 -right-1 h-[26px] w-[26px]')}
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true"><path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
            </button>
          )}
        </span>
        <span className={cn("max-w-[94px] truncate text-[11px] leading-tight text-[#8a8a8a] transition-all duration-200", collapsed && "h-0 max-w-0 overflow-hidden opacity-0")}>
          {stories.length ? 'My Story' : 'My Story'}
        </span>
      </div>
    );
  }

  const opener = hasUnviewed
    ? (stories.find(item => !item.viewed) || stories[0])
    : stories[0];
  void opener; // open target is resolved by the tray navigation (first unviewed)

  return (
    <button
      type="button"
      aria-label={`${user.username || 'User'} — ${stories.length} active story${stories.length === 1 ? '' : 's'}${hasUnviewed ? ', unseen' : ''}`}
      onClick={onOpen}
      className={cn("group flex shrink-0 flex-col items-center outline-none transition-all duration-300 ease-out focus-visible:ring-2 focus-visible:ring-[#dfbd55]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d0d0f]", collapsed ? "w-[48px] gap-0" : "w-[78px] gap-1.5")}
    >
      <span className={cn('relative block rounded-full transition-all duration-300', collapsed ? 'h-11 w-11' : compact ? 'h-[52px] w-[52px]' : 'h-[66px] w-[66px]')}>
        <StoryCircle
          src={user.avatar}
          alt={user.username || 'Story'}
          active={hasUnviewed}
          showDot
          segments={segments}
          size={collapsed ? 'xs' : compact ? 'sm' : 'md'}
        />
      </span>
      <span className={cn("flex max-w-[78px] items-center gap-0.5 text-[11px] leading-tight text-[#8a8a8a] transition-all duration-200", collapsed && "h-0 max-w-0 overflow-hidden opacity-0")}>
        <span className={cn('truncate transition-colors', hasUnviewed ? 'font-semibold text-[#e8e8e8]' : 'group-hover:text-[#c8c8cc]')}>
          {name}
        </span>
        {user.verified && user.verificationType && <VerificationBadge verified type={user.verificationType} size="xs" />}
      </span>
    </button>
  );
}