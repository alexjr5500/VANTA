'use client';

import { cn } from '@/lib/utils';
import Avatar from '@/components/ui/Avatar';

// ============================================================================
// Shared VANTA story ring — the premium 2026 treatment.
//
// The ring is rendered with a CSS conic-gradient (unviewed = refined gold;
// seen = faint silver) so it is buttery on low-end phones. When per-story
// viewed state is known (`segments`) a single SVG arc ring is used instead —
// one arc per active story — honouring each story's viewed/unviewed state.
// The avatar always fills the ring edge-to-edge (object-cover) so there is
// never a big empty bezel.
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
   * true = gold ring (unviewed); false = muted seen ring.
   */
  active: boolean;
  /** Show a small emerald "NEW" dot bottom-right (active only) */
  showDot?: boolean;
  /** Outer diameter: 'sm' = 48px, 'md' = 66px (matches Home tray columns). */
  size?: 'sm' | 'md';
  /**
   * Optional per-story viewed segments. When provided the ring is ONE circle
   * divided into one gold/faint arc per story item.
   */
  segments?: StorySegment[];
  className?: string;
}

const SIZES = {
  // outer size, avatar inner padding, ring stroke width (SVG viewBox units)
  sm: { outer: 'h-12 w-12', pad: 'p-[3px]', stroke: 5 },
  md: { outer: 'h-[66px] w-[66px]', pad: 'p-[3px]', stroke: 6 },
} as const;

// Center of the SVG (viewBox 0 0 100 100).
const RING_CENTER = 50;

/**
 * Segmented circular ring — one gold/faint arc per story item so multi-story
 * users clearly show each story's seen/unseen state.
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

  const segAngle = 360 / n;
  const gap = Math.min(circumference * 0.045, 5); // small gap between segments
  const arcLen = circumference / n;
  const visible = Math.max(arcLen - gap, 1);
  const seenColor = 'rgba(255,255,255,0.18)';

  return (
    <svg
      viewBox="0 0 100 100"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      {Array.from({ length: n }).map((_, i) => {
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
            stroke={isViewed ? seenColor : 'url(#vantaGoldRing)'}
            strokeDasharray={`${visible} ${Math.max(circumference - visible, 1)}`}
            transform={`rotate(${startAngle} ${c} ${c})`}
          />
        );
      })}
      <defs>
        <linearGradient id="vantaGoldRing" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#dfbd55" />
          <stop offset="55%" stopColor="#c9a227" />
          <stop offset="100%" stopColor="#a48220" />
        </linearGradient>
      </defs>
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
      className={cn('relative block flex-none rounded-full shadow-[0_2px_12px_rgba(0,0,0,0.35)]', outer, className)}
      role={alt ? 'img' : undefined}
      aria-label={alt ? label : undefined}
    >
      {hasSegments ? (
        <SegmentedRing n={count} viewed={viewedFlags} stroke={stroke} />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-0 h-full w-full rounded-full',
            active
              ? 'bg-[conic-gradient(from_210deg_at_50%_50%,#dfbd55_0%,#c9a227_38%,#a48220_52%,#dfbd55_76%,#c9a227_100%)]'
              : 'border border-white/10 bg-white/[0.05]'
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
        <span
          className="absolute -bottom-0.5 -right-0.5 grid h-[18px] w-[18px] place-items-center rounded-full border-2 border-[#0a0a0f] bg-emerald-500"
          aria-hidden="true"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-white/90" />
        </span>
      )}
    </span>
  );
}