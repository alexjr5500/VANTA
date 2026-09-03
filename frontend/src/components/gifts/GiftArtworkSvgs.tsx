'use client';

/**
 * GiftArtworkSvgs
 * -----------------------------------------------------------------------------
 * The complete VANTA gift artwork library — one hand-crafted, premium SVG
 * illustration per gift (73 total). Every gift has a DISTINCT silhouette, and
 * its animation (store/preview "animate=false" static representation, or the
 * live overlay "animate=true" celebration) is driven by the same `giftfx-*`
 * keyframes defined in globals.css. Store icons and received animations
 * therefore always show the same object, never a generic fallback.
 *
 * Art style (per VANTA Gift Visual Design Sheet):
 *  - glossy 3D-looking, luminous, layered gradients + specular highlights
 *  - dark-friendly VANTA blue accents + per-gift glow/particle colors
 *  - no flat emoji / cheap clip-art; premium cinematic lighting
 *  - richer glow, particles and depth for premium / luxury / mythic tiers
 *
 * All ids are namespaced with a `useId()` prefix so many gifts can render on
 * the same page (store grid) without SVG gradient collisions.
 */

import { useId, type CSSProperties, type ReactNode } from 'react';

export type GiftArtworkId =
  // Classic / Social
  | 'heart' | 'thumbs-up' | 'fire' | 'rose' | 'coffee' | 'balloon' | 'love'
  | 'teddy' | 'happy-day' | 'cake'
  // Luxury / Status
  | 'fancy-pearl' | 'diamond' | 'first-place' | 'crown' | 'lets-ride'
  | 'sports-car' | 'gold-medal' | 'rocket' | 'elite-status' | 'yacht'
  | 'ice-diamond' | 'castle' | 'pure-royalty' | 'galaxy'
  // Romantic / Floral
  | 'neon-flare' | 'ember-orbit' | 'solar-cinder' | 'crimson-bloom'
  | 'velvet-rose' | 'aurora-petal' | 'prism-kiss' | 'luminous-embrace'
  | 'starry-love'
  // Celebration
  | 'confetti-rocket' | 'aurora-party' | 'celebration-orb' | 'moon-shell'
  | 'iridescent-relic' | 'tide-pearl'
  // Champion / Achievement
  | 'champion-ribbon' | 'victory-medallion' | 'diamond-league'
  // Vehicles / Travel
  | 'hyper-roadster' | 'aurora-coupe' | 'velocity-x' | 'skyline-jet'
  | 'cloud-nine' | 'royal-flight'
  // Ice / Royal
  | 'frost-prism' | 'glacier-shard' | 'polar-star' | 'solar-crown'
  | 'empire-crown' | 'celestial-crown'
  // Cosmic / Futuristic
  | 'crystal-star' | 'violet-comet' | 'quantum-orb' | 'holo-badge'
  | 'plasma-ring' | 'nova-scepter' | 'eclipse-gem' | 'starlight-capsule'
  | 'infinite-spark' | 'galaxy-crest' | 'cosmic-wings'
  // Mythic
  | 'phoenix-flame' | 'royal-dragon' | 'aurora-castle' | 'platinum-throne'
  | 'time-crystal' | 'nebula-heart' | 'lunar-rose' | 'golden-horizon'
  // safe fallback
  | 'giftbox';

export type ArtContext = { u: string; animate: boolean };

const seq = (n: number) => Array.from({ length: n }, (_, i) => i);

