'use client';

/**
 * GiftArtworkSvgs — The VANTA Premium Gift Artwork Library
 * -----------------------------------------------------------------------------
 * One art-directed, hand-crafted premium SVG scene per gift style. Every gift
 * in the VANTA collection renders through here (grids, pickers, history and
 * the "normal" tier of the realtime overlay). Scenes share ONE cinematic
 * VANTA stage — a dark premium presentation with a soft light pool, controlled
 * bloom, ground shadow, floor reflection, aura, particles and light rays — so
 * the whole catalog reads as a single art-directed universe.
 *
 * Visual language: deep black/violet stage, metallic + crystal materials,
 * gold/chrome accents, volumetric gradients (light→mid→deep), specular
 * highlights, cinematic rim light, controlled particles and glass-clean
 * silhouettes.
 *
 * `quality` (0-5) is derived from the EXISTING gift price + rarity + impact
 * (see giftVisualQuality in @/lib/giftCatalog) and only controls ARTISTIC
 * intensity — glow, aura, sparkles, particles, rays and material richness —
 * never any product data.
 *
 * Pure inline SVG: zero network assets, no WebGL, no raster files.
 */

import { type CSSProperties, type ReactNode } from 'react';
import {
  DEFAULT_PALETTE,
  GIFT_ART_SCENE_NAMES,
  GiftArtworkId,
  GiftPalette,
  PALETTE_BY_ID,
  paletteFor,
  resolveGiftArtworkId,
} from './GiftArtworkSvgs.core';

// Re-export the pure registry so existing import sites keep working.
export { DEFAULT_PALETTE, GIFT_ART_SCENE_NAMES, PALETTE_BY_ID, paletteFor, resolveGiftArtworkId };
export type { GiftArtworkId, GiftPalette };

export type ArtContext = { u: string; p: GiftPalette; quality: number; animate: boolean };

/** Small deterministic style helper for float-up particles. */
function up(x: number, y: number, dur: number, delay = 0): CSSProperties {
  return { ['--gx' as string]: `${x}px`, ['--gy' as string]: `${y}px`, ['--gd' as string]: `${dur}s`, ['--gdl' as string]: `${delay}s` } as CSSProperties;
}

/** Deterministic ember rise style. */
function ember(x: number, y: number, dur: number, delay = 0): CSSProperties {
  return { ['--ex' as string]: `${x}px`, ['--ey' as string]: `${y}px`, ['--ed' as string]: `${dur}s`, ['--edl' as string]: `${delay}s` } as CSSProperties;
}
/* ────────────────────────────────────────────────────────────────────
   Shared premium stage components
   ──────────────────────────────────────────────────────────────────── */

function Glow({ u, cx = 80, cy = 74, r = 62, color, opacity = 0.5 }: { u: string; cx?: number; cy?: number; r?: number; color: string; opacity?: number }) {
  const gid = `${u}-glow`;
  return (
    <>
      <defs>
        <radialGradient id={gid} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={color} stopOpacity={opacity} />
          <stop offset="72%" stopColor={color} stopOpacity={opacity * 0.4} />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={r} fill={`url(#${gid})`} />
    </>
  );
}

/** Cinematic light pool that seats the subject on the dark VANTA stage. */
function Spot({ u, color, opacity = 0.13 }: { u: string; color: string; opacity?: number }) {
  const gid = `${u}-spot`;
  return (
    <>
      <defs>
        <radialGradient id={gid} cx="50%" cy="42%" r="58%">
          <stop offset="0%" stopColor={color} stopOpacity={opacity} />
          <stop offset="55%" stopColor={color} stopOpacity={opacity * 0.45} />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx={80} cy={76} rx={72} ry={74} fill={`url(#${gid})`} />
    </>
  );
}

function AuraRing({ u, c, r = 60, animate = false, dash = '2.5 9' }: { u: string; c: string; r?: number; animate?: boolean; dash?: string }) {
  return (
    <g className={animate ? 'giftfx-ring' : ''} style={{ ['--rd' as string]: '3.4s' } as CSSProperties}>
      <circle cx={80} cy={80} r={r} fill="none" stroke={c} strokeWidth={1.7} strokeDasharray={dash} opacity={0.62} />
      <circle cx={80} cy={80} r={r + 11} fill="none" stroke={c} strokeWidth={0.9} opacity={0.28} />
    </g>
  );
}

/** Signature light burst used by the most prestigious (top-tier) gifts. */
function LightRays({ u, color, animate = false }: { u: string; color: string; animate?: boolean }) {
  const gid = `${u}-ray`;
  return (
    <g className={animate ? 'giftfx-halo' : ''} opacity={0.6}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={color} stopOpacity="0" />
          <stop offset="0.55" stopColor={color} stopOpacity="0.5" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 60, 120, 180, 240, 300].map((deg, n) => (
        <path key={n} d="M80 80 L150 72 L80 80 L10 72 Z" transform={`rotate(${deg} 80 80)`} fill={`url(#${gid})`} opacity={0.32 + (n % 2) * 0.2} />
      ))}
    </g>
  );
}

function GroundShadow({ u, cx = 80, cy = 141, w = 42, opacity = 0.4 }: { u: string; cx?: number; cy?: number; w?: number; opacity?: number }) {
  const gid = `${u}-shadow`;
  return (
    <>
      <defs>
        <radialGradient id={gid} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#000000" stopOpacity={opacity} />
          <stop offset="0.7" stopColor="#000000" stopOpacity={opacity * 0.5} />
          <stop offset="1" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx={cx} cy={cy} rx={w} ry={w * 0.2} fill={`url(#${gid})`} />
    </>
  );
}

/** Soft glossy floor echo — sells the lit "display case" feel on premium tiers. */
function FloorReflection({ u, w = 30, opacity = 0.14 }: { u: string; w?: number; opacity?: number }) {
  const gid = `${u}-floor`;
  return (
    <>
      <defs>
        <radialGradient id={gid} cx="50%" cy="0%" r="100%">
          <stop offset="0" stopColor="#ffffff" stopOpacity={opacity} />
          <stop offset="0.5" stopColor="#9db4ff" stopOpacity={opacity * 0.5} />
          <stop offset="1" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx={80} cy={138} rx={w} ry={w * 0.22} fill={`url(#${gid})`} />
    </>
  );
}

function Sparkle({ x, y, size = 6, color = '#ffffff', className = '', style }: { x: number; y: number; size?: number; color?: string; className?: string; style?: CSSProperties }) {
  const w = size * 0.22;
  return (
    <g className={className} fill={color} style={style}>
      <path d={`M${x} ${y - size} L${x + w} ${y} L${x} ${y + size} L${x - w} ${y} Z`} />
      <path d={`M${x - size} ${y} L${x} ${y - w} L${x + size} ${y} L${x} ${y + w} Z`} opacity={0.85} />
    </g>
  );
}

function MiniHeart({ x, y, scale = 1, color = '#ff8fb8', className = '', style, opacity }: { x: number; y: number; scale?: number; color?: string; className?: string; style?: CSSProperties; opacity?: number }) {
  const c = scale * 0.34;
  const d = `M${x} ${y + c * 3.2} C ${x - c * 5.6} ${y - c * 1.4} ${x - c * 2.6} ${y - c * 3} ${x} ${y - c * 0.4} C ${x + c * 2.6} ${y - c * 3} ${x + c * 5.6} ${y - c * 1.4} ${x} ${y + c * 3.2} Z`;
  return <path className={className} style={style} opacity={opacity} fill={color} d={d} />;
}
function Petal({ x, y, w = 9, h = 16, color = '#ffb2cf', className = '', style, opacity, transform }: { x: number; y: number; w?: number; h?: number; color?: string; className?: string; style?: CSSProperties; opacity?: number; transform?: string }) {
  const d = `M${x} ${y - h} C ${x + w} ${y - h * 0.3} ${x + w} ${y + h * 0.3} ${x} ${y + h} C ${x - w} ${y + h * 0.3} ${x - w} ${y - h * 0.3} ${x} ${y - h} Z`;
  return <path transform={transform} className={className} style={style} opacity={opacity} fill={color} d={d} />;
}

function Confetti({ x, y, color, className = '', style, transform }: { x: number; y: number; color: string; className?: string; style?: CSSProperties; transform?: string }) {
  return <rect transform={transform} x={x - 3} y={y - 4} width={6} height={8} rx={1.4} fill={color} className={className} style={style} />;
}

function Dot({ x, y, r = 1.9, color, className = '', style }: { x: number; y: number; r?: number; color: string; className?: string; style?: CSSProperties }) {
  return <circle cx={x} cy={y} r={r} fill={color} className={className} style={style} />;
}

/** Tiny 4-point star glint for cosmic scenes. */
function Glint({ x, y, scale = 1, color = '#ffffff', className = '', style }: { x: number; y: number; scale?: number; color?: string; className?: string; style?: CSSProperties }) {
  return (
    <g className={className} style={style} fill={color}>
      {[[0, -10], [0, 10], [-10, 0], [10, 0]].map(([dx, dy], i) => (
        <rect key={i} x={x + dx * scale * 0.55} y={y + dy * scale * 0.55} width={1.6 * scale} height={1.6 * scale} transform={`rotate(45 ${x + dx * scale * 0.55} ${y + dy * scale * 0.55})`} opacity={0.85} />
      ))}
      <circle cx={x} cy={y} r={1.15 * scale} />
    </g>
  );
}

/* ────────────────────────────────────────────────────────────────────
   VANTA STAGE — the single presentation treatment applied to every gift.
   All intensity scales ONLY with `quality` (existing price/rarity signal).
   ──────────────────────────────────────────────────────────────────── */

function Stage({ u, p, quality, animate = false }: { u: string; p: GiftPalette; quality: number; animate?: boolean }) {
  const glowOpacity = 0.3 + quality * 0.075;   // 0.30 → 0.68
  const rayColor = quality >= 5 ? p.a : p.b;
  return (
    <>
      <Spot u={u} color={p.b} opacity={0.1 + quality * 0.012} />
      {quality >= 5 && <LightRays u={u} color={rayColor} animate={animate} />}
      {quality >= 4 && <Glow u={u} cx={80} cy={72} r={70} color={p.c} opacity={quality * 0.1} />}
      <Glow u={u} cx={80} cy={72} r={60} color={p.b} opacity={glowOpacity} />
      {quality >= 2 && <AuraRing u={u} c={p.a} r={60} animate={animate} />}
    </>
  );
}

