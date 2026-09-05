'use client';

/**
 * GiftArtworkSvgs
 * -----------------------------------------------------------------------------
 * The complete VANTA gift artwork library - one hand-crafted, premium SVG
 * illustration per gift style. Every gift has a DISTINCT, recognizable
 * silhouette (heart, thumbs-up, flame, rose, coffee, balloon, teddy, ...) with
 * glossy gradients, specular highlights, soft glows, ground shadows and
 * particle accents. Unknown gifts fail safe to a wrapped present - never a
 * random geometric shape. Pure inline SVG: zero network assets, no WebGL.
 */

import { type CSSProperties } from 'react';

export type GiftArtworkId =
  | 'heart' | 'love' | 'thumb' | 'flame' | 'rose' | 'coffee' | 'balloon' | 'teddy'
  | 'happy' | 'pearl' | 'medal' | 'diamond' | 'crown' | 'car' | 'jet' | 'yacht'
  | 'dragon' | 'castle' | 'star' | 'comet' | 'orb' | 'ring' | 'capsule' | 'spark'
  | 'sun' | 'giftbox';

export type ArtContext = { u: string; animate: boolean };

const hasAny = (value: string, keys: string[]) => keys.some(k => value.includes(k));

export function resolveGiftArtworkId(slug = '', artworkType = ''): GiftArtworkId {
  const s = (slug || '').trim().toLowerCase();
  const t = (artworkType || '').trim().toLowerCase();
  const has = (...keys: string[]) => hasAny(s, keys) || hasAny(t, keys);
  if (has('coffee', 'latte', 'brew', 'espresso', 'mocha')) return 'coffee';
  if (has('balloon')) return 'balloon';
  if (has('thumb')) return 'thumb';
  if (has('fire', 'flame', 'ember', 'phoenix', 'cinder', 'flare')) return 'flame';
  if (has('rose', 'bloom', 'petal')) return 'rose';
  if (has('teddy', 'bear')) return 'teddy';
  if (has('yacht', 'boat', 'sail')) return 'yacht';
  if (has('dragon', 'wyvern')) return 'dragon';
  if (has('castle', 'fortress', 'citadel')) return 'castle';
  if (has('love', 'valentine')) return 'love';
  if (has('heart', 'kiss', 'embrace')) return 'heart';
  if (has('comet', 'meteor')) return 'comet';
  if (has('star')) return 'star';
  if (has('pearl', 'shell', 'relic')) return 'pearl';
  if (has('medal', 'champion', 'league', 'ribbon', 'medallion', 'badge', 'place', 'victory')) return 'medal';
  if (has('diamond', 'prism', 'glacier', 'gem', 'crystal', 'shard')) return 'diamond';
  if (has('crown', 'royalty', 'crest', 'scepter', 'throne')) return 'crown';
  if (has('car', 'ride', 'roadster', 'coupe', 'velocity', 'auto', 'racer')) return 'car';
  if (has('jet', 'flight', 'cloud', 'wings', 'elite', 'pilot')) return 'jet';
  if (has('happy', 'cake', 'party', 'confetti', 'celebration')) return 'happy';
  if (has('spark', 'bolt', 'energy', 'lightning')) return 'spark';
  if (has('capsule', 'pod')) return 'capsule';
  if (has('ring')) return 'ring';
  if (has('orb', 'sphere')) return 'orb';
  if (has('sun', 'sunset', 'dawn', 'horizon', 'golden')) return 'sun';
  return 'giftbox';
}