/* ------------------------------------------------------------------ */
/* Resolver — map any gift (slug / artworkType) to ONE illustration.  */
/* ------------------------------------------------------------------ */
export function resolveGiftArtworkId(slug = '', artworkType = ''): GiftArtworkId {
  const s = (slug || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const t = (artworkType || '').trim().toLowerCase();
  if (!s && !t) return 'giftbox';
  const exact: Record<string, GiftArtworkId> = {
    'thumbs-up': 'thumbs-up', 'this-is-fire': 'fire', fire: 'fire', rose: 'rose',
    coffee: 'coffee', balloon: 'balloon', love: 'love', 'teddy-bear': 'teddy',
    'happy-day': 'happy-day', cake: 'cake', 'fancy-pearl': 'fancy-pearl',
    diamond: 'diamond', 'first-place': 'first-place', crown: 'crown',
    'lets-ride': 'lets-ride', 'sports-car': 'sports-car', 'gold-medal': 'gold-medal',
    rocket: 'rocket', 'elite-status': 'elite-status', yacht: 'yacht',
    'ice-diamond': 'ice-diamond', castle: 'castle', 'pure-royalty': 'pure-royalty',
    galaxy: 'galaxy', 'neon-flare': 'neon-flare', 'ember-orbit': 'ember-orbit',
    'solar-cinder': 'solar-cinder', 'crimson-bloom': 'crimson-bloom',
    'velvet-rose': 'velvet-rose', 'aurora-petal': 'aurora-petal', 'prism-kiss': 'prism-kiss',
    'luminous-embrace': 'luminous-embrace', 'starry-love': 'starry-love',
    'confetti-rocket': 'confetti-rocket', 'aurora-party': 'aurora-party',
    'celebration-orb': 'celebration-orb', 'moon-shell': 'moon-shell',
    'iridescent-relic': 'iridescent-relic', 'tide-pearl': 'tide-pearl',
    'champion-ribbon': 'champion-ribbon', 'victory-medallion': 'victory-medallion',
    'diamond-league': 'diamond-league', 'hyper-roadster': 'hyper-roadster',
    'aurora-coupe': 'aurora-coupe', 'velocity-x': 'velocity-x',
    'skyline-jet': 'skyline-jet', 'cloud-nine': 'cloud-nine',
    'royal-flight': 'royal-flight', 'frost-prism': 'frost-prism',
    'glacier-shard': 'glacier-shard', 'polar-star': 'polar-star',
    'solar-crown': 'solar-crown', 'empire-crown': 'empire-crown',
    'celestial-crown': 'celestial-crown', 'crystal-star': 'crystal-star',
    'violet-comet': 'violet-comet', 'quantum-orb': 'quantum-orb',
    'holo-badge': 'holo-badge', 'plasma-ring': 'plasma-ring',
    'nova-scepter': 'nova-scepter', 'eclipse-gem': 'eclipse-gem',
    'starlight-capsule': 'starlight-capsule', 'infinite-spark': 'infinite-spark',
    'galaxy-crest': 'galaxy-crest', 'cosmic-wings': 'cosmic-wings',
    'phoenix-flame': 'phoenix-flame', 'royal-dragon': 'royal-dragon',
    'aurora-castle': 'aurora-castle', 'platinum-throne': 'platinum-throne',
    'time-crystal': 'time-crystal', 'nebula-heart': 'nebula-heart',
    'lunar-rose': 'lunar-rose', 'golden-horizon': 'golden-horizon',
    teddy: 'teddy', heart: 'heart',
  };
  if (exact[s]) return exact[s];
  if (exact[t]) return exact[t];
  return 'giftbox';
}


/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */
function Glow({ u, cx = 80, cy = 72, r = 60, color, opacity = 0.5 }: { u: string; cx?: number; cy?: number; r?: number; color: string; opacity?: number }) {
  const gid = `${u}-g${color.replace(/[^a-z0-9]/gi, '')}`;
  return (
    <>
      <defs>
        <radialGradient id={gid} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={color} stopOpacity={opacity} />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={r} fill={`url(#${gid})`} />
    </>
  );
}

function GroundShadow({ u, cx = 80, cy = 140, w = 46, opacity = 0.5 }: { u: string; cx?: number; cy?: number; w?: number; opacity?: number }) {
  return (
    <ellipse cx={cx} cy={cy} rx={w} ry={w * 0.22} fill={`url(#${u}-shadow)`} opacity={opacity} />
  );
}

function Sparkle({ x, y, size = 6, color = '#ffffff', className = '' }: { x: number; y: number; size?: number; color?: string; className?: string }) {
  const w = size * 0.22;
  return (
    <g className={className} fill={color}>
      <path d={`M${x} ${y - size} L${x + w} ${y} L${x} ${y + size} L${x - w} ${y} Z`} />
      <path d={`M${x - size} ${y} L${x} ${y - w} L${x + size} ${y} L${x} ${y + w} Z`} opacity={0.85} />
    </g>
  );
}

function MiniHeart({ x, y, scale = 1, color = '#ff6b8f', className = '', style, opacity }: { x: number; y: number; scale?: number; color?: string; className?: string; style?: CSSProperties; opacity?: number }) {
  const c = scale * 0.34;
  return (
    <path
      className={className}
      style={style}
      opacity={opacity}
      d={`M${x} ${y + c * 3.2} C ${x - c * 5.6} ${y - c * 1.4} ${x - c * 2.6} ${y - c * 3} ${x} ${y - c * 0.4} C ${x + c * 2.6} ${y - c * 3} ${x + c * 5.6} ${y - c * 1.4} ${x} ${y + c * 3.2} Z`}
      fill={color}
    />
  );
}

function Petal({ x, y, w = 9, h = 16, color = '#ffb2cf', className = '', style, opacity }: { x: number; y: number; w?: number; h?: number; color?: string; className?: string; style?: CSSProperties; opacity?: number }) {
  return (
    <path
/* ------------------------------------------------------------------ */
/* CLASSIC / SOCIAL                                                    */
/* ------------------------------------------------------------------ */

/* 1 — Heart: glossy red/pink heart, VANTA-blue rim glow, beats twice,
      tiny hearts float away. */
function HeartArt({ u, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <linearGradient id={`${u}-hf`} x1="0" y1="0" x2="0.2" y2="1">
          <stop offset="0" stopColor="#ff6f8d" />
          <stop offset="0.45" stopColor="#f52154" />
          <stop offset="1" stopColor="#a80f33" />
        </linearGradient>
        <radialGradient id={`${u}-hs`} cx="0.32" cy="0.25" r="0.8">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="0.45" stopColor="#ffd1db" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffd1db" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${u}-shadow`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#000000" stopOpacity="0.5" />
          <stop offset="1" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Glow u={u} cx={80} cy={70} r={66} color="#ff3d66" opacity={0.5} />
      <circle className={animate ? 'giftfx-pulse-ring' : ''} cx={80} cy={70} r={56} fill="none" stroke="#3ecbff" strokeWidth={1.6} opacity={0.6} style={{ ['--pr' as string]: '2.6s' } as CSSProperties} />
      <g className={animate ? 'giftfx-beat' : ''}>
        <path
          d="M80 133 C 28 101 22 62 46 48 C 58 41 68 47 72 56 C 75 47 87 40 101 45 C 122 56 128 99 80 133 Z"
          fill={`url(#${u}-hf)`}
          stroke="#7e0a27"
          strokeWidth={2}
        />
        <path d="M80 133 C 28 101 22 62 46 48 C 58 41 68 47 72 56 C 75 47 87 40 101 45 C 88 60 76 92 80 133 Z" fill={`url(#${u}-hs)`} />
        <path d="M47 49 C 55 41 65 42 69 50 C 61 50 53 53 47 49 Z" fill="#ffffff" opacity={0.95} />
        <circle cx={57} cy={54} r={3.4} fill="#ffffff" />
        <path d="M103 50 C 111 55 113 62 111 69" fill="none" stroke="#ffffff" strokeWidth={2.6} strokeLinecap="round" opacity={0.4} />
      </g>
      <GroundShadow u={u} cy={140} w={36} />
      <g className={animate ? 'giftfx-heart-float' : ''} opacity={animate ? undefined : 0.9}>
        <MiniHeart x={26} y={52} scale={3.2} color="#ff6b8f" />
        <MiniHeart x={128} y={38} scale={2.4} color="#ff9abf" />
        <MiniHeart x={136} y={104} scale={1.9} color="#ffd1db" />
        <MiniHeart x={18} y={112} scale={2.1} color="#ff6b8f" opacity={0.7} />
      </g>
    </g>
  );
/* 2 — Thumbs Up: polished 3D hand with glow, pops upward, sparkle burst. */
function ThumbsUpArt({ u, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <linearGradient id={`${u}-skin`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe4c9" />
          <stop offset="0.5" stopColor="#f7b27f" />
          <stop offset="1" stopColor="#c9774a" />
        </linearGradient>
        <linearGradient id={`${u}-sleeve`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5ad7ff" />
          <stop offset="1" stopColor="#1770d8" />
        </linearGradient>
        <radialGradient id={`${u}-shadow`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#000000" stopOpacity="0.5" />
          <stop offset="1" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Glow u={u} cx={80} cy={74} r={62} color="#2f9bff" opacity={0.42} />
      <g className={animate ? 'giftfx-pop-soft' : ''}>
        <g>
          <path d="M80 32 C 89 32 95 38 95 47 C 95 56 89 61 80 61 C 71 61 65 56 65 47 C 65 38 71 32 80 32 Z" fill={`url(#${u}-skin)`} stroke="#a85c2f" strokeWidth={1.6} />
          <path d="M80 39 C 86 39 89 42 89 47 C 89 52 86 55 80 55 C 74 55 71 52 71 47 C 71 42 74 39 80 39 Z" fill="#fff" opacity={0.55} />
        </g>
        <path d="M66 61 L94 61 L104 86 L56 86 Z" fill={`url(#${u}-sleeve)`} stroke="#0e4c9a" strokeWidth={1.6} />
        <path d="M62 70 L98 70 L100 78 L60 78 Z" fill="#7fe3ff" opacity={0.5} />
        <circle cx={72} cy={112} r={14} fill={`url(#${u}-sleeve)`} opacity={0.85} />
        <circle cx={84} cy={123} r={14} fill={`url(#${u}-sleeve)`} opacity={0.85} />
        <circle cx={76} cy={133} r={12} fill={`url(#${u}-sleeve)`} opacity={0.7} />
      </g>
      <GroundShadow u={u} cy={140} w={40} opacity={0.35} />
      <g className={animate ? 'giftfx-sparkle' : ''}>
        <Sparkle x={42} y={30} size={7} color="#8ef5ff" />
        <Sparkle x={120} y={44} size={5.5} color="#c9adff" />
        <Sparkle x={126} y={104} size={4.5} color="#8ef5ff" />
      </g>
    </g>
  );
}
/* 3 — This Is Fire: stylized 3D flame with blue/orange luminous core,
      ignites → grows → flickers → sparks. */
function FireArt({ u, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <linearGradient id={`${u}-fow`} x1="0.5" y1="0" x2="0.5" y2="1">
          <stop offset="0" stopColor="#ff7a00" />
          <stop offset="1" stopColor="#d62b00" />
        </linearGradient>
        <linearGradient id={`${u}-fmid`} x1="0.5" y1="0" x2="0.5" y2="1">
          <stop offset="0" stopColor="#ffd166" />
          <stop offset="1" stopColor="#ff6a00" />
        </linearGradient>
        <linearGradient id={`${u}-fcore`} x1="0.5" y1="0" x2="0.5" y2="1">
          <stop offset="0" stopColor="#3ecbff" />
          <stop offset="0.45" stopColor="#fffbe6" />
          <stop offset="1" stopColor="#ffe37a" />
        </linearGradient>
        <radialGradient id={`${u}-shadow`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#000000" stopOpacity="0.5" />
          <stop offset="1" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Glow u={u} cx={80} cy={78} r={70} color="#ff5722" opacity={0.55} />
      <g className={animate ? 'giftfx-flicker' : ''}>
        <path d="M80 146 C 42 134 30 98 56 70 C 68 57 78 42 81 18 C 86 44 104 62 116 80 C 134 106 118 136 80 146 Z" fill={`url(#${u}-fow)`} stroke="#ff9a3d" strokeWidth={2} />
      </g>
      <g className={animate ? 'giftfx-flicker-fast' : ''}>
        <path d="M80 136 C 52 126 46 100 66 78 C 74 69 80 58 82 38 C 88 62 98 74 110 88 C 124 108 108 130 80 136 Z" fill={`url(#${u}-fmid)`} />
      </g>
      <g className={animate ? 'giftfx-flicker-slow' : ''}>
        <path d="M80 122 C 58 116 54 94 74 80 C 78 76 80 68 82 58 C 88 76 96 86 104 96 C 110 106 98 118 80 122 Z" fill={`url(#${u}-fcore)`} />
      </g>
      <circle cx={66} cy={30} r={2.6} fill="#ffd166" className={animate ? 'giftfx-spark' : ''} style={{ ['--sx' as string]: '-8px', ['--sy' as string]: '-16px', ['--kd' as string]: '1.3s' } as CSSProperties} />
      <circle cx={96} cy={22} r={3} fill="#ff9a3d" className={animate ? 'giftfx-spark' : ''} style={{ ['--sx' as string]: '9px', ['--sy' as string]: '-20px', ['--kd' as string]: '1.6s', ['--kdl' as string]: '0.4s' } as CSSProperties} />
      <circle cx={118} cy={48} r={2.2} fill="#3ecbff" className={animate ? 'giftfx-spark' : ''} style={{ ['--sx' as string]: '10px', ['--sy' as string]: '-14px', ['--kd' as string]: '1.5s', ['--kdl' as string]: '0.2s' } as CSSProperties} />
      <GroundShadow u={u} cy={140} w={30} opacity={0.4} />
    </g>
  );
}
/* 4 — Rose: elegant deep-red 3D rose, luminous stem; bud blooms, petals float. */
function RoseArt({ u, animate }: ArtContext) {
  const petals = [0, 1, 2, 3, 4];
  return (
    <g>
      <defs>
        <radialGradient id={`${u}-bud`} cx="0.42" cy="0.35" r="0.9">
          <stop offset="0" stopColor="#ff5c7e" />
          <stop offset="0.55" stopColor="#ed245c" />
          <stop offset="1" stopColor="#8f0d3a" />
        </radialGradient>
        <linearGradient id={`${u}-stem`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0f7a4d" />
          <stop offset="0.5" stopColor="#2ed98a" />
          <stop offset="1" stopColor="#0f7a4d" />
        </linearGradient>
        <radialGradient id={`${u}-shadow`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#000000" stopOpacity="0.5" />
          <stop offset="1" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Glow u={u} cx={80} cy={68} r={64} color="#ed245c" opacity={0.45} />
      <g className={animate ? 'giftfx-bloom' : ''}>
        {petals.map(i => {
          const a = (i / petals.length) * Math.PI * 2;
          return (
            <path
              key={i}
              d={`M80 74 C ${80 + Math.cos(a) * 26} ${74 + Math.sin(a) * 26} ${80 + Math.cos(a + 0.9) * 34} ${74 + Math.sin(a + 0.9) * 34} 80 74 Z`}
              fill={i % 2 ? '#ff4d75' : '#c4124b'}
              opacity={0.9}
              transform={`rotate(${(a * 180) / Math.PI} 80 74)`}
            />
          );
        })}
        <path d="M80 76 C 72 52 60 48 50 56 C 58 76 66 84 80 82 C 94 84 102 76 110 56 C 100 48 88 52 80 76 Z" fill="none" stroke="#ff8fa8" strokeWidth={1.4} opacity={0.6} />
        <circle cx={80} cy={70} r={17} fill={`url(#${u}-bud)`} stroke="#a80f33" strokeWidth={1.6} />
        <path d="M70 62 C 74 56 84 54 92 60" fill="none" stroke="#ffe3ec" strokeWidth={3} strokeLinecap="round" opacity={0.7} />
        <path d="M80 70 C 78 83 79 94 80 101 L80 138" stroke={`url(#${u}-stem)`} strokeWidth={7} strokeLinecap="round" />
        <path d="M80 92 C 64 92 52 100 46 114 C 56 112 68 106 80 100" fill="#1dac70" />
        <path d="M80 98 C 96 102 106 112 110 124 C 100 120 90 112 80 106" fill="#17915f" />
      </g>
      <GroundShadow u={u} cy={140} w={30} opacity={0.4} />
      <g className={animate ? 'giftfx-flower-drift' : ''}>
        <Petal x={34} y={40} w={7} h={13} color="#ff8fa8" className={animate ? 'giftfx-petal' : ''} style={{ ['--sx' as string]: '-18px', ['--sy' as string]: '46px', ['--pd' as string]: '3s', ['--rot' as string]: '140deg' } as CSSProperties} />
        <Petal x={124} y={52} w={6} h={11} color="#c4124b" className={animate ? 'giftfx-petal' : ''} style={{ ['--sx' as string]: '16px', ['--sy' as string]: '42px', ['--pd' as string]: '3.4s', ['--pdl' as string]: '0.5s', ['--rot' as string]: '-120deg' } as CSSProperties} />
        <Petal x={132} y={110} w={6} h={11} color="#ff5c7e" className={animate ? 'giftfx-petal' : ''} style={{ ['--sx' as string]: '-14px', ['--sy' as string]: '38px', ['--pd' as string]: '3.8s', ['--pdl' as string]: '0.9s', ['--rot' as string]: '90deg' } as CSSProperties} />
      </g>
    </g>
  );
}
/* 5 — Coffee: premium coffee cup with visible steam, sparkle. */
function CoffeeArt({ u, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <linearGradient id={`${u}-cup`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#3a3f5c" />
          <stop offset="0.5" stopColor="#6a729c" />
          <stop offset="1" stopColor="#2c3050" />
        </linearGradient>
        <linearGradient id={`${u}-coffeeG`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6b3a20" />
          <stop offset="1" stopColor="#3a1d0d" />
        </linearGradient>
        <radialGradient id={`${u}-shadow`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#000000" stopOpacity="0.5" />
          <stop offset="1" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Glow u={u} cx={80} cy={78} r={58} color="#8a5a2b" opacity={0.4} />
      <g className={animate ? 'giftfx-floaty' : ''}>
        <ellipse cx={80} cy={96} rx={34} ry={9} fill={`url(#${u}-coffeeG)`} stroke="#e8c48a" strokeWidth={2} />
        <path d="M46 96 L52 130 L108 130 L114 96 Z" fill={`url(#${u}-cup)`} stroke="#22264a" strokeWidth={2} />
        <path d="M50 104 C 56 100 62 99 68 100 C 74 101 80 101 86 99 C 92 97 98 97 104 100 L102 108 C 96 104 90 104 84 106 C 78 108 72 108 66 106 C 60 104 54 105 52 110 Z" fill="#26305c" opacity={0.55} />
        <ellipse cx={80} cy={96} rx={34} ry={9} fill="none" stroke="#b8c2ff" strokeWidth={1.4} opacity={0.5} />
        <path d="M114 100 C 128 98 138 108 138 118 C 138 128 128 132 116 132 L114 132 Z" fill="none" stroke={`url(#${u}-cup)`} strokeWidth={8} />
        <path d="M114 100 C 128 98 138 108 138 118 C 138 128 128 132 116 132 L114 132 Z" fill="none" stroke="#ffffff" strokeWidth={2.4} opacity={0.25} />
        <path d="M80 86 C 82 88 84 90 84 92" fill="none" stroke="#3a1d0d" strokeWidth={2} strokeLinecap="round" />
      </g>
      <g className={animate ? 'giftfx-steam' : ''} fill="#ffffff" opacity={0.75}>
        <path d="M64 70 C 60 62 68 58 64 50 C 60 42 66 34 63 27" stroke="#bfe9ff" strokeWidth={3} fill="none" strokeLinecap="round" style={{ ['--sd' as string]: '2.6s', ['--sx' as string]: '-4px' } as CSSProperties} />
        <path d="M82 72 C 78 64 88 58 82 50 C 76 42 86 34 81 27" stroke="#dfeeff" strokeWidth={3} fill="none" strokeLinecap="round" style={{ ['--sd' as string]: '3s', ['--sdl' as string]: '0.6s', ['--sx' as string]: '5px' } as CSSProperties} />
        <path d="M98 70 C 95 63 102 58 97 51 C 92 44 98 38 95 31" stroke="#bfe9ff" strokeWidth={2.6} fill="none" strokeLinecap="round" style={{ ['--sd' as string]: '2.8s', ['--sdl' as string]: '1.1s', ['--sx' as string]: '3px' } as CSSProperties} />
      </g>
      <GroundShadow u={u} cy={140} w={42} opacity={0.4} />
      <Sparkle x={40} y={46} size={5} color="#ffd166" className={animate ? 'giftfx-sparkle' : ''} />
    </g>
  );
}

/* 6 — Balloon: glossy colorful balloons with VANTA highlights, float upward. */
function BalloonArt({ u, animate }: ArtContext) {
  const colors = ['#f7435e', '#3ecbff', '#c04bff'];
  const xs = [64, 94, 118];
  const cy = [58, 44, 68];
  const r = [26, 22, 17];
  return (
    <g>
      <defs>
        <radialGradient id={`${u}-shadow`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#000000" stopOpacity="0.5" />
          <stop offset="1" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>
      {colors.map((c, i) => (
        <g key={i} className={animate ? 'giftfx-float-up' : ''} style={{ ['--gy' as string]: `${-26 - i * 14}px`, ['--gd' as string]: `${2.4 + i * 0.5}s`, ['--gdl' as string]: `${i * 0.35}s` } as CSSProperties}>
          <path d={`M${xs[i]} ${cy[i] + r[i]} C ${xs[i] - r[i] - 4} ${cy[i] - r[i]} ${xs[i] - r[i] + 4} ${cy[i] - r[i]} ${xs[i]} ${cy[i] - r[i]} C ${xs[i] + r[i] - 4} ${cy[i] - r[i]} ${xs[i] + r[i] + 4} ${cy[i] - r[i]} ${xs[i]} ${cy[i] + r[i]} L ${xs[i]} ${cy[i] + r[i] + 6} Z`} fill={c} opacity={0.96} stroke="#ffffff" strokeWidth={1.2} strokeOpacity={0.3} />
          <path d={`M${xs[i] - 8} ${cy[i] - r[i] * 0.55} C ${xs[i] - 3} ${cy[i] - r[i] * 0.8} ${xs[i] + 3} ${cy[i] - r[i] * 0.8} ${xs[i] + 8} ${cy[i] - r[i] * 0.55}`} fill="none" stroke="#ffffff" strokeWidth={3} strokeLinecap="round" opacity={0.55} />
          <path className={animate ? 'giftfx-sway' : ''} d={`M${xs[i]} ${cy[i] + r[i] + 6} C ${xs[i] - 2} ${cy[i] + r[i] + 22} ${xs[i] + 2} ${cy[i] + r[i] + 34} ${xs[i]} ${cy[i] + r[i] + 46}`} fill="none" stroke="#9fb0d8" strokeWidth={1.6} />
        </g>
      ))}
      <GroundShadow u={u} cy={140} w={46} opacity={0.3} />
    </g>
  );
}
}
      className={className}
      style={style}
      opacity={opacity}
      d={`M${x} ${y - h} C ${x + w} ${y - h * 0.3} ${x + w} ${y + h * 0.3} ${x} ${y + h} C ${x - w} ${y + h * 0.3} ${x - w} ${y - h * 0.3} ${x} ${y - h} Z`}
      fill={color}
    />
  );
}

function Confetti({ x, y, color, className = '', style }: { x: number; y: number; color: string; className?: string; style?: CSSProperties }) {
  return (
    <rect x={x - 3} y={y - 4} width={6} height={8} rx={1.4} fill={color} className={className} style={style} />
  );
}
/* 7 — Love: two glowing hearts fly together, merge, pulse. */
function LoveArt({ u, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <linearGradient id={`${u}-l1`} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#ff8fb8" />
          <stop offset="0.5" stopColor="#ff3d9a" />
          <stop offset="1" stopColor="#a8136b" />
        </linearGradient>
        <linearGradient id={`${u}-l2`} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#9df0ff" />
          <stop offset="0.5" stopColor="#3ecbff" />
          <stop offset="1" stopColor="#168eff" />
        </linearGradient>
        <radialGradient id={`${u}-shadow`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#000000" stopOpacity="0.5" />
          <stop offset="1" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Glow u={u} cx={80} cy={74} r={74} color="#ff3d9a" opacity={0.42} />
      <circle className={animate ? 'giftfx-pulse-ring' : ''} cx={80} cy={74} r={62} fill="none" stroke="#ff9abf" strokeWidth={1.6} strokeDasharray="3 7" opacity={0.8} style={{ ['--pr' as string]: '2.8s' } as CSSProperties} />
      <g className={animate ? 'giftfx-love-merge' : ''}>
        <path
          d="M52 118 C 18 96 14 66 33 55 C 43 49 52 54 55 62 C 58 52 68 48 79 54 C 92 62 94 98 52 118 Z"
          fill={`url(#${u}-l1)`}
          stroke="#7e0a51"
          strokeWidth={2}
        />
        <path
          d="M108 118 C 74 96 70 66 89 55 C 99 49 108 54 111 62 C 114 52 124 48 135 54 C 148 62 150 98 108 118 Z"
          fill={`url(#${u}-l2)`}
          stroke="#0b4f9a"
          strokeWidth={2}
        />
      </g>
      <path d="M52 118 C 18 96 14 66 33 55 C 43 49 52 54 55 62 C 58 52 68 48 79 54 C 84 57 86 63 84 68 C 74 80 62 96 52 118 Z" fill="#ffffff" opacity={0.4} />
      <path d="M108 118 C 74 96 70 66 89 55 C 99 49 108 54 111 62 C 114 52 124 48 135 54 C 139 57 141 63 139 68 C 129 80 117 96 108 118 Z" fill="#ffffff" opacity={0.35} />
      <GroundShadow u={u} cy={140} w={48} opacity={0.4} />
      <g className={animate ? 'giftfx-heart-float' : ''} opacity={animate ? undefined : 0.9}>
        <MiniHeart x={36} y={52} scale={3} color="#ff8fb8" />
        <MiniHeart x={124} y={44} scale={2.6} color="#7fe3ff" />
        <MiniHeart x={138} y={110} scale={2} color="#ffd1f1" />
      </g>
    </g>
  );
}

/* 8 — Teddy Bear: cute but premium plush teddy, glossy eyes, hugs a heart. */
function TeddyArt({ u, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <linearGradient id={`${u}-fur`} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#f5c88e" />
          <stop offset="0.55" stopColor="#c67e44" />
          <stop offset="1" stopColor="#8a5129" />
        </linearGradient>
        <radialGradient id={`${u}-eye`} cx="0.4" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.35" stopColor="#a35a2b" />
          <stop offset="1" stopColor="#45200e" />
        </radialGradient>
        <radialGradient id={`${u}-shadow`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#000000" stopOpacity="0.5" />
          <stop offset="1" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Glow u={u} cx={80} cy={76} r={66} color="#d99a5b" opacity={0.4} />
      <g className={animate ? 'giftfx-pop-soft' : ''}>
        <circle cx={48} cy={46} r={19} fill={`url(#${u}-fur)`} stroke="#8a5129" strokeWidth={1.4} />
        <circle cx={112} cy={46} r={19} fill={`url(#${u}-fur)`} stroke="#8a5129" strokeWidth={1.4} />
        <circle cx={38} cy={38} r={6} fill="#f5e3c5" opacity={0.9} />
        <circle cx={104} cy={38} r={6} fill="#f5e3c5" opacity={0.9} />
        <circle cx={80} cy={82} r={48} fill={`url(#${u}-fur)`} stroke="#8a5129" strokeWidth={1.6} />
        <circle cx={63} cy={74} r={5.5} fill={`url(#${u}-eye)`} />
        <circle cx={97} cy={74} r={5.5} fill={`url(#${u}-eye)`} />
        <circle cx={65} cy={72.5} r={1.8} fill="#ffffff" />
        <circle cx={99} cy={72.5} r={1.8} fill="#ffffff" />
        <path d="M72 88 Q 80 80 88 88" fill="none" stroke="#45200e" strokeWidth={2.6} strokeLinecap="round" />
        <ellipse cx={80} cy={96} rx={20} ry={14} fill="#f5e3c5" stroke="#b96a36" strokeWidth={1.4} />
        <path d="M72 96 Q 80 88 85 93 Q 82 100 72 96 Z" fill="#45200e" opacity={0.75} />
        <path d="M34 96 Q 34 112 52 118" fill="none" stroke={`url(#${u}-fur)`} strokeWidth={13} strokeLinecap="round" />
        <path d="M126 96 Q 126 112 108 118" fill="none" stroke={`url(#${u}-fur)`} strokeWidth={13} strokeLinecap="round" />
        <g className={animate ? 'giftfx-beat' : ''}>
          <path d="M80 112 C 75 107 68 110 68 114 C 68 118 75 122 80 122 C 85 122 92 118 92 114 C 92 110 85 107 80 112 Z" fill="#ff3d66" stroke="#7e0a27" strokeWidth={1.4} />
        </g>
      </g>
      <GroundShadow u={u} cy={140} w={44} opacity={0.4} />
    </g>
  );
}
/* 9 — Happy Day: bright celebration badge surrounded by confetti. */
function HappyDayArt({ u, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <linearGradient id={`${u}-badge`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff27a" />
          <stop offset="0.5" stopColor="#ffb02e" />
          <stop offset="1" stopColor="#ff7a1a" />
        </linearGradient>
        <radialGradient id={`${u}-shadow`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#000000" stopOpacity="0.5" />
          <stop offset="1" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Glow u={u} cx={80} cy={70} r={70} color="#ffb02e" opacity={0.5} />
      <g className={animate ? 'giftfx-spin-slow-fx' : ''}>
        <path d="M80 14 L96 50 L134 44 L112 76 L146 104 L106 118 L112 150 L80 124 L48 150 L54 118 L14 104 L48 76 L26 44 L64 50 Z" fill={`url(#${u}-badge)`} stroke="#ffffff" strokeWidth={2} strokeOpacity={0.6} />
        <circle cx={80} cy={78} r={30} fill="#ffffff" opacity={0.92} />
        <path d="M60 74 A 20 20 0 0 1 100 74" fill="none" stroke={`url(#${u}-badge)`} strokeWidth={4.5} strokeLinecap="round" />
        <circle cx={80} cy={84} r={2.4} fill="#ff7a1a" />
      </g>
      <GroundShadow u={u} cy={140} w={40} opacity={0.3} />
      <g className={animate ? 'giftfx-confetti' : ''}>
        <Confetti x={34} y={38} color="#ff4d84" style={{ ['--sx' as string]: '-18px', ['--sy' as string]: '40px', ['--rot' as string]: '240deg', ['--cd' as string]: '2.2s' } as CSSProperties} />
        <Confetti x={128} y={34} color="#65f4ff" style={{ ['--sx' as string]: '14px', ['--sy' as string]: '44px', ['--rot' as string]: '-220deg', ['--cd' as string]: '2.5s', ['--cdl' as string]: '0.3s' } as CSSProperties} />
        <Confetti x={140} y={96} color="#ffd166" style={{ ['--sx' as string]: '-12px', ['--sy' as string]: '38px', ['--rot' as string]: '180deg', ['--cd' as string]: '2.8s', ['--cdl' as string]: '0.7s' } as CSSProperties} />
        <Confetti x={22} y={104} color="#b388ff" style={{ ['--sx' as string]: '10px', ['--sy' as string]: '34px', ['--rot' as string]: '-160deg', ['--cd' as string]: '2.4s', ['--cdl' as string]: '0.5s' } as CSSProperties} />
        <Confetti x={46} y={120} color="#65f4ff" style={{ ['--sx' as string]: '22px', ['--sy' as string]: '-16px', ['--rot' as string]: '120deg', ['--cd' as string]: '2.2s', ['--cdl' as string]: '0.2s' } as CSSProperties} />
      </g>
    </g>
  );
}

/* 10 — Cake: elegant layered birthday cake with glowing candles. */
function CakeArt({ u, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <linearGradient id={`${u}-frosting`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff1ff" />
          <stop offset="1" stopColor="#d8c2e8" />
        </linearGradient>
        <radialGradient id={`${u}-shadow`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#000000" stopOpacity="0.5" />
          <stop offset="1" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Glow u={u} cx={80} cy={78} r={70} color="#ff8fb8" opacity={0.42} />
      <g className={animate ? 'giftfx-rise' : ''}>
        <path d="M38 96 L122 96 L117 122 L43 122 Z" fill="#5ad7ff" stroke="#168ef0" strokeWidth={1.6} />
        <path d="M38 96 L122 96 L120 104 L40 104 Z" fill="#bdf2ff" opacity={0.7} />
        <path d="M32 122 L128 122 L123 146 L37 146 Z" fill="#ff8fb8" stroke="#e0467e" strokeWidth={1.6} />
        <path d="M32 122 L128 122 L126 130 L34 130 Z" fill="#ffd1e4" opacity={0.7} />
        <ellipse cx={80} cy={92} rx={44} ry={8} fill={`url(#${u}-frosting)`} stroke="#c9a7d8" strokeWidth={1.4} />
        <circle cx={60} cy={92} r={5} fill="#ff4d84" />
        <circle cx={80} cy={92} r={5} fill="#3ecbff" />
        <circle cx={100} cy={92} r={5} fill="#ffd166" />
        <g className={animate ? 'giftfx-flicker' : ''}>
          <rect x={58} y={60} width={4} height={30} rx={2} fill="#ffd1e4" />
          <rect x={76} y={60} width={4} height={30} rx={2} fill="#ffd1e4" />
          <rect x={94} y={60} width={4} height={30} rx={2} fill="#ffd1e4" />
        </g>
        <g className={animate ? 'giftfx-flicker-fast' : ''}>
          <path d="M60 62 C 54 54 62 44 60 36 C 68 44 66 54 60 62 Z" fill="#ffd166" />
          <path d="M78 62 C 72 54 80 44 78 36 C 86 44 84 54 78 62 Z" fill="#fff27a" />
          <path d="M96 62 C 90 54 98 44 96 36 C 104 44 102 54 96 62 Z" fill="#ffb02e" />
        </g>
      </g>
      <GroundShadow u={u} cy={146} w={48} opacity={0.4} />
      <g className={animate ? 'giftfx-confetti' : ''} opacity={animate ? undefined : 0.8}>
        <Confetti x={30} y={40} color="#ff4d84" style={{ ['--sx' as string]: '-14px', ['--sy' as string]: '30px', ['--rot' as string]: '200deg', ['--cd' as string]: '2.4s' } as CSSProperties} />
        <Confetti x={126} y={36} color="#65f4ff" style={{ ['--sx' as string]: '12px', ['--sy' as string]: '34px', ['--rot' as string]: '170deg', ['--cd' as string]: '2.7s', ['--cdl' as string]: '0.4s' } as CSSProperties} />
        <Confetti x={140} y={80} color="#ffd166" style={{ ['--sx' as string]: '-16px', ['--sy' as string]: '28px', ['--rot' as string]: '-140deg', ['--cd' as string]: '3s', ['--cdl' as string]: '0.8s' } as CSSProperties} />
      </g>
    </g>
  );
}
/* ------------------------------------------------------------------ */
/* LUXURY / STATUS                                                     */
/* ------------------------------------------------------------------ */

/* 11 — Fancy Pearl: luxury shell with a luminous pearl; opens, pearl rises. */
function FancyPearlArt({ u, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <linearGradient id={`${u}-shell`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe6f5" />
          <stop offset="0.6" stopColor="#d6a8e0" />
          <stop offset="1" stopColor="#8a5bb0" />
        </linearGradient>
        <radialGradient id={`${u}-pearl`} cx="0.35" cy="0.3" r="0.75">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#dff4ff" />
          <stop offset="1" stopColor="#9ddfff" />
        </radialGradient>
        <radialGradient id={`${u}-shadow`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#000000" stopOpacity="0.5" />
          <stop offset="1" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Glow u={u} cx={80} cy={76} r={66} color="#9ddfff" opacity={0.5} />
      <circle className={animate ? 'giftfx-pulse-ring' : ''} cx={80} cy={70} r={50} fill="none" stroke="#ffffff" strokeWidth={1.4} opacity={0.55} style={{ ['--pr' as string]: '3.2s' } as CSSProperties} />
      <g className={animate ? 'giftfx-shell-open' : ''}>
        <path d="M40 118 C 34 82 46 56 80 46 C 114 56 126 82 120 118 C 104 108 56 108 40 118 Z" fill={`url(#${u}-shell)`} stroke="#7a4a9e" strokeWidth={2} />
        <path d="M46 112 C 60 96 100 96 114 112 C 96 120 64 120 46 112 Z" fill="#f4e0ff" opacity={0.7} />
        <path d="M80 52 C 76 70 76 82 80 96 C 84 82 84 70 80 52 Z" fill="#ffffff" opacity={0.5} />
        <g className={animate ? 'giftfx-rise' : ''}>
          <circle cx={80} cy={78} r={17} fill={`url(#${u}-pearl)`} stroke="#9ddfff" strokeWidth={1} />
          <path d="M70 70 C 73 65 79 64 84 67" fill="none" stroke="#ffffff" strokeWidth={3} strokeLinecap="round" opacity={0.9} />
        </g>
      </g>
      <GroundShadow u={u} cy={140} w={44} opacity={0.4} />
      <g className={animate ? 'giftfx-sparkle' : ''}>
        <Sparkle x={42} y={46} size={6} color="#ffffff" />
        <Sparkle x={120} y={52} size={5} color="#9ddfff" />
        <Sparkle x={128} y={104} size={4} color="#ffffff" />
      </g>
    </g>
  );
}

/* 12 — Diamond: large faceted blue-white diamond, rotates, brilliant flash. */
function DiamondArt({ u, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <linearGradient id={`${u}-dst`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.45" stopColor="#bfeaff" />
          <stop offset="1" stopColor="#3f83ff" />
        </linearGradient>
        <radialGradient id={`${u}-shadow`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#000000" stopOpacity="0.5" />
          <stop offset="1" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Glow u={u} cx={80} cy={76} r={74} color="#69d9ff" opacity={0.55} />
      <circle className={animate ? 'giftfx-pulse-ring' : ''} cx={80} cy={76} r={56} fill="none" stroke="#bfeaff" strokeWidth={1.4} opacity={0.5} style={{ ['--pr' as string]: '2.6s' } as CSSProperties} />
      <g className={animate ? 'giftfx-spin-fx' : ''}>
        <path d="M80 14 L118 62 L104 134 L80 146 L56 134 L42 62 Z" fill={`url(#${u}-dst)`} stroke="#a8dbff" strokeWidth={2.4} />
        <path d="M80 14 L80 146 L56 134 L42 62 Z" fill="#7fb6ff" opacity={0.55} />
        <path d="M42 62 L118 62 L80 146 Z" fill="#ffffff" opacity={0.5} />
        <path d="M80 14 L104 62 L80 74 L56 62 Z" fill="#ffffff" opacity={0.65} />
        <path d="M80 78 L104 62 L118 62 Z" fill="#e8f6ff" opacity={0.9} />
        <path d="M80 78 L56 62 L42 62 Z" fill="#9dc9ff" opacity={0.7} />
      </g>
      <GroundShadow u={u} cy={146} w={42} opacity={0.3} />
      <g className={animate ? 'giftfx-sparkle' : ''}>
        <Sparkle x={36} y={44} size={8} color="#ffffff" />
        <Sparkle x={126} y={40} size={6} color="#bfeaff" />
        <Sparkle x={130} y={110} size={5} color="#ffffff" />
      </g>
    </g>
  );
}
/* 13 — 1st Place: gold championship medal with number 1, victory burst. */
function FirstPlaceArt({ u, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <linearGradient id={`${u}-gold`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff5a8" />
          <stop offset="0.55" stopColor="#f2c53d" />
          <stop offset="1" stopColor="#d99a1b" />
        </linearGradient>
        <radialGradient id={`${u}-shadow`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#000000" stopOpacity="0.5" />
          <stop offset="1" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Glow u={u} cx={80} cy={84} r={70} color="#f2c53d" opacity={0.5} />
      <g className={animate ? 'giftfx-drop-bounce' : ''}>
        <path d="M66 30 L94 30 L90 52 L70 52 Z" fill="#ff5c7e" stroke="#c72a58" strokeWidth={1.4} />
        <circle cx={66} cy={32} r={8} fill="#ffd166" stroke="#d99a1b" strokeWidth={1.2} />
        <circle cx={94} cy={32} r={8} fill="#ffd166" stroke="#d99a1b" strokeWidth={1.2} />
        <circle cx={80} cy={96} r={40} fill={`url(#${u}-gold)`} stroke="#b87a0d" strokeWidth={2.4} />
        <circle cx={80} cy={96} r={31} fill="none" stroke="#fff5a8" strokeWidth={2} opacity={0.8} strokeDasharray="4 6" />
        <path d="M80 74 C 78 84 82 88 88 90 C 96 96 94 104 86 106 C 82 108 82 110 84 114 L 76 110 C 70 106 66 98 72 92 C 68 88 72 86 80 74 Z" fill="#8a4b08" opacity={0.85} />
        <text x={80} y={110} textAnchor="middle" fontSize={44} fontWeight={900} fill="#fffbe0" stroke="#b87a0d" strokeWidth={2}>1</text>
      </g>
      <GroundShadow u={u} cy={140} w={44} opacity={0.4} />
      <g className={animate ? 'giftfx-burst' : ''}>
        <circle cx={80} cy={96} r={56} fill="none" stroke="#ffe37a" strokeWidth={1.4} strokeDasharray="2 8" opacity={0.8} />
      </g>
    </g>
  );
}

/* 14 — Crown: royal metallic crown with blue gemstones, royal aura. */
function CrownArt({ u, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <linearGradient id={`${u}-crm`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff8d9" />
          <stop offset="0.5" stopColor="#f2c53d" />
          <stop offset="1" stopColor="#c8911e" />
        </linearGradient>
        <radialGradient id={`${u}-shadow`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#000000" stopOpacity="0.5" />
          <stop offset="1" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Glow u={u} cx={80} cy={72} r={74} color="#c8911e" opacity={0.5} />
      <RadialAura u={u} c="#f2c53d" r={64} animate={animate} />
      <g className={animate ? 'giftfx-descend' : ''}>
        <path d="M26 52 L40 94 L120 94 L134 52 L108 74 L80 38 L52 74 Z" fill={`url(#${u}-crm)`} stroke="#9a6c08" strokeWidth={2.2} />
        <path d="M40 94 L120 94 L116 112 L44 112 Z" fill="#fff8d9" stroke="#9a6c08" strokeWidth={1.6} />
        <circle cx={80} cy={66} r={9} fill="#3ecbff" stroke="#168ef0" strokeWidth={2} className={animate ? 'giftfx-twinkle' : ''} />
        <circle cx={52} cy={78} r={6} fill="#ff4d84" stroke="#c72a58" strokeWidth={1.6} className={animate ? 'giftfx-twinkle' : ''} style={{ ['--tw' as string]: '2.4s' } as CSSProperties} />
        <circle cx={108} cy={78} r={6} fill="#ff4d84" stroke="#c72a58" strokeWidth={1.6} className={animate ? 'giftfx-twinkle' : ''} style={{ ['--tw' as string]: '2.8s' } as CSSProperties} />
        <path d="M80 38 L84 44 L80 50 L76 44 Z" fill="#ffffff" opacity={0.9} />
      </g>
      <GroundShadow u={u} cy={140} w={46} opacity={0.4} />
    </g>
  );
}

/* Shared radial aura rings used by several royal/legendary gifts. */
function RadialAura({ u, c, r = 60, animate = true, dash = '2 9' }: { u: string; c: string; r?: number; animate?: boolean; dash?: string }) {
  return (
    <g className={animate ? 'giftfx-aura' : ''}>
      <circle cx={80} cy={80} r={r} fill="none" stroke={c} strokeWidth={1.6} strokeDasharray={dash} opacity={0.6} />
      <circle cx={80} cy={80} r={r - 10} fill="none" stroke={c} strokeWidth={1} opacity={0.35} />
    </g>
  );
}