/** Particles shared by every scene; count scales with quality only. */
function StageParticles({ u, p, quality, animate }: { u: string; p: GiftPalette; quality: number; animate: boolean }) {
  const orbs: { x: number; y: number; dx: number; dy: number; d: number; dl: number; r: number; c: string }[] = [
    { x: 38, y: 66, dx: -8, dy: -22, d: 2.4, dl: 0.1, r: 2.1, c: p.a },
    { x: 123, y: 60, dx: 9, dy: -24, d: 2.8, dl: 0.5, r: 2.4, c: p.a },
    { x: 132, y: 98, dx: -9, dy: -20, d: 2.2, dl: 1.0, r: 1.7, c: p.c },
    { x: 30, y: 100, dx: 8, dy: -18, d: 3.0, dl: 1.4, r: 1.6, c: p.c },
    { x: 62, y: 44, dx: 5, dy: -18, d: 2.6, dl: 0.8, r: 1.9, c: '#ffffff' },
    { x: 100, y: 108, dx: -6, dy: -16, d: 2.4, dl: 1.8, r: 1.5, c: p.a },
    { x: 80, y: 44, dx: 3, dy: -14, d: 2.2, dl: 0.3, r: 1.8, c: '#ffffff' },
  ];
  const count = [0, 0, 2, 4, 5, 7][Math.max(0, Math.min(5, quality))];
  const sparkles = Math.max(0, quality - 2);
  return (
    <g opacity={animate ? undefined : 0.82}>
      {orbs.slice(0, count).map((o, i) => (
        <Dot key={i} x={o.x} y={o.y} r={o.r} color={o.c}
          className={animate ? 'giftfx-float-up' : ''}
          style={animate ? up(o.dx, o.dy, o.d, o.dl) : undefined} />
      ))}
      {Array.from({ length: sparkles }, (_, i) => (
        <Sparkle key={i} x={[26, 134, 108, 52][i % 4]} y={[42, 46, 92, 96][i % 4]} size={[2.6, 3.1, 2.2, 2.5][i % 4]} color={i % 2 ? '#ffffff' : p.a}
          className={animate ? 'giftfx-sparkle' : ''}
          style={animate ? { animationDelay: `${(i * 0.55).toFixed(2)}s` } as CSSProperties : undefined} />
      ))}
    </g>
  );
}
/* ═══════════════════════════════════════════════════════════════
   SCENES — one premium scene per gift family (22 art types used by
   the 63-gift catalog + full union coverage).
   ═══════════════════════════════════════════════════════════════ */

