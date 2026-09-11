'use client';

import { cn } from '@/lib/utils';
import Avatar from '@/components/ui/Avatar';

// ============================================================================
// Shared VANTA story circle
// ============================================================================
// One canonical story/avatar ring used everywhere stories are displayed (Home,
// Discover, trays, etc). The ring is exactly sized around the avatar:
// outer = size, inner padding keeps a small bezel between ring and avatar, and
// the avatar fills the remaining area edge-to-edge (object-cover) so there is
// NEVER a big empty bezel.
//
// Two rendering modes:
//   1. Simple ring — one solid gradient (gold = unviewed/your story, gray =
//      fully viewed). Used when only aggregate state is known (`active`).
//   2. Segmented ring — a single circular ring divided into one arc per active
//      story item (via SVG arc). Each segment reflects that story's
//      viewed/unviewed state, so a user with 1 story shows ONE complete ring,
//      2 stories show TWO segments, and so on. The avatar is NEVER duplicated —
//      one avatar + one segmented ring.
// ============================================================================

export interface StorySegment {
  id: string | number;
  /** true = this specific story has been viewed (muted), false = unviewed */
  viewed?: boolean;
}

export interface StoryCircleProps {
  src?: string | null;
  alt?: string;
  /**
   * Aggregate "has unviewed" flag used only when `segments` is omitted.
   * true = gold gradient ring (unviewed); false = muted seen ring.
   */
  active: boolean;
  /** Show a small emerald "new story" dot bottom-right (active only) */
  showDot?: boolean;
  /** Outer diameter: 'sm' = 48px, 'md' = 64px (matches Home tray columns) */
  size?: 'sm' | 'md';
  /**
   * When provided, render the ring as ONE circle segmented into one arc per
   * story item, honoring each segment's viewed/unviewed state. There must be
   * at least one segment. If `segments` is empty/omitted the simple ring is used.
   */
  segments?: StorySegment[];
  className?: string;
}

const SIZES = {
  // outer size, avatar inner padding, ring stroke width (SVG viewBox units)
  sm: { outer: 'h-12 w-12', pad: 'p-[3px]', stroke: 5.5 },
  md: { outer: 'h-16 w-16', pad: 'p-[3px]', stroke: 6.5 },
} as const;

// Center of the SVG (viewBox 0 0 100 100).
const RING_CENTER = 50;

/**
 * Renders the full circular ring as a set of arc segments — one per story item.
 * Each segment's color reflects that story's viewed/unviewed state.
 */
function SegmentedRing({
  n,
  viewed,
  stroke,
}: {
  n: number;
  viewed: boolean[];
  stroke: number;
}) {
  const c = RING_CENTER;
  const r = 50 - stroke / 2 - 1; // keep the stroke fully inside the border-box
  const circumference = 2 * Math.PI * r;

  // Angle per segment, plus a small visual gap (in circumference units) between
  // segments so each story arc is clearly separated.
  const segAngle = 360 / n;
  const gap = Math.min(circumference * 0.035, 4); // ~3.5% gap between segments
  const arcLen = circumference / n;
  const visible = Math.max(arcLen - gap, 1);
  const viewedColor = 'rgba(255,255,255,0.16)';

  return (
    <svg
      viewBox="0 0 100 100"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      {Array.from({ length: n }).map((_, i) => {
        // Start from 12 o'clock and sweep clockwise.
        const startAngle = i * segAngle - 90;
        const isViewed = viewed[i];
        return (
          <circle
            key={i}
            cx={c}
            cy={c}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            stroke={isViewed ? viewedColor : 'var(--vanta-gold)'}
            strokeDasharray={`${visible} ${Math.max(circumference - visible, 1)}`}
            transform={`rotate(${startAngle} ${c} ${c})`}
          />
        );
      })}
    </svg>
  );
}

export default function StoryCircle({
  src,
  alt = 'Story',
  active,
  showDot = false,
  size = 'md',
  segments,
  className,
}: StoryCircleProps) {
  const { outer, pad, stroke } = SIZES[size];
  const hasSegments = Array.isArray(segments) && segments.length > 0;
  const count = hasSegments ? segments!.length : 0;
  const viewedFlags = hasSegments ? segments!.map(seg => Boolean(seg.viewed)) : [];
  // Overall "active" for the segmented ring = any segment is unviewed.
  const anyUnviewed = hasSegments ? viewedFlags.some(v => !v) : active;
  const label = hasSegments
    ? `${alt} — ${count} active ${count === 1 ? 'story' : 'stories'}`
    : alt;

  return (
    <span
      className={cn('relative block flex-none rounded-full', outer, className)}
      role={alt ? 'img' : undefined}
      aria-label={alt ? label : undefined}
    >
      {hasSegments ? (
        <SegmentedRing n={count} viewed={viewedFlags} stroke={stroke} />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            'block h-full w-full rounded-full',
            active
              ? 'bg-gradient-to-br from-[#d6a83f] via-[#c8c8cc] to-[#f5f5f5]'
              : 'border border-[#3a3a40] bg-white/[0.1]'
          )}
        />
      )}

      {/* Inner padding keeps a small bezel between the ring and the avatar */}
      <span className={cn('block h-full w-full overflow-hidden rounded-full', pad)}>
        <Avatar
          src={src}
          alt={alt}
          size={size === 'sm' ? 'md' : 'lg'}
          wrapperClassName="!h-full !w-full"
          className="!h-full !w-full !rounded-full"
        />
      </span>

      {showDot && anyUnviewed && (
        <span className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-2 border-[#0a0a0f] bg-emerald-500" aria-hidden="true" />
      )}
    </span>
  );
}