function Glow({ u, cx = 80, cy = 76, r = 62, color, opacity = 0.5 }: { u: string; cx?: number; cy?: number; r?: number; color: string; opacity?: number }) {
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

function GroundShadow({ u, cx = 80, cy = 142, w = 44, opacity = 0.42 }: { u: string; cx?: number; cy?: number; w?: number; opacity?: number }) {
  return <ellipse cx={cx} cy={cy} rx={w} ry={w * 0.2} fill={`url(#${u}-shadow)`} opacity={opacity} />;
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
  const d = `M${x} ${y + c * 3.2} C ${x - c * 5.6} ${y - c * 1.4} ${x - c * 2.6} ${y - c * 3} ${x} ${y - c * 0.4} C ${x + c * 2.6} ${y - c * 3} ${x + c * 5.6} ${y - c * 1.4} ${x} ${y + c * 3.2} Z`;
  return <path className={className} style={style} opacity={opacity} fill={color} d={d} />;
}

function Petal({ x, y, w = 9, h = 16, color = '#ffb2cf', className = '', style, opacity }: { x: number; y: number; w?: number; h?: number; color?: string; className?: string; style?: CSSProperties; opacity?: number }) {
  const d = `M${x} ${y - h} C ${x + w} ${y - h * 0.3} ${x + w} ${y + h * 0.3} ${x} ${y + h} C ${x - w} ${y + h * 0.3} ${x - w} ${y - h * 0.3} ${x} ${y - h} Z`;
  return <path className={className} style={style} opacity={opacity} fill={color} d={d} />;
}

function Confetti({ x, y, color, className = '', style }: { x: number; y: number; color: string; className?: string; style?: CSSProperties }) {
  return <rect x={x - 3} y={y - 4} width={6} height={8} rx={1.4} fill={color} className={className} style={style} />;
}

function RadialAura({ u, c, r = 62, animate = false, dash = '2 9' }: { u: string; c: string; r?: number; animate?: boolean; dash?: string }) {
  return (
    <g className={animate ? 'giftfx-aura' : ''}>
      <circle cx={80} cy={80} r={r} fill="none" stroke={c} strokeWidth={1.6} strokeDasharray={dash} opacity={0.6} />
      <circle cx={80} cy={80} r={r - 10} fill="none" stroke={c} strokeWidth={1} opacity={0.35} />
    </g>
  );
}
/* HEART - glossy red/pink 3D heart with highlight, soft pink glow, tiny hearts, pulse ring. */
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
      <circle className={animate ? 'giftfx-ring' : ''} cx={80} cy={70} r={56} fill="none" stroke="#ff9abf" strokeWidth={1.6} strokeDasharray="4 8" opacity={0.7} style={{ ['--rd' as string]: '2.6s' } as CSSProperties} />
      <g className={animate ? 'giftfx-beat' : ''}>
        <path d="M80 133 C 28 101 22 62 46 48 C 58 41 68 47 72 56 C 75 47 87 40 101 45 C 122 56 128 99 80 133 Z" fill={`url(#${u}-hf)`} stroke="#7e0a27" strokeWidth={2} />
        <path d="M80 133 C 28 101 22 62 46 48 C 58 41 68 47 72 56 C 75 47 87 40 101 45 C 88 60 76 92 80 133 Z" fill="#ff8fa8" opacity={0.35} />
        <path d="M80 133 C 28 101 22 62 46 48 C 58 41 68 47 72 56 C 75 47 87 40 101 45 C 88 60 76 92 80 133 Z" fill={`url(#${u}-hs)`} />
        <path d="M47 49 C 55 41 65 42 69 50 C 61 50 53 53 47 49 Z" fill="#ffffff" opacity={0.95} />
        <circle cx={57} cy={54} r={3.4} fill="#ffffff" />
        <path d="M103 50 C 111 55 113 62 111 69" fill="none" stroke="#ffffff" strokeWidth={2.6} strokeLinecap="round" opacity={0.4} />
      </g>
      <GroundShadow u={u} cy={140} w={36} />
      <g className={animate ? 'giftfx-heart-float' : ''} opacity={animate ? undefined : 0.9}>
        <MiniHeart x={26} y={50} scale={3.2} color="#ff6b8f" />
        <MiniHeart x={128} y={36} scale={2.4} color="#ff9abf" />
        <MiniHeart x={136} y={104} scale={1.9} color="#ffd1db" />
        <MiniHeart x={18} y={110} scale={2.1} color="#ff6b8f" opacity={0.7} />
      </g>
    </g>
  );
}
/* LOVE - elegant twin glowing hearts (pink + blue) merging with aura and many small hearts. */
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
      <Glow u={u} cx={80} cy={74} r={74} color="#ff3d9a" opacity={0.45} />
      <RadialAura u={u} c="#ff9abf" r={64} animate={animate} />
      <g className={animate ? 'giftfx-love-merge' : ''}>
        <path d="M52 118 C 18 96 14 66 33 55 C 43 49 52 54 55 62 C 58 52 68 48 79 54 C 92 62 94 98 52 118 Z" fill={`url(#${u}-l1)`} stroke="#7e0a51" strokeWidth={2} />
        <path d="M108 118 C 74 96 70 66 89 55 C 99 49 108 54 111 62 C 114 52 124 48 135 54 C 148 62 150 98 108 118 Z" fill={`url(#${u}-l2)`} stroke="#0b4f9a" strokeWidth={2} />
      </g>
      <path d="M52 118 C 18 96 14 66 33 55 C 43 49 52 54 55 62 C 58 52 68 48 79 54 C 84 57 86 63 84 68 C 74 80 62 96 52 118 Z" fill="#ffffff" opacity={0.4} />
      <path d="M108 118 C 74 96 70 66 89 55 C 99 49 108 54 111 62 C 114 52 124 48 135 54 C 139 57 141 63 139 68 C 129 80 117 96 108 118 Z" fill="#ffffff" opacity={0.35} />
      <GroundShadow u={u} cy={140} w={48} opacity={0.4} />
      <g className={animate ? 'giftfx-heart-float' : ''} opacity={animate ? undefined : 0.9}>
        <MiniHeart x={32} y={48} scale={3.1} color="#ff8fb8" />
        <MiniHeart x={124} y={40} scale={2.6} color="#7fe3ff" />
        <MiniHeart x={140} y={108} scale={2} color="#ffd1f1" />
        <MiniHeart x={16} y={92} scale={1.8} color="#ff8fb8" opacity={0.8} />
      </g>
    </g>
  );
}