/* THUMB — glossy electric-blue salute: sleeve, hand, gloss, sparkle haze. */
function ThumbArt({ u, p, quality, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <linearGradient id={`${u}-sleeve`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.a} />
          <stop offset="0.55" stopColor={p.b} />
          <stop offset="1" stopColor={p.c} />
        </linearGradient>
        <linearGradient id={`${u}-skin`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe3c6" />
          <stop offset="0.5" stopColor="#f2ab7c" />
          <stop offset="1" stopColor="#c2743f" />
        </linearGradient>
      </defs>
      <Stage u={u} p={p} quality={quality} animate={animate} />
      <path d="M40 116 L40 128 Q40 140 54 140 L106 140 Q120 140 120 128 L120 116 Q120 108 112 106 L92 106 L92 118 L68 118 L68 106 L48 106 Q40 108 40 116 Z" fill={`url(#${u}-sleeve)`} stroke={p.c} strokeWidth={1.6} />
      <path d="M48 108 L112 108" stroke="#ffffff" strokeWidth={2.6} strokeLinecap="round" opacity={0.5} />
      <path d="M92 106 L92 118 L100 124" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" opacity={0.28} />
      <path d="M62 96 C 62 78 98 78 98 96 L98 106 L62 106 Z" fill={`url(#${u}-skin)`} stroke="#a8623a" strokeWidth={1.5} />
      <path d="M66 88 Q74 82 82 88" fill="none" stroke="#a8623a" strokeWidth={2} strokeLinecap="round" opacity={0.8} />
      <path d="M80 88 Q89 82 97 90" fill="none" stroke="#a8623a" strokeWidth={2} strokeLinecap="round" opacity={0.8} />
      <g transform="rotate(-34 104 74)">
        <path d="M92 40 Q112 40 114 58 L114 96 Q114 108 106 108 L90 108 C 86 108 86 104 88 100 L90 62 Q92 40 92 40 Z" fill={`url(#${u}-skin)`} stroke="#a8623a" strokeWidth={1.5} />
        <path d="M98 44 Q108 46 110 58 L110 96 Q110 102 106 102 L96 102 L97 60 Q98 44 98 44 Z" fill="#ffe9d0" opacity={0.95} />
        <ellipse cx={104} cy={50} rx={8} ry={3.6} transform="rotate(-24 104 50)" fill="#f5b288" />
        <path d="M104 46 Q112 50 108 58" fill="none" stroke="#ffffff" strokeWidth={2.4} strokeLinecap="round" opacity={0.75} />
      </g>
      <GroundShadow u={u} cy={140} w={38} />
      <StageParticles u={u} p={p} quality={quality} animate={animate} />
    </g>
  );
}

/* FLAME — layered plasma flame with white-hot core and rising embers. */
function FlameArt({ u, p, quality, animate }: ArtContext) {
  const embers = quality >= 3 ? quality - 2 : 0;
  return (
    <g>
      <defs>
        <linearGradient id={`${u}-fl`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={p.c} />
          <stop offset="0.55" stopColor={p.b} />
          <stop offset="1" stopColor={p.a} />
        </linearGradient>
        <linearGradient id={`${u}-fc`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#ff7a1f" />
          <stop offset="0.6" stopColor="#ffc93c" />
          <stop offset="1" stopColor="#fffbe8" />
        </linearGradient>
      </defs>
      <Stage u={u} p={p} quality={quality} animate={animate} />
      <g className={animate ? 'giftfx-sway-soft' : ''}>
        <path d="M80 128 C 42 112 36 84 52 66 C 60 40 72 36 80 42 C 92 30 112 44 120 68 C 128 92 124 116 80 128 Z" fill={`url(#${u}-fl)`} opacity={0.62} />
        <path d="M80 130 C 52 120 48 96 60 80 C 68 58 78 52 80 58 C 88 48 102 60 108 82 C 114 104 108 122 80 130 Z" fill={`url(#${u}-fl)`} />
        <path d="M80 132 C 60 124 58 106 68 94 C 74 78 80 74 82 78 C 88 70 96 84 98 100 C 102 116 98 128 80 132 Z" fill={`url(#${u}-fc)`} />
        <path d="M80 134 C 68 128 70 118 75 112 C 78 104 80 102 81 106 C 84 102 88 108 90 118 C 92 126 90 132 80 134 Z" fill="#fff7d0" opacity={0.5} />
      </g>
      <ellipse cx={80} cy={128} rx={22} ry={7} fill={p.c} opacity={0.7} />
      <GroundShadow u={u} cy={140} w={30} opacity={0.34} />
      <StageParticles u={u} p={p} quality={quality} animate={animate} />
      {Array.from({ length: embers }, (_, i) => (
        <Dot key={i} x={[70, 90, 62, 98][i % 4]} y={[112 - i * 14, 108 - i * 12, 118 - i * 10, 100 - i * 14][i % 4]} r={[2.2, 1.8, 2.6, 2.0][i % 4]} color={i % 2 ? p.a : '#ffd57a'}
          className={animate ? 'giftfx-ember' : ''}
          style={animate ? ember([14, -14, 20, -20][i % 4], [-40 - i * 10, -34 - i * 12, -46 - i * 8, -30 - i * 12][i % 4], 2.2 + i * 0.4, i * 0.5) : undefined} />
      ))}
    </g>
  );
}
/* ROSE — sculpted crimson rose with velvet petals, dew and drifting petals. */
function RoseArt({ u, p, quality, animate }: ArtContext) {
  const petals = quality >= 3 ? quality - 2 : 0;
  return (
    <g>
      <defs>
        <radialGradient id={`${u}-rbloom`} cx="0.45" cy="0.4" r="0.75">
          <stop offset="0" stopColor={p.a} />
          <stop offset="0.5" stopColor={p.b} />
          <stop offset="1" stopColor={p.c} />
        </radialGradient>
        <linearGradient id={`${u}-stem`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4ad37f" />
          <stop offset="1" stopColor="#177a45" />
        </linearGradient>
      </defs>
      <Stage u={u} p={p} quality={quality} animate={animate} />
      <path d="M80 142 C 44 142 48 118 54 104" fill="none" stroke="#2fae63" strokeWidth={2.4} strokeLinecap="round" />
      <path d="M62 120 C 54 116 52 108 56 102 C 60 96 70 92 74 94 Z" fill={`url(#${u}-stem)`} />
      <g className={animate ? 'giftfx-sway-soft' : ''}>
        <path d="M80 88 C 46 70 38 44 52 32 C 66 22 82 30 88 42 C 96 40 110 56 118 72 C 126 84 116 96 80 88 Z" fill="#a3174e" opacity={0.55} />
        <path d="M80 92 C 54 78 48 58 60 44 C 70 38 80 42 86 50 C 92 48 102 62 106 78 C 110 90 100 98 80 92 Z" fill={`url(#${u}-rbloom)`} />
        <path d="M80 94 C 60 84 56 68 66 58 C 74 54 80 56 84 62 C 88 60 94 70 96 84 C 100 94 94 100 80 94 Z" fill="#ffd7e4" opacity={0.85} />
        {[[60, 60], [98, 64], [68, 78], [92, 74]].map(([x, y], i) => (
          <ellipse key={i} cx={x} cy={y} rx={9} ry={6.5} transform={`rotate(${[18, -16, 30, -28][i % 4]} ${x} ${y})`} fill={[p.a, '#ff8fb0', p.b, p.a][i % 4]} opacity={0.55 + (i % 2) * 0.2} />
        ))}
        <path d="M80 96 C 70 90 74 86 80 88 C 82 92 80 96 Z" fill="#ffffff" opacity={0.5} />
      </g>
      <ellipse cx={84} cy={62} rx={3} ry={2.2} fill="#ffffff" opacity={0.9} />
      <Petal x={126} y={130} w={8} h={13} color={p.a} className={animate ? 'giftfx-float-up' : ''} style={animate ? up(-12, -26, 3, 0.6) : undefined} opacity={0.85} />
      {Array.from({ length: petals }, (_, i) => (
        <Petal key={i} x={[30, 134, 40, 124][i % 4]} y={[34, 40, 52, 56][i % 4]} w={7 + i} h={11 + i} color={i % 2 ? p.b : p.a}
          className={animate ? 'giftfx-float-up' : ''}
          style={animate ? up([12, -14, 18, -16][i % 4], [-28 - i * 6, -32 - i * 4, -24 - i * 8, -30 - i * 5][i % 4], 3 + i * 0.4, 0.8 + i * 0.7) : undefined}
          opacity={0.7} />
      ))}
      <GroundShadow u={u} cy={140} w={34} />
      <StageParticles u={u} p={p} quality={quality} animate={animate} />
    </g>
  );
}

/* HEART — radiant glass heart with crystalline pulse and pink shine. */
function HeartArt({ u, p, quality, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <linearGradient id={`${u}-hf`} x1="0" y1="0" x2="0.25" y2="1">
          <stop offset="0" stopColor={p.a} />
          <stop offset="0.5" stopColor={p.b} />
          <stop offset="1" stopColor={p.c} />
        </linearGradient>
        <radialGradient id={`${u}-hs`} cx="0.32" cy="0.24" r="0.8">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="0.5" stopColor="#ffd1db" stopOpacity="0.5" />
          <stop offset="1" stopColor="#ffd1db" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Stage u={u} p={p} quality={quality} animate={animate} />
      <circle className={animate ? 'giftfx-ring' : ''} cx={80} cy={70} r={54} fill="none" stroke={p.a} strokeWidth={1.6} strokeDasharray="4 8" opacity={0.7} style={{ ['--rd' as string]: '2.8s' } as CSSProperties} />
      <g className={animate ? 'giftfx-beat' : ''}>
        <path d="M80 133 C 28 101 22 62 46 48 C 58 41 68 47 72 56 C 75 47 87 40 101 45 C 122 56 128 99 80 133 Z" fill={`url(#${u}-hf)`} stroke="#5e0a24" strokeWidth={2} />
        <path d="M80 133 C 28 101 22 62 46 48 C 58 41 68 47 72 56 C 75 47 87 40 101 45 C 88 60 76 92 80 133 Z" fill={`url(#${u}-hs)`} />
        <path d="M47 49 C 55 41 65 42 69 50 C 61 50 53 53 47 49 Z" fill="#ffffff" opacity={0.95} />
        <path d="M92 46 C 108 50 118 60 116 74" fill="none" stroke="#ffffff" strokeWidth={2.4} strokeLinecap="round" opacity={0.38} />
      </g>
      <GroundShadow u={u} cy={140} w={36} />
      <g opacity={animate ? undefined : 0.9}>
        <MiniHeart x={26} y={50} scale={3} color={p.a} className={animate ? 'giftfx-float-up' : ''} style={animate ? up(-8, -22, 2.6, 0.2) : undefined} />
        <MiniHeart x={130} y={38} scale={2.4} color={p.b} className={animate ? 'giftfx-float-up' : ''} style={animate ? up(9, -24, 3, 0.7) : undefined} />
        <MiniHeart x={136} y={106} scale={2} color="#ffd1db" className={animate ? 'giftfx-float-up' : ''} style={animate ? up(-8, -20, 2.4, 1.2) : undefined} />
        <MiniHeart x={20} y={110} scale={1.9} color={p.a} opacity={0.7} className={animate ? 'giftfx-float-up' : ''} style={animate ? up(8, -18, 2.8, 1.6) : undefined} />
      </g>
      <StageParticles u={u} p={p} quality={quality} animate={animate} />
    </g>
  );
}
/* LOVE — twin glowing hearts (pink + violet) merging in an aura. */
function LoveArt({ u, p, quality, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <linearGradient id={`${u}-l1`} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor={p.a} />
          <stop offset="0.5" stopColor="#ff3d9a" />
          <stop offset="1" stopColor="#a8136b" />
        </linearGradient>
        <linearGradient id={`${u}-l2`} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#9df0ff" />
          <stop offset="0.5" stopColor="#3ecbff" />
          <stop offset="1" stopColor="#168eff" />
        </linearGradient>
      </defs>
      <Stage u={u} p={p} quality={quality} animate={animate} />
      <AuraRing u={u} c="#ff9abf" r={66} dash="3 12" animate={animate} />
      <g className={animate ? 'giftfx-love-merge' : ''}>
        <path d="M52 118 C 18 96 14 66 33 55 C 43 49 52 54 55 62 C 58 52 68 48 79 54 C 92 62 94 98 52 118 Z" fill={`url(#${u}-l1)`} stroke="#7e0a51" strokeWidth={2} />
        <path d="M108 118 C 74 96 70 66 89 55 C 99 49 108 54 111 62 C 114 52 124 48 135 54 C 148 62 150 98 108 118 Z" fill={`url(#${u}-l2)`} stroke="#0b4f9a" strokeWidth={2} />
      </g>
      <path d="M52 118 C 18 96 14 66 33 55 C 43 49 52 54 55 62 C 58 52 68 48 79 54 C 84 57 86 63 84 68 C 74 80 62 96 52 118 Z" fill="#ffffff" opacity={0.4} />
      <path d="M108 118 C 74 96 70 66 89 55 C 99 49 108 54 111 62 C 114 52 124 48 135 54 C 139 57 141 63 139 68 C 129 80 117 96 108 118 Z" fill="#ffffff" opacity={0.35} />
      <GroundShadow u={u} cy={140} w={48} opacity={0.4} />
      <g opacity={animate ? undefined : 0.9}>
        <MiniHeart x={32} y={48} scale={2.8} color="#ff8fb8" className={animate ? 'giftfx-float-up' : ''} style={animate ? up(-8, -22, 3, 0.3) : undefined} />
        <MiniHeart x={124} y={40} scale={2.4} color="#7fe3ff" className={animate ? 'giftfx-float-up' : ''} style={animate ? up(9, -24, 3.2, 0.9) : undefined} />
        <MiniHeart x={140} y={108} scale={2} color="#ffd1f1" className={animate ? 'giftfx-float-up' : ''} style={animate ? up(-8, -18, 2.6, 1.4) : undefined} />
        <MiniHeart x={16} y={92} scale={1.8} color="#ff8fb8" opacity={0.8} className={animate ? 'giftfx-float-up' : ''} style={animate ? up(7, -16, 2.8, 1.8) : undefined} />
      </g>
      <StageParticles u={u} p={p} quality={quality} animate={animate} />
    </g>
  );
}

/* HAPPY — celebration orb wearing a party hat with a gold burst of confetti. */
function HappyArt({ u, p, quality, animate }: ArtContext) {
  const confetti = quality >= 2 ? quality + 2 : 0;
  return (
    <g>
      <defs>
        <radialGradient id={`${u}-hb`} cx="0.38" cy="0.32" r="0.8">
          <stop offset="0" stopColor={p.a} />
          <stop offset="0.55" stopColor={p.b} />
          <stop offset="1" stopColor={p.c} />
        </radialGradient>
        <linearGradient id={`${u}-hat`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.4" stopColor="#ffd166" />
          <stop offset="1" stopColor={p.c} />
        </linearGradient>
      </defs>
      <Stage u={u} p={p} quality={quality} animate={animate} />
      <g className={animate ? 'giftfx-sway-soft' : ''}>
        <circle cx={80} cy={92} r={38} fill={`url(#${u}-hb)`} stroke={p.c} strokeWidth={1.6} />
        <path d="M80 44 L80 74" stroke="#ffffff" strokeWidth={2.2} opacity={0.85} />
        <g transform="rotate(16 80 42)">
          <path d="M61 42 L99 42 L104 8 L58 8 Z" fill={`url(#${u}-hat)`} />
          <path d="M99 42 L97 10 L101 10 Z" fill="#ffffff" opacity={0.6} />
        </g>
        <circle cx={80} cy={92} r={38} fill="none" stroke="#ffffff" strokeWidth={2} opacity={0.4} transform="translate(0 -4)" />
        <circle cx={80} cy={92} r={38} fill="none" stroke="#ffffff" strokeWidth={1.2} opacity={0.25} transform="translate(0 -8)" />
        <circle cx={60} cy={78} r={3.2} fill="#ffffff" opacity={0.9} />
        <path d="M118 96 C 122 100 126 104 124 110" fill="none" stroke="#ffffff" strokeWidth={2.2} strokeLinecap="round" opacity={0.45} />
      </g>
      {Array.from({ length: confetti }, (_, i) => (
        <Confetti key={i} x={[30, 130, 46, 118, 60, 100, 24, 138][i % 8]} y={[34, 36, 46, 44, 52, 50, 58, 56][i % 8]}
          color={['#ffd166', '#ff6b8f', '#65f4ff', '#ff8fb8', '#ffe37a', '#7fe3ff', '#ffb02e', '#ff3d9a'][i % 8]}
          className={animate ? 'giftfx-confetti' : ''}
          transform={animate ? undefined : `rotate(${i * 47} ${[30, 130, 46, 118, 60, 100, 24, 138][i % 8]} ${[34, 36, 46, 44, 52, 50, 58, 56][i % 8]})`}
          style={animate ? { ['--sx' as string]: `${[18, -18, 24, -22, 14, -14, 26, -24][i % 8]}px`, ['--sy' as string]: `${[-30, -34, -26, -36, -22, -30, -24, -34][i % 8]}px`, ['--cd' as string]: `${2 + (i % 4) * 0.3}s`, ['--rot' as string]: `${[200, 320, 240, 300, 180, 340, 260, 300][i % 8]}deg` } as CSSProperties : undefined} />
      ))}
      <GroundShadow u={u} cy={140} w={40} />
      <StageParticles u={u} p={p} quality={quality} animate={animate} />
    </g>
  );
}
/* TEDDY — plush honey-toned bear with a satin bow, blush and raised paw. */
function TeddyArt({ u, p, quality, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <radialGradient id={`${u}-fur`} cx="0.4" cy="0.34" r="0.8">
          <stop offset="0" stopColor={p.a} />
          <stop offset="0.55" stopColor={p.b} />
          <stop offset="1" stopColor={p.c} />
        </radialGradient>
        <linearGradient id={`${u}-bow`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff4f7d" />
          <stop offset="1" stopColor="#a81c52" />
        </linearGradient>
      </defs>
      <Stage u={u} p={p} quality={quality} animate={animate} />
      <g className={animate ? 'giftfx-sway-soft' : ''}>
        <circle cx={48} cy={48} r={17} fill={`url(#${u}-fur)`} />
        <circle cx={112} cy={48} r={17} fill={`url(#${u}-fur)`} />
        <path d="M62 43 C 68 39 76 37 84 37 C 92 39 98 43 98 45 Z" fill={p.c} opacity={0.55} />
        <circle cx={80} cy={80} r={42} fill={`url(#${u}-fur)`} stroke={p.c} strokeWidth={1.8} />
        <circle cx={62} cy={74} r={6} fill="#3a2118" />
        <circle cx={98} cy={74} r={6} fill="#3a2118" />
        <circle cx={62} cy={74} r={2.2} fill="#ffffff" opacity={0.9} />
        <circle cx={98} cy={74} r={2.2} fill="#ffffff" opacity={0.9} />
        <ellipse cx={80} cy={88} rx={13} ry={9} fill="#ffe6c2" />
        <path d="M74 88 Q80 84 86 88 L88 92 C 82 94 80 92 76 90 Z" fill="none" stroke="#5a3a22" strokeWidth={1.6} strokeLinecap="round" />
        <circle cx={70} cy={82} r={3.4} fill="#ffb0c0" opacity={0.6} />
        <circle cx={90} cy={82} r={3.4} fill="#ffb0c0" opacity={0.6} />
        <path d="M58 118 Q44 96 80 108 Q114 96 102 118 Z" fill={`url(#${u}-bow)`} />
        <path d="M80 108 L80 118" stroke="#8e1643" strokeWidth={3} strokeLinecap="round" />
        <path d="M80 108 C 74 104 74 100 70 100 C 66 102 60 104 58 108 Z" fill={`url(#${u}-bow)`} />
        <path d="M80 108 C 86 104 86 100 90 100 C 94 102 100 104 102 108 Z" fill={`url(#${u}-bow)`} />
        <circle cx={120} cy={98} r={12} fill={`url(#${u}-fur)`} />
        <path d="M120 100 L120 122" stroke="#6e4a2a" strokeWidth={2.4} strokeLinecap="round" opacity={0.6} />
        <ellipse cx={80} cy={106} rx={7} ry={5} fill="#f2cfa0" opacity={0.6} />
      </g>
      <GroundShadow u={u} cy={140} w={40} />
      <StageParticles u={u} p={p} quality={quality} animate={animate} />
    </g>
  );
}

/* PEARL — iridescent pearl resting on an open mother-of-pearl shell. */
function PearlArt({ u, p, quality, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <radialGradient id={`${u}-pearl`} cx="0.36" cy="0.3" r="0.75">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor={p.b} />
          <stop offset="1" stopColor={p.c} />
        </radialGradient>
        <linearGradient id={`${u}-shell`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f4f9ff" />
          <stop offset="0.5" stopColor="#cfe6ff" />
          <stop offset="1" stopColor="#7a5cff" />
        </linearGradient>
        <radialGradient id={`${u}-irid`} cx="0.5" cy="0.42" r="0.6">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="0.4" stopColor="#7fe3ff" stopOpacity="0.6" />
          <stop offset="0.75" stopColor="#ff8fd0" stopOpacity="0.35" />
          <stop offset="1" stopColor="#ff8fd0" stopOpacity="0" />
        </radialGradient>
      </defs>
      <Stage u={u} p={p} quality={quality} animate={animate} />
      <g className={animate ? 'giftfx-sway-soft' : ''}>
        <path d="M36 118 C 28 108 32 96 40 92 C 50 90 58 92 62 100 C 66 110 70 118 76 122 C 88 122 96 118 100 110 C 106 102 112 96 122 100 C 130 108 132 118 124 122 Z" fill={`url(#${u}-shell)`} stroke="#6b8fd8" strokeWidth={1.6} />
        {[44, 62, 84, 104].map((x, i) => (
          <path key={i} d={`M${x} 118 C ${x - 8} 106 ${x - 10} 96 ${x} 90 C ${x + 10} 96 ${x + 8} 106 ${x + 2} 118 Z`} fill="none" stroke="#bfe2ff" strokeWidth={1.4} opacity={0.7 - i * 0.1} />
        ))}
        <circle cx={80} cy={84} r={24} fill={`url(#${u}-pearl)`} stroke="#ffffff" strokeWidth={1.4} />
        <circle cx={80} cy={84} r={24} fill={`url(#${u}-irid)`} />
        <ellipse cx={74} cy={76} rx={7} ry={4.4} fill="#ffffff" opacity={0.95} />
        <path d="M88 70 C 96 76 98 84 92 94" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" opacity={0.4} />
      </g>
      {quality >= 2 && (
        <g>
          <Sparkle x={58} y={52} size={2.6} color="#ffffff" className={animate ? 'giftfx-sparkle' : ''} />
          <Sparkle x={104} y={48} size={2.2} color="#7fe3ff" className={animate ? 'giftfx-sparkle' : ''} style={animate ? { animationDelay: '0.7s' } as CSSProperties : undefined} />
        </g>
      )}
      <GroundShadow u={u} cy={140} w={44} />
      <StageParticles u={u} p={p} quality={quality} animate={animate} />
    </g>
  );
}
/* MEDAL — polished gold champion medal with metallic ribbon. */
function MedalArt({ u, p, quality, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <radialGradient id={`${u}-gold`} cx="0.42" cy="0.36" r="0.8">
          <stop offset="0" stopColor={p.a} />
          <stop offset="0.55" stopColor={p.b} />
          <stop offset="1" stopColor={p.c} />
        </radialGradient>
        <linearGradient id={`${u}-ribbon`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e84f9e" />
          <stop offset="1" stopColor="#6b1f8f" />
        </linearGradient>
      </defs>
      <Stage u={u} p={p} quality={quality} animate={animate} />
      <path d="M42 22 C 48 26 54 40 56 54 C 48 58 42 62 40 72 C 48 76 60 74 64 70 C 78 76 96 76 100 72 C 104 68 116 64 118 58 C 120 48 122 40 118 30 C 116 24 108 22 42 22 Z" fill={`url(#${u}-ribbon)`} opacity={0.92} />
      <g className={animate ? 'giftfx-sway-soft' : ''}>
        <circle cx={80} cy={100} r={44} fill={`url(#${u}-gold)`} stroke={p.b} strokeWidth={2.4} />
        <circle cx={80} cy={100} r={44} fill="none" stroke="#ffffff" strokeWidth={1.8} opacity={0.35} transform="translate(0 -6)" />
        <circle cx={80} cy={100} r={34} fill="none" stroke={p.a} strokeWidth={1.6} opacity={0.7} />
        <path d="M48 106 L112 106 L120 100 L130 94 L138 88 L138 80 L120 92 L104 100 Z" fill="none" stroke={p.a} strokeWidth={2.2} opacity={0.9} />
        <path d="M50 108 L58 100 L68 104 L80 110 L92 104 L100 96 L110 100" fill="none" stroke={p.b} strokeWidth={1.4} opacity={0.5} />
        <ellipse cx={66} cy={86} rx={12} ry={7} fill="#ffffff" opacity={0.45} transform="rotate(-12 66 86)" />
        <circle cx={98} cy={82} r={2.8} fill="#ffffff" opacity={0.9} />
        {quality >= 2 && (
          <g>
            {[[54, 70], [106, 66], [46, 96], [114, 92]].map(([x, y], i) => (
              <ellipse key={i} cx={x} cy={y} rx={3} ry={2} fill="#ffffff" opacity={0.5 + (i % 2) * 0.3} transform={`rotate(${[30, -24, 12, -30][i]} ${x} ${y})`} />
            ))}
          </g>
        )}
      </g>
      <GroundShadow u={u} cy={141} w={44} />
      {quality >= 3 && <Sparkle x={80} y={34} size={3.4} color="#ffffff" className={animate ? 'giftfx-sparkle' : ''} />}
      <StageParticles u={u} p={p} quality={quality} animate={animate} />
    </g>
  );
}

/* DIAMOND — monumental faceted ice-blue crystal with internal light. */
function DiamondArt({ u, p, quality, animate }: ArtContext) {
  const facets = quality >= 4;
  return (
    <g>
      <defs>
        <linearGradient id={`${u}-d1`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.5" stopColor={p.b} />
          <stop offset="1" stopColor={p.c} />
        </linearGradient>
        <linearGradient id={`${u}-d2`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor={p.a} />
          <stop offset="1" stopColor={p.c} />
        </linearGradient>
      </defs>
      <Stage u={u} p={p} quality={quality} animate={animate} />
      <g className={animate ? 'giftfx-sway-soft' : ''}>
        <path d="M80 24 L48 88 L44 138 L80 138 L116 88 L112 24 Z" fill={`url(#${u}-d1)`} stroke="#bfeaff" strokeWidth={1.8} />
        <path d="M80 24 L112 24 L116 88 L80 138 L44 138 L48 88 Z" fill={`url(#${u}-d2)`} opacity={0.88} />
        <path d="M64 40 L80 24 L80 138 L48 88 Z" fill="#ffffff" opacity={0.5} />
        <path d="M80 24 L112 24 L116 88 L80 138 Z" fill="#dff4ff" opacity={0.4} />
        {facets && (
          <g>
            <path d="M80 24 L64 56 L52 92 L56 120 L72 120 L80 138 Z" fill="#ffffff" opacity={0.55} />
            <path d="M80 24 L96 56 L108 92 L104 120 L88 120 L80 138 Z" fill="#cfeaff" opacity={0.5} />
          </g>
        )}
        <path d="M68 42 L86 42 L86 62 L68 62 Z" fill="#ffffff" opacity={0.85} />
        <path d="M72 30 L88 30" stroke="#ffffff" strokeWidth={3} strokeLinecap="round" opacity={0.95} />
        <path d="M76 118 L84 118" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" opacity={0.5} />
      </g>
      <path d="M80 138 L80 120 L64 120 L96 120" fill="none" stroke="#bfeaff" strokeWidth={2} opacity={0.5} />
      <GroundShadow u={u} cy={141} w={38} />
      <g>
        <Sparkle x={56} y={54} size={2.6} color="#ffffff" className={animate ? 'giftfx-sparkle' : ''} />
        <Sparkle x={104} y={50} size={2.2} color="#7fe3ff" className={animate ? 'giftfx-sparkle' : ''} style={animate ? { animationDelay: '0.5s' } as CSSProperties : undefined} />
        {quality >= 4 && <Sparkle x={80} y={30} size={3.6} color="#ffffff" className={animate ? 'giftfx-sparkle' : ''} style={animate ? { animationDelay: '1.1s' } as CSSProperties : undefined} />}
      </g>
      <StageParticles u={u} p={p} quality={quality} animate={animate} />
    </g>
  );
}
/* CROWN — royal violet-and-gold jeweled crown, gems sparkle at higher tiers. */
function CrownArt({ u, p, quality, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <linearGradient id={`${u}-gold2`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={p.a} />
          <stop offset="0.5" stopColor={p.b} />
          <stop offset="1" stopColor="#8a5a10" />
        </linearGradient>
        <radialGradient id={`${u}-gem`} cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.45" stopColor="#65f4ff" />
          <stop offset="1" stopColor="#168eff" />
        </radialGradient>
      </defs>
      <Stage u={u} p={p} quality={quality} animate={animate} />
      <g className={animate ? 'giftfx-sway-soft' : ''}>
        <path d="M36 128 C 28 122 24 114 22 106 C 26 96 34 90 44 90 C 34 98 32 108 36 118 C 40 126 46 130 54 130 C 60 126 66 118 64 108 C 58 100 52 96 36 128 Z" fill={`url(#${u}-gold2)`} stroke="#8a5a10" strokeWidth={1.6} />
        <path d="M92 128 C 120 128 122 118 128 108 C 134 98 140 94 146 96 C 148 102 144 112 138 122 C 132 132 128 130 120 122 C 112 112 100 106 92 128 Z" fill={`url(#${u}-gold2)`} stroke="#8a5a10" strokeWidth={1.6} />
        <path d="M38 128 C 30 116 26 96 34 74 C 42 58 58 46 74 40 C 86 40 102 46 118 58 C 130 74 134 96 122 128 Z" fill={`url(#${u}-gold2)`} stroke="#b8860b" strokeWidth={1.6} />
        <circle cx={38} cy={118} r={6.5} fill={`url(#${u}-gem)`} stroke="#ffffff" strokeWidth={1.2} />
        <circle cx={122} cy={118} r={6.5} fill={`url(#${u}-gem)`} stroke="#ffffff" strokeWidth={1.2} />
        <circle cx={80} cy={128} r={7.5} fill={`url(#${u}-gem)`} stroke="#ffffff" strokeWidth={1.4} />
        {quality >= 2 && (
          <g>
            <circle cx={52} cy={68} r={4.4} fill={`url(#${u}-gem)`} opacity={0.9} />
            <circle cx={108} cy={68} r={4.4} fill={`url(#${u}-gem)`} opacity={0.9} />
            <circle cx={36} cy={102} r={3.8} fill="#ff8fb8" opacity={0.9} />
            <circle cx={124} cy={102} r={3.8} fill="#ff8fb8" opacity={0.9} />
          </g>
        )}
        <path d="M44 116 C 52 110 62 108 74 112" fill="none" stroke={p.a} strokeWidth={2.4} strokeLinecap="round" opacity={0.8} />
        <path d="M116 116 C 108 110 98 108 86 112" fill="none" stroke={p.a} strokeWidth={2.4} strokeLinecap="round" opacity={0.8} />
        <ellipse cx={80} cy={106} rx={30} ry={6} fill="#ffffff" opacity={0.35} />
      </g>
      <GroundShadow u={u} cy={140} w={52} />
      {quality >= 3 && <Sparkle x={80} y={90} size={3} color="#65f4ff" className={animate ? 'giftfx-sparkle' : ''} />}
      <StageParticles u={u} p={p} quality={quality} animate={animate} />
    </g>
  );
}

/* CAR — glossy exotic supercar in three-quarter view with neon light trails. */
function CarArt({ u, p, quality, animate }: ArtContext) {
  const trails = quality >= 3;
  return (
    <g>
      <defs>
        <linearGradient id={`${u}-body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.a} />
          <stop offset="0.5" stopColor={p.b} />
          <stop offset="1" stopColor={p.c} />
        </linearGradient>
        <linearGradient id={`${u}-glass`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b8fbff" />
          <stop offset="0.5" stopColor="#2c5adf" />
          <stop offset="1" stopColor="#0e1230" />
        </linearGradient>
      </defs>
      <Stage u={u} p={p} quality={quality} animate={animate} />
      {trails && (
        <g opacity={0.75}>
          <path d="M30 132 C 54 132 72 130 92 130 C 104 132 118 138 128 140" fill="none" stroke={p.c} strokeWidth={3} strokeLinecap="round" />
          <path d="M34 138 C 58 138 76 136 96 136 C 110 140 122 144 130 146" fill="none" stroke={p.a} strokeWidth={1.8} strokeLinecap="round" opacity={0.8} />
        </g>
      )}
      <g className={animate ? 'giftfx-sway-soft' : ''}>
        <path d="M34 116 C 42 112 52 108 62 108 C 70 104 80 106 92 100 C 100 94 108 92 112 96 C 120 100 126 106 128 112 Z" fill={`url(#${u}-glass)`} opacity={0.95} />
        <path d="M24 128 C 20 118 18 112 24 104 C 30 98 40 96 50 100 C 62 102 80 102 96 100 C 108 96 118 92 128 96 C 136 100 140 108 138 120 C 136 126 132 130 120 132 Z" fill={`url(#${u}-body)`} stroke="#ffffff" strokeWidth={1.4} opacity={0.96} />
        {[[40, 124], [108, 124]].map(([x, y], i) => (
          <ellipse key={i} cx={x} cy={y} rx={13} ry={7} fill="#0a0d1e" stroke="#3a4a8f" strokeWidth={1.6} />
        ))}
        <circle cx={40} cy={124} r={4.4} fill="#ffffff" opacity={0.92} />
        <circle cx={108} cy={124} r={4.4} fill="#ffffff" opacity={0.9} />
        {quality >= 2 && (
          <>
            <path d="M124 108 L138 112" stroke={p.a} strokeWidth={3.4} strokeLinecap="round" opacity={0.95} />
            <circle cx={141} cy={113} r={4} fill={p.a} opacity={0.96} />
          </>
        )}
        {quality >= 4 && (
          <>
            <path d="M30 120 L42 116 C 50 112 56 114 62 118" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" opacity={0.7} />
            <path d="M84 96 C 90 92 98 90 106 92" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" opacity={0.6} />
          </>
        )}
      </g>
      <GroundShadow u={u} cy={140} w={48} />
      <StageParticles u={u} p={p} quality={quality} animate={animate} />
    </g>
  );
}
/* JET — sleek luxury private jet with swept wings and a starlight trail. */
function JetArt({ u, p, quality, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <linearGradient id={`${u}-jet`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={p.a} />
          <stop offset="0.5" stopColor={p.b} />
          <stop offset="1" stopColor={p.c} />
        </linearGradient>
        <linearGradient id={`${u}-jwin`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={p.c} />
          <stop offset="1" stopColor="#4b74c9" />
        </linearGradient>
      </defs>
      <Stage u={u} p={p} quality={quality} animate={animate} />
      <g className={animate ? 'giftfx-sway-soft' : ''}>
        <path d="M28 118 L96 118 L100 96 L104 80 C 108 68 118 58 134 54 C 142 58 146 66 148 76 C 148 80 146 86 142 92 L138 96 L132 100 L118 100 L96 118 Z" fill={`url(#${u}-jet)`} stroke="#ffffff" strokeWidth={1.4} opacity={0.95} />
        <path d="M38 118 C 44 112 52 106 60 102 C 68 98 76 96 84 98 Z" fill={`url(#${u}-jwin)`} opacity={0.9} />
        <path d="M36 112 L44 100 L52 98 L64 100 L80 98 L92 102 L104 106" fill="none" stroke="#ffffff" strokeWidth={2.2} strokeLinecap="round" opacity={0.5} />
        <path d="M96 118 L124 96 C 128 88 122 82 116 84 C 112 90 116 98 120 108 Z" fill={`url(#${u}-jwin)`} opacity={0.92} />
        <path d="M96 118 L124 96 L112 84 L104 92" fill="none" stroke="#cfeaff" strokeWidth={1.8} opacity={0.75} />
        <path d="M126 74 L148 68 L152 72 L150 80 Z" fill={p.c} opacity={0.85} />
        <path d="M132 74 L144 68 L146 72" fill="none" stroke="#ffffff" strokeWidth={1.6} opacity={0.7} />
        <circle cx={84} cy={96} r={3} fill="#ffffff" opacity={0.9} />
        <circle cx={98} cy={90} r={2.6} fill="#ffffff" opacity={0.8} />
      </g>
      {quality >= 2 && <path d="M28 118 Q16 112 6 104" fill="none" stroke={p.c} strokeWidth={5} strokeLinecap="round" opacity={0.55} />}
      {quality >= 3 && <path d="M28 118 Q14 106 4 94" fill="none" stroke={p.a} strokeWidth={2.4} strokeLinecap="round" opacity={0.7} />}
      <GroundShadow u={u} cy={140} w={56} opacity={0.34} />
      <StageParticles u={u} p={p} quality={quality} animate={animate} />
    </g>
  );
}

/* YACHT — luxury yacht riding crystal water with a warm deck glow. */
function YachtArt({ u, p, quality, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <linearGradient id={`${u}-hull`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.5" stopColor={p.b} />
          <stop offset="1" stopColor={p.c} />
        </linearGradient>
        <linearGradient id={`${u}-deck`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe9b0" />
          <stop offset="1" stopColor="#c8902c" />
        </linearGradient>
      </defs>
      <Stage u={u} p={p} quality={quality} animate={animate} />
      <g className={animate ? 'giftfx-sway-soft' : ''}>
        <path d="M24 122 C 22 118 30 114 40 112 C 50 110 60 112 70 114 C 84 112 96 108 104 106 C 112 108 118 112 122 118 C 124 122 120 126 108 128 Z" fill={`url(#${u}-hull)`} stroke="#bfe2ff" strokeWidth={1.6} opacity={0.96} />
        <path d="M34 112 C 40 108 52 106 62 102 C 72 100 84 98 94 100 C 100 104 104 106 106 110 Z" fill={`url(#${u}-deck)`} opacity={0.9} />
        <path d="M52 100 L56 78 L58 66 L56 52 Z" fill="none" stroke={p.b} strokeWidth={3} strokeLinecap="round" />
        <path d="M56 52 L44 36 L56 34 L66 44 L74 56 L70 66 L62 74 Z" fill={p.a} opacity={0.9} />
        <path d="M46 38 L54 36 L60 40" fill="none" stroke="#ffffff" strokeWidth={1.6} opacity={0.75} />
        <path d="M58 66 L70 52 L74 56 L66 64 Z" fill="#ffffff" opacity={0.65} />
        <path d="M42 106 C 48 102 54 98 62 96 C 68 98 68 102 66 108 Z" fill="#ffe9c0" opacity={0.95} />
        <circle cx={52} cy={102} r={2} fill="#ffd166" opacity={0.95} />
        {quality >= 2 && (
          <g>
            <path d="M24 122 C 34 120 44 122 54 124 C 66 126 78 126 86 124 C 94 122 102 122 110 122 Z" fill="none" stroke={p.a} strokeWidth={2} strokeLinecap="round" opacity={0.8} />
            <path d="M30 126 C 44 126 58 128 74 128 C 88 126 100 128 108 128 Z" fill="none" stroke="#ffffff" strokeWidth={1.4} strokeLinecap="round" opacity={0.55} />
          </g>
        )}
      </g>
      <GroundShadow u={u} cy={140} w={52} opacity={0.3} />
      <StageParticles u={u} p={p} quality={quality} animate={animate} />
    </g>
  );
}
/* DRAGON — regal dragon head breathing embers, horned and jewel-eyed. */
function DragonArt({ u, p, quality, animate }: ArtContext) {
  const fire = quality >= 2;
  return (
    <g>
      <defs>
        <linearGradient id={`${u}-scale`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.a} />
          <stop offset="0.55" stopColor={p.b} />
          <stop offset="1" stopColor={p.c} />
        </linearGradient>
      </defs>
      <Stage u={u} p={p} quality={quality} animate={animate} />
      <g className={animate ? 'giftfx-sway-soft' : ''}>
        <path d="M20 108 C 34 104 46 96 58 92 C 68 88 78 86 88 88 C 96 92 104 98 110 106 C 114 112 118 118 122 122 C 124 128 120 132 108 134 Z" fill={`url(#${u}-scale)`} stroke="#1c6e3a" strokeWidth={1.8} opacity={0.94} />
        <path d="M20 108 C 30 110 40 112 52 114 C 64 116 74 118 84 118 C 92 116 100 114 108 110 Z" fill={p.c} opacity={0.92} />
        <path d="M34 84 C 26 78 22 68 26 58 C 30 48 40 42 50 44 C 56 48 58 54 56 62 Z" fill="#5c3a14" stroke="#8a5a10" strokeWidth={1.6} />
        <circle cx={46} cy={68} r={7} fill="#ffd166" stroke="#ff8c42" strokeWidth={2} />
        <circle cx={46} cy={68} r={2.8} fill="#ffffff" opacity={0.95} />
        <path d="M58 92 C 64 88 70 86 76 90 C 70 96 64 100 60 102 Z" fill="#ffffff" opacity={0.8} />
        <path d="M108 108 C 112 104 114 100 112 96 C 108 98 104 102 100 108 Z" fill="#ffffff" opacity={0.35} />
        <path d="M20 108 C 14 106 10 102 8 96 C 12 92 18 94 20 108 Z" fill={`url(#${u}-scale)`} opacity={0.9} />
      </g>
      {fire && (
        <g opacity={0.9}>
          <path d="M108 40 C 122 52 132 60 140 54 C 144 46 140 38 128 34 C 120 32 112 36 106 42 Z" fill="#ff8c42" opacity={0.75} />
          <path d="M112 44 C 124 52 132 56 138 50 C 140 42 132 36 122 34 Z" fill="#ffd166" />
          {quality >= 3 && <path d="M128 44 L140 40 L144 44" stroke="#fff7d0" strokeWidth={2.4} strokeLinecap="round" opacity={0.85} />}
        </g>
      )}
      <GroundShadow u={u} cy={140} w={52} opacity={0.36} />
      <StageParticles u={u} p={p} quality={quality} animate={animate} />
    </g>
  );
}

/* CASTLE — aurora castle with towers, banners and a violet night sky. */
function CastleArt({ u, p, quality, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <linearGradient id={`${u}-wall`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.a} />
          <stop offset="0.55" stopColor={p.b} />
          <stop offset="1" stopColor={p.c} />
        </linearGradient>
        <linearGradient id={`${u}-aurora`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#65f4ff" stopOpacity="0.85" />
          <stop offset="0.5" stopColor={p.b} stopOpacity="0.5" />
          <stop offset="1" stopColor="#ff8fd0" stopOpacity="0.25" />
        </linearGradient>
      </defs>
      <Stage u={u} p={p} quality={quality} animate={animate} />
      <path d="M24 62 C 34 60 44 58 54 58 C 64 56 74 54 86 54 C 96 56 106 58 116 60 C 126 62 134 64 138 68 Z" fill={`url(#${u}-aurora)`} opacity={0.6} />
      <path d="M44 50 L50 44 L56 44 L56 50 L44 50 Z" fill="#ffffff" opacity={0.9} />
      <g className={animate ? 'giftfx-sway-soft' : ''}>
        <path d="M30 132 L30 96 L40 96 L40 132 L46 132 L46 122 L96 122 L96 132 Z" fill={`url(#${u}-wall)`} stroke={p.c} strokeWidth={1.4} />
        <path d="M30 96 L40 96 L40 104 L30 104 Z M36 96 L38 90 L40 96 Z M30 96 L32 90 L30 102 Z" fill={p.c} opacity={0.9} />
        <path d="M58 132 L58 96 L70 96 L70 132 Z" fill={`url(#${u}-wall)`} opacity={0.92} />
        <path d="M58 96 L58 92 L70 92 L70 96 Z" fill={p.c} opacity={0.9} />
        <path d="M84 122 L84 96 L92 96 L92 122 Z" fill={`url(#${u}-wall)`} opacity={0.92} />
        <path d="M84 96 L92 96 L92 104 L84 104 Z M92 96 L94 90 L92 104 Z M84 96 L82 90 L84 102 Z" fill={p.c} opacity={0.9} />
        <path d="M104 132 L104 112 L116 112 L116 132 Z" fill={`url(#${u}-wall)`} opacity={0.9} />
        <path d="M104 112 L104 108 L116 108 L116 112 Z" fill={p.c} opacity={0.9} />
        <circle cx={64} cy={116} r={3.2} fill="#ffd166" opacity={0.95} />
        <circle cx={88} cy={116} r={3.2} fill="#ffd166" opacity={0.95} />
        <path d="M34 122 L40 114 L46 122 Z" fill="#d9b4ff" opacity={0.85} />
        <path d="M88 122 L94 114 L100 122 Z" fill="#d9b4ff" opacity={0.85} />
        <path d="M40 96 C 44 94 48 92 52 92 C 56 94 60 98 64 100" fill="none" stroke="#ffffff" strokeWidth={1.8} opacity={0.5} />
      </g>
      <GroundShadow u={u} cy={140} w={60} opacity={0.3} />
      <StageParticles u={u} p={p} quality={quality} animate={animate} />
    </g>
  );
}
/* STAR — regal five-point star with cut facets and a sparkle burst. */
function StarArt({ u, p, quality, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <polygon id={`${u}-st`} points="0,-20 4.7,-6.2 4.7,6.2 0,20 -4.7,6.2 -4.7,-6.2" />
        <linearGradient id={`${u}-gold3`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.a} />
          <stop offset="0.55" stopColor={p.b} />
          <stop offset="1" stopColor={p.c} />
        </linearGradient>
      </defs>
      <Stage u={u} p={p} quality={quality} animate={animate} />
      <g className={animate ? 'giftfx-sparkle' : ''} transform="rotate(18 80 88)">
        <use href={`#${u}-st`} x={80} y={88} fill={`url(#${u}-gold3)`} stroke={p.b} strokeWidth={1.8} />
        <use href={`#${u}-st`} x={80} y={88} fill="none" stroke="#ffffff" strokeWidth={1.2} opacity={0.6} transform="scale(0.86) translate(11.2 12.3)" />
      </g>
      <path d="M80 60 L80 74 L86 74 L86 88 L80 88 L74 88 L74 74 L80 74 Z" fill="#ffffff" opacity={0.85} />
      <circle cx={76} cy={80} r={3} fill="#ffffff" opacity={0.95} />
      <GroundShadow u={u} cy={141} w={34} opacity={0.3} />
      <g>
        <Sparkle x={56} y={62} size={2.4} color="#ffffff" className={animate ? 'giftfx-sparkle' : ''} />
        <Sparkle x={104} y={56} size={2.2} color="#ffd76e" className={animate ? 'giftfx-sparkle' : ''} style={animate ? { animationDelay: '0.6s' } as CSSProperties : undefined} />
        {quality >= 4 && <Sparkle x={80} y={110} size={2.8} color="#ffffff" className={animate ? 'giftfx-sparkle' : ''} style={animate ? { animationDelay: '1.2s' } as CSSProperties : undefined} />}
      </g>
      <StageParticles u={u} p={p} quality={quality} animate={animate} />
    </g>
  );
}

/* COMET — violet comet with a luminous speed trail and trailing stardust. */
function CometArt({ u, p, quality, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <radialGradient id={`${u}-core`} cx="0.4" cy="0.4" r="0.7">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.5" stopColor={p.a} />
          <stop offset="1" stopColor={p.b} />
        </radialGradient>
        <linearGradient id={`${u}-tr`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={p.c} stopOpacity="0" />
          <stop offset="0.6" stopColor={p.b} stopOpacity="0.6" />
          <stop offset="1" stopColor={p.a} stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <Stage u={u} p={p} quality={quality} animate={animate} />
      <g className={animate ? 'giftfx-sway-soft' : ''}>
        <path d="M8 118 C 20 110 32 100 44 92 C 52 88 60 86 66 88 Z" fill={`url(#${u}-tr)`} />
        <path d="M8 124 C 22 116 36 108 48 102 C 56 100 62 98 68 100 Z" fill={`url(#${u}-tr)`} opacity={0.7} />
        <circle cx={80} cy={88} r={20} fill={`url(#${u}-core)`} stroke="#ffffff" strokeWidth={1.6} />
        <ellipse cx={74} cy={80} rx={7} ry={4.4} fill="#ffffff" opacity={0.95} />
        <path d="M88 76 C 96 82 98 88 94 96" fill="none" stroke="#ffffff" strokeWidth={2.2} strokeLinecap="round" opacity={0.5} />
      </g>
      <path d="M96 96 L138 74 L148 92 L120 100 Z" fill="#ffffff" opacity={0.2} />
      <GroundShadow u={u} cy={140} w={30} opacity={0.22} />
      <g>
        <Glint x={112} y={60} scale={2} color="#cfe9ff" className={animate ? 'giftfx-sparkle' : ''} />
        <Glint x={132} y={44} scale={1.4} color="#ffffff" className={animate ? 'giftfx-sparkle' : ''} style={animate ? { animationDelay: '0.8s' } as CSSProperties : undefined} />
        <Glint x={118} y={116} scale={1.2} color="#8f6bff" className={animate ? 'giftfx-sparkle' : ''} style={animate ? { animationDelay: '1.4s' } as CSSProperties : undefined} />
      </g>
      <StageParticles u={u} p={p} quality={quality} animate={animate} />
    </g>
  );
}

/* ORB — quantum energy orb held by two neon rings with plasma arc. */
function OrbArt({ u, p, quality, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <radialGradient id={`${u}-ob`} cx="0.38" cy="0.34" r="0.75">
          <stop offset="0" stopColor={p.a} />
          <stop offset="0.55" stopColor={p.b} />
          <stop offset="1" stopColor={p.c} />
        </radialGradient>
      </defs>
      <Stage u={u} p={p} quality={quality} animate={animate} />
      <g className={animate ? 'giftfx-halo' : ''}>
        <ellipse cx={80} cy={92} rx={46} ry={16} fill="none" stroke={p.a} strokeWidth={2.2} opacity={0.85} transform="rotate(-14 80 92)" />
        <ellipse cx={80} cy={92} rx={46} ry={16} fill="none" stroke={p.c} strokeWidth={1.6} opacity={0.7} transform="rotate(14 80 92)" />
      </g>
      <circle cx={80} cy={78} r={30} fill={`url(#${u}-ob)`} stroke="#ffffff" strokeWidth={1.6} />
      <ellipse cx={72} cy={68} rx={9} ry={5.4} fill="#ffffff" opacity={0.9} />
      <path d="M92 64 C 100 72 102 84 96 96" fill="none" stroke="#ffffff" strokeWidth={2.4} strokeLinecap="round" opacity={0.4} />
      {quality >= 3 && (
        <g>
          <path d="M62 96 C 58 104 66 112 74 114 C 84 116 94 110 102 102" fill="none" stroke={p.a} strokeWidth={2} strokeLinecap="round" opacity={0.8} />
          <path d="M60 102 C 72 114 84 108 96 100" fill="none" stroke="#ffffff" strokeWidth={1.2} strokeLinecap="round" opacity={0.5} />
        </g>
      )}
      <GroundShadow u={u} cy={140} w={42} />
      <StageParticles u={u} p={p} quality={quality} animate={animate} />
    </g>
  );
}
/* RING — incandescent plasma ring orbiting a sapphire gem. */
function RingArt({ u, p, quality, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <radialGradient id={`${u}-rgem`} cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.5" stopColor="#65f4ff" />
          <stop offset="1" stopColor="#168eff" />
        </radialGradient>
        <linearGradient id={`${u}-rband`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.4" stopColor={p.b} />
          <stop offset="1" stopColor={p.c} />
        </linearGradient>
      </defs>
      <Stage u={u} p={p} quality={quality} animate={animate} />
      <g className={animate ? 'giftfx-halo' : ''}>
        <ellipse cx={80} cy={80} rx={48} ry={22} fill="none" stroke={p.a} strokeWidth={3} opacity={0.9} transform="rotate(-8 80 80)" />
        <ellipse cx={80} cy={80} rx={48} ry={22} fill="none" stroke="#ffffff" strokeWidth={1.4} opacity={0.55} transform="rotate(14 80 80)" />
      </g>
      <path d="M60 104 C 68 96 76 92 84 92 C 92 96 100 104 100 110 C 96 116 84 120 76 116 C 68 108 62 102 60 104 Z" fill={`url(#${u}-rband)`} opacity={0.9} />
      <path d="M62 106 C 64 102 64 98 62 104 Z" fill="#ffffff" opacity={0.6} />
      <path d="M54 84 L70 78 L76 82 L76 92 L70 96 L58 92 Z" fill={`url(#${u}-rgem)`} stroke="#b8fbff" strokeWidth={1.4} />
      <path d="M60 82 L66 79 L68 82" fill="#ffffff" opacity={0.85} />
      {quality >= 3 && (
        <g>
          <circle cx={120} cy={70} r={3} fill={p.a} />
          <circle cx={42} cy={92} r={2.4} fill={p.c} />
          <circle cx={130} cy={96} r={2} fill="#ffffff" />
        </g>
      )}
      <GroundShadow u={u} cy={140} w={46} opacity={0.34} />
      <StageParticles u={u} p={p} quality={quality} animate={animate} />
    </g>
  );
}

/* CAPSULE — starlight drop capsule with a glowing core and energy wake. */
function CapsuleArt({ u, p, quality, animate }: ArtContext) {
  const wake = quality >= 2;
  return (
    <g>
      <defs>
        <linearGradient id={`${u}-cap`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.5" stopColor={p.b} />
          <stop offset="1" stopColor={p.c} />
        </linearGradient>
        <radialGradient id={`${u}-core2`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.6" stopColor={p.a} />
          <stop offset="1" stopColor={p.b} />
        </radialGradient>
        <linearGradient id={`${u}-tr`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={p.c} stopOpacity="0" />
          <stop offset="0.7" stopColor={p.b} stopOpacity="0.45" />
          <stop offset="1" stopColor={p.a} stopOpacity="0" />
        </linearGradient>
      </defs>
      <Stage u={u} p={p} quality={quality} animate={animate} />
      {wake && <path d="M26 138 C 40 132 54 128 66 122 C 72 116 74 104 72 96 Z" fill={`url(#${u}-tr)`} opacity={0.7} />}
      <g className={animate ? 'giftfx-sway-soft' : ''}>
        <path d="M56 96 C 50 84 50 70 54 58 C 60 48 68 42 80 40 C 92 46 100 58 102 72 C 104 84 102 96 96 106 Z" fill={`url(#${u}-cap)`} stroke="#d8feff" strokeWidth={1.6} />
        <circle cx={72} cy={74} r={12} fill={`url(#${u}-core2)`} opacity={0.95} />
        <path d="M66 68 C 62 64 60 56 64 52 C 70 50 76 52 80 56" fill="#ffffff" opacity={0.8} />
        <path d="M86 46 C 92 50 94 58 92 66" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" opacity={0.45} />
        {quality >= 4 && (
          <g>
            <path d="M58 30 L66 26 L74 28" fill="none" stroke="#ffffff" strokeWidth={1.6} opacity={0.7} />
            <path d="M96 40 L104 34 L108 38" fill="none" stroke="#7fe3ff" strokeWidth={1.4} opacity={0.6} />
          </g>
        )}
      </g>
      <GroundShadow u={u} cy={140} w={36} opacity={0.3} />
      <Glint x={116} y={58} scale={1.6} color={p.a} className={animate ? 'giftfx-sparkle' : ''} />
      <StageParticles u={u} p={p} quality={quality} animate={animate} />
    </g>
  );
}
/* SPARK — infinite lightning bolt of gold fused with electric blue. */
function SparkArt({ u, p, quality, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <linearGradient id={`${u}-bolt`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.a} />
          <stop offset="0.5" stopColor={p.b} />
          <stop offset="1" stopColor={p.c} />
        </linearGradient>
      </defs>
      <Stage u={u} p={p} quality={quality} animate={animate} />
      <g className={animate ? 'giftfx-burst' : ''}>
        <path d="M80 24 L60 28 L62 36 L78 36 L74 44 L50 48 L54 58 L74 60 L76 70 L58 76 L64 84 L86 84 L84 94 L60 100 L66 108 L92 108 L88 118 L62 124 L70 134 L94 134 L90 142 L68 142 L80 144 Z" fill={`url(#${u}-bolt)`} stroke="#ffffff" strokeWidth={1.4} opacity={0.95} />
        <path d="M80 24 L60 28 L62 36 L78 36 L74 44 L50 48 L54 58 L74 60 L76 70 L58 76 L64 84 L86 84 L84 94 L60 100 L66 108 L92 108 L88 118 L62 124 L70 134 L94 134 L90 142 L68 142 L80 144 Z" fill="none" stroke="#edf9ff" strokeWidth={2.6} opacity={0.75} />
      </g>
      <GroundShadow u={u} cy={140} w={24} opacity={0.22} />
      <g>
        <Glint x={106} y={46} scale={2} color="#fff6a6" className={animate ? 'giftfx-sparkle' : ''} />
        <Glint x={48} y={64} scale={1.6} color="#19a6f0" className={animate ? 'giftfx-sparkle' : ''} style={animate ? { animationDelay: '0.5s' } as CSSProperties : undefined} />
        {quality >= 3 && <Glint x={80} y={118} scale={1.4} color="#ffffff" className={animate ? 'giftfx-sparkle' : ''} style={animate ? { animationDelay: '1s' } as CSSProperties : undefined} />}
      </g>
      <StageParticles u={u} p={p} quality={quality} animate={animate} />
    </g>
  );
}

/* SUN — golden horizon: radiant sun cresting a violet sea with warm rays. */
function SunArt({ u, p, quality, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <radialGradient id={`${u}-sun`} cx="0.42" cy="0.4" r="0.75">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.45" stopColor={p.a} />
          <stop offset="1" stopColor={p.b} />
        </radialGradient>
        <linearGradient id={`${u}-hor`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.b} stopOpacity="0.5" />
          <stop offset="1" stopColor={p.c} stopOpacity="0.25" />
        </linearGradient>
      </defs>
      <Stage u={u} p={p} quality={quality} animate={animate} />
      <g className={animate ? 'giftfx-halo' : ''}>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => {
          const a = n * 45;
          return <path key={n} d="M80 74 L142 74 L80 74 L18 74 Z" transform={`rotate(${a} 80 74)`} fill={p.a} opacity={0.13} />;
        })}
      </g>
      <circle cx={80} cy={74} r={34} fill={`url(#${u}-sun)`} stroke={p.b} strokeWidth={1.8} />
      <circle cx={80} cy={74} r={40} fill="none" stroke={p.a} strokeWidth={2.6} opacity={0.8} />
      <path d="M28 118 L132 118 L142 122 L18 122 Z" fill={`url(#${u}-hor)`} stroke="#ffffff" strokeWidth={1.4} opacity={0.9} />
      <path d="M32 122 C 48 122 64 124 80 124 C 96 124 112 122 128 122 Z" fill="none" stroke={p.a} strokeWidth={2} strokeLinecap="round" opacity={0.7} />
      <ellipse cx={78} cy={66} rx={8} ry={5} fill="#ffffff" opacity={0.9} />
      {quality >= 3 && (
        <g>
          <Glint x={120} y={40} scale={1.8} color="#ffe9a3" className={animate ? 'giftfx-sparkle' : ''} />
          <Glint x={38} y={52} scale={1.4} color="#ffffff" className={animate ? 'giftfx-sparkle' : ''} style={animate ? { animationDelay: '0.8s' } as CSSProperties : undefined} />
        </g>
      )}
      <StageParticles u={u} p={p} quality={quality} animate={animate} />
    </g>
  );
}
/* COFFEE — golden latte in a matte cup with a heart crest and warm steam. */
function CoffeeArt({ u, p, quality, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <radialGradient id={`${u}-latte`} cx="0.5" cy="0.42" r="0.6">
          <stop offset="0" stopColor="#ffe9c0" />
          <stop offset="1" stopColor="#b06a34" />
        </radialGradient>
        <linearGradient id={`${u}-cup`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={p.a} />
          <stop offset="0.5" stopColor={p.b} />
          <stop offset="1" stopColor={p.c} />
        </linearGradient>
      </defs>
      <Stage u={u} p={p} quality={quality} animate={animate} />
      <g className={animate ? 'giftfx-sway-soft' : ''}>
        <path d="M44 108 C 42 96 46 88 54 84 C 62 82 72 80 84 80 C 92 82 98 88 100 96 C 102 104 100 112 94 118 C 88 122 78 124 68 122 C 60 118 54 112 44 108 Z" fill={`url(#${u}-cup)`} stroke={p.c} strokeWidth={1.6} />
        <ellipse cx={72} cy={82} rx={28} ry={8} fill={`url(#${u}-latte)`} />
        <MiniHeart x={72} y={82} scale={2.4} color="#c8902c" />
        <path d="M54 100 C 60 92 64 86 68 82" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" opacity={0.7} />
        {quality >= 2 && (
          <g>
            <path d="M66 74 C 64 66 70 58 76 52" fill="none" stroke="#ffffff" strokeWidth={2.4} strokeLinecap="round" opacity={0.55} className={animate ? 'giftfx-float-up' : ''} style={animate ? up(4, -14, 3, 0.2) : undefined} />
            <path d="M84 74 C 86 68 82 62 80 56" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" opacity={0.4} className={animate ? 'giftfx-float-up' : ''} style={animate ? up(-4, -16, 3.4, 1) : undefined} />
          </g>
        )}
      </g>
      <GroundShadow u={u} cy={140} w={40} />
      <StageParticles u={u} p={p} quality={quality} animate={animate} />
    </g>
  );
}

/* BALLOON — glossy jewel balloon with a satin string and sparkle kiss. */
function BalloonArt({ u, p, quality, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <radialGradient id={`${u}-bln`} cx="0.38" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.5" stopColor={p.b} />
          <stop offset="1" stopColor={p.c} />
        </radialGradient>
      </defs>
      <Stage u={u} p={p} quality={quality} animate={animate} />
      <path d="M80 122 L80 138" stroke="#d8e2ff" strokeWidth={1.8} strokeLinecap="round" className={animate ? 'giftfx-sway' : ''} />
      <g className={animate ? 'giftfx-float' : ''}>
        <path d="M80 122 C 58 114 52 96 62 84 C 70 74 80 72 90 74 C 96 84 102 98 104 112 C 104 118 100 122 80 122 Z" fill={`url(#${u}-bln)`} stroke={p.c} strokeWidth={1.6} />
        <path d="M80 122 C 74 118 72 108 74 100 C 78 92 82 90 86 92 C 88 100 86 110 80 122 Z" fill={`url(#${u}-bln)`} opacity={0.85} />
        <ellipse cx={70} cy={92} rx={9} ry={13} fill="#ffffff" opacity={0.85} />
        <path d="M88 84 C 94 90 96 98 92 106" fill="none" stroke="#ffffff" strokeWidth={2.4} strokeLinecap="round" opacity={0.5} />
        <path d="M74 118 L86 118 L86 112 L96 108 L96 112 L84 114 L80 122 Z" fill={p.b} />
      </g>
      <GroundShadow u={u} cy={141} w={28} opacity={0.3} />
      <Sparkle x={104} y={66} size={2.4} color="#ffffff" className={animate ? 'giftfx-sparkle' : ''} />
      <StageParticles u={u} p={p} quality={quality} animate={animate} />
    </g>
  );
}
/* GIFTBOX — premium wrapped present with satin ribbons and a jewel bow. */
function GiftboxArt({ u, p, quality, animate }: ArtContext) {
  return (
    <g>
      <defs>
        <linearGradient id={`${u}-box`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.a} />
          <stop offset="0.55" stopColor={p.b} />
          <stop offset="1" stopColor={p.c} />
        </linearGradient>
        <linearGradient id={`${u}-lid`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe9c0" />
          <stop offset="1" stopColor={p.b} />
        </linearGradient>
      </defs>
      <Stage u={u} p={p} quality={quality} animate={animate} />
      <g className={animate ? 'giftfx-sway-soft' : ''}>
        <path d="M42 134 L42 96 L100 96 L100 134 Z" fill={`url(#${u}-box)`} stroke={p.c} strokeWidth={1.6} />
        <path d="M36 88 L104 88 L104 100 L36 100 Z" fill={`url(#${u}-lid)`} stroke="#d4a017" strokeWidth={1.4} />
        <path d="M42 134 L100 134 L100 116 L42 116 Z" fill={p.c} opacity={0.35} />
        <path d="M42 96 L100 96" stroke={p.a} strokeWidth={2.4} />
        <path d="M70 100 L70 134 L72 134 L72 100" stroke={p.a} strokeWidth={2.4} />
        <path d="M60 88 C 58 82 62 74 68 70 C 76 66 86 70 92 78 C 94 84 88 88 80 88 C 72 88 64 84 60 88 Z" fill={p.a} opacity={0.9} />
        <path d="M62 84 C 64 78 66 74 68 70 C 70 72 68 78 66 82 Z" fill="#ffffff" opacity={0.7} />
      </g>
      <GroundShadow u={u} cy={141} w={44} />
      <StageParticles u={u} p={p} quality={quality} animate={animate} />
    </g>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Registry + public render entry
   ──────────────────────────────────────────────────────────────────── */

export const GIFT_ART_SCENES: Record<GiftArtworkId, (c: ArtContext) => ReactNode> = {
  thumb: ThumbArt,
  flame: FlameArt,
  rose: RoseArt,
  heart: HeartArt,
  love: LoveArt,
  happy: HappyArt,
  teddy: TeddyArt,
  pearl: PearlArt,
  medal: MedalArt,
  diamond: DiamondArt,
  crown: CrownArt,
  car: CarArt,
  jet: JetArt,
  yacht: YachtArt,
  dragon: DragonArt,
  castle: CastleArt,
  star: StarArt,
  comet: CometArt,
  orb: OrbArt,
  ring: RingArt,
  capsule: CapsuleArt,
  spark: SparkArt,
  sun: SunArt,
  coffee: CoffeeArt,
  balloon: BalloonArt,
  giftbox: GiftboxArt,
};

/**
 * Renders the shared <g> scene for one gift. Callers wrap it in
 * <svg viewBox="0 0 160 160"> so every gift keeps the identical, consistent
 * VANTA presentation frame.
 */
export function renderGiftArtwork({ id, u, p, quality, animate }: { id: GiftArtworkId; u: string; p?: GiftPalette; quality?: number; animate?: boolean }): ReactNode {
  const scene = GIFT_ART_SCENES[id] || GiftboxArt;
  const palette = p || PALETTE_BY_ID[id] || DEFAULT_PALETTE;
  const q = Math.max(0, Math.min(5, Number.isFinite(quality) ? (quality || 0) : 0));
  return scene({ u, p: palette, quality: q, animate: Boolean(animate) });
}