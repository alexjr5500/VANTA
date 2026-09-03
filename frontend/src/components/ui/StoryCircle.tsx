'use client';

import { cn } from '@/lib/utils';
import Avatar from '@/components/ui/Avatar';

// ============================================================================
// Shared VANTA story circle
// ============================================================================
// One canonical story/avatar ring used everywhere stories are displayed (Home,
// Discover, trays, etc). The ring is exactly sized around the avatar:
// outer = size, inner padding from `ring` prop, avatar fills the remaining
// area edge-to-edge (object-cover) so there is NEVER a big empty bezel.
// A gold gradient ring means "has unviewed stories"; gray means all viewed.
// ============================================================================

export interface StoryCircleProps {
  src?: string | null;
  alt?: string;
  /** true = gold gradient ring (unviewed/your story); false = muted seen ring */
  active: boolean;
  /** Show a small emerald "new story" dot bottom-right */
  showDot?: boolean;
  /** Outer diameter: 'sm' = 48px, 'md' = 64px (matches Home tray columns) */
  size?: 'sm' | 'md';
  className?: string;
}

const SIZES = {
  sm: 'h-12 w-12',
  md: 'h-16 w-16',
} as const;

export default function StoryCircle({
  src,
  alt = 'Story',
  active,
  showDot = false,
  size = 'md',
  className,
}: StoryCircleProps) {
  const outerSize = SIZES[size];

  return (
    <span
      className={cn(
        'relative block flex-none rounded-full p-[3px]',
        outerSize,
        active
          ? 'bg-gradient-to-br from-[#d6a83f] via-[#c8c8cc] to-[#f5f5f5]'
          : 'border border-[#3a3a40] bg-white/[0.1]',
        className
      )}
      aria-hidden={alt ? undefined : true}
    >
      <span className="block h-full w-full overflow-hidden rounded-full">
        <Avatar
          src={src}
          alt={alt}
          size={size === 'sm' ? 'md' : 'lg'}
          wrapperClassName="!h-full !w-full"
          className="!h-full !w-full !rounded-full"
        />
      </span>
      {showDot && active && (
        <span className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-2 border-[#0a0a0f] bg-emerald-500" aria-hidden="true" />
      )}
    </span>
  );
}