/* THUMBS UP - real hand + blue sleeve, glossy fingers, glow and floating sparkles. */
function ThumbArt({ u, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <linearGradient id={`${u}-skin`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe0c2" />
          <stop offset="0.5" stopColor="#f5b184" />
          <stop offset="1" stopColor="#ca7c4b" />
        </linearGradient>
        <linearGradient id={`${u}-sleeve`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5d9bff" />
          <stop offset="1" stopColor="#1d46c9" />
        </linearGradient>
        <radialGradient id={`${u}-shadow`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#000000" stopOpacity="0.5" />
          <stop offset="1" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Glow u={u} cx={80} cy={82} r={60} color="#3eceff" opacity={0.4} />
      <path d="M40 116 L40 128 Q40 140 54 140 L106 140 Q120 140 120 128 L120 116 Q120 108 112 106 L92 106 L92 118 L68 118 L68 106 L48 106 Q40 108 40 116 Z" fill={`url(#${u}-sleeve)`} stroke="#12307d" strokeWidth={1.5} />
      <path d="M48 106 L112 106" stroke="#ffffff" strokeWidth={2.5} strokeLinecap="round" opacity={0.5} />
      <path d="M92 106 L92 118 L100 124" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" opacity={0.25} />
      <path d="M62 96 C 62 78 98 78 98 96 L98 106 L62 106 Z" fill={`url(#${u}-skin)`} stroke="#a8623a" strokeWidth={1.5} />
      <path d="M66 88 Q74 82 82 88" fill="none" stroke="#a8623a" strokeWidth={2} strokeLinecap="round" opacity={0.8} />
      <path d="M80 88 Q89 82 97 90" fill="none" stroke="#a8623a" strokeWidth={2} strokeLinecap="round" opacity={0.8} />
      <path d="M70 94 L90 94" fill="none" stroke="#e9a87c" strokeWidth={1.6} strokeLinecap="round" opacity={0.7} />
      <g transform="rotate(-36 104 74)">
        <path d="M92 40 Q112 40 114 58 L114 96 Q114 108 106 108 L90 108 C 86 108 86 104 88 100 L90 62 Q92 40 92 40 Z" fill={`url(#${u}-skin)`} stroke="#a8623a" strokeWidth={1.5} />
        <path d="M98 44 Q108 46 110 58 L110 96 Q110 102 106 102 L96 102 L97 60 Q98 44 98 44 Z" fill="#ffe7cd" opacity={0.9} />
        <ellipse cx={104} cy={50} rx={8} ry={3.5} transform="rotate(-24 104 50)" fill="#f0a878" />
      </g>
      <circle cx={40} cy={52} r={2.6} fill="#a4f3ff" className={animate ? 'giftfx-float-up' : ''} style={{ ['--gx' as string]: '-6px', ['--gy' as string]: '-20px', ['--gd' as string]: '2s' } as CSSProperties} />
      <circle cx={128} cy={58} r={3} fill="#c9adff" className={animate ? 'giftfx-float-up' : ''} style={{ ['--gx' as string]: '8px', ['--gy' as string]: '-26px', ['--gd' as string]: '2.4s', ['--gdl' as string]: '0.3s' } as CSSProperties} />
      <circle cx={120} cy={118} r={2.4} fill="#8ef5ff" className={animate ? 'giftfx-float-up' : ''} style={{ ['--gx' as string]: '-8px', ['--gy' as string]: '-22px', ['--gd' as string]: '1.8s', ['--gdl' as string]: '0.6s' } as CSSProperties} />
      <GroundShadow u={u} cy={140} w={38} />
    </g>
  );
}