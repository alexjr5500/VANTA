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
}

const TRUNCATE = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * One premium VANTA Story card. Distinctive treatment: refined gold ring for
 * unseen stories, faint silver ring for fully-viewed, a segmented arc ring for
 * multi-story users, a NEW dot, a story-count pill, and the owner's "add" card.
 */
export default function StoryCard({
  user,
  stories,
  hasUnviewed,
  isOwn = false,
  onCreate,
  onOpen,
  compact = false,
}: StoryCardProps) {
  const segments = (stories || []).map(story => ({ id: story.id, viewed: Boolean(story.viewed) }));
  const unviewedCount = (stories || []).filter(story => !story.viewed).length;
  const name = TRUNCATE(user.fullName || user.username || 'VANTA', compact ? 12 : 14);

  if (isOwn) {
    return (
      <div className="flex w-[74px] shrink-0 flex-col items-center gap-1.5" data-story-card="own">
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
              size={compact ? 'sm' : 'md'}
            />
          </button>
          {onCreate && (
            <button
              type="button"
              aria-label="Add a Status or Story"
              onClick={onCreate}
              className="absolute -bottom-1 -right-1 grid h-[26px] w-[26px] place-items-center rounded-full border-2 border-[#0d0d0f] bg-[#c9a227] text-black shadow-[0_2px_10px_rgba(201,162,39,0.45)] transition-transform active:scale-90"
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true"><path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
            </button>
          )}
        </span>
        <span className="max-w-[74px] truncate text-[11px] leading-tight text-[#8a8a8a]">
          {stories.length ? 'Your Status' : 'Add Status'}
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
      className="group flex w-[74px] shrink-0 flex-col items-center gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-[#dfbd55]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d0d0f] data-[story-card=card]:transition"
    >
      <span className="relative">
        <StoryCircle
          src={user.avatar}
          alt={user.username || 'Story'}
          active={hasUnviewed}
          showDot
          segments={segments}
          size={compact ? 'sm' : 'md'}
        />
        {(stories.length > 1) && !hasUnviewed && (
          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-[#101014]/95 px-1.5 py-px text-[9px] font-bold tabular-nums text-white/70">
            {stories.length}
          </span>
        )}
        {hasUnviewed && unviewedCount > 1 && (
          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full border border-[#c9a227]/40 bg-[#201a08]/95 px-1.5 py-px text-[9px] font-bold tabular-nums text-[#dfbd55]">
            {unviewedCount} new
          </span>
        )}
      </span>
      <span className="flex max-w-[74px] items-center gap-0.5 text-[11px] leading-tight text-[#8a8a8a]">
        <span className={cn('truncate transition-colors', hasUnviewed ? 'font-semibold text-[#e8e8e8]' : 'group-hover:text-[#c8c8cc]')}>
          {name}
        </span>
        {user.verified && <VerificationBadge verified size="xs" />}
      </span>
    </button>
  );
}