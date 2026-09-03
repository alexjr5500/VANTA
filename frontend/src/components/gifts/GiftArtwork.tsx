'use client';

import { motion } from 'framer-motion';
import dynamic from 'next/dynamic';
import { useState } from 'react';

export type GiftArtworkProps = { slug?: string; name?: string; artworkType?: string; assetUrl?: string; size?: number; animate?: boolean; className?: string };

const palette: Record<string, { a: string; b: string; c: string }> = {
  'thumbs-up': { a: '#8bf7ff', b: '#278bff', c: '#a855f7' }, fire: { a: '#fff7a0', b: '#ff6b1a', c: '#f21b68' }, rose: { a: '#ffb2cf', b: '#ed245c', c: '#72104c' }, love: { a: '#ffd1f1', b: '#ff3d9a', c: '#7628e8' }, 'happy-day': { a: '#fff27a', b: '#ffb02e', c: '#ff4d84' }, 'fancy-pearl': { a: '#ffffff', b: '#9ddfff', c: '#8559ff' }, 'first-place': { a: '#fff5a8', b: '#e4a52e', c: '#a85410' }, 'lets-ride': { a: '#b8fbff', b: '#20b9e9', c: '#4857ff' }, 'gold-medal': { a: '#fff3a0', b: '#e2a51d', c: '#8b4b0b' }, 'elite-status': { a: '#e4fbff', b: '#68b7ff', c: '#6145df' }, 'ice-diamond': { a: '#fff', b: '#69d9ff', c: '#4270ff' }, 'pure-royalty': { a: '#fff3a6', b: '#eab531', c: '#9b3bda' }, yacht: { a: '#e7ffff', b: '#1ed4ef', c: '#1760d8' }, teddy: { a: '#ffe0ad', b: '#b96a36', c: '#70402b' }, default: { a: '#f4c8ff', b: '#a855f7', c: '#ec4899' },
};

const GiftScene3D = dynamic(() => import('./GiftScene3D'), { ssr: false });

function key(slug = '', name = '') { return (slug || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }

export default function GiftArtwork({ slug, name, artworkType, assetUrl, size = 120, animate = true, className = '' }: GiftArtworkProps) {
  const [assetFailed, setAssetFailed] = useState(false);
  const id = key(slug, name); const renderId = (artworkType || id).toLowerCase();
  const hue = Array.from(id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  const p = palette[id] || { a: `hsl(${hue} 100% 86%)`, b: `hsl(${hue} 82% 57%)`, c: `hsl(${(hue + 58) % 360} 78% 46%)` };
  // Keep catalog grids GPU-light; reserve WebGL for previews and overlay hero moments.
  const useWebGl = size >= 140;
  const common = { initial: { y: 0, rotate: 0, scale: 1 }, animate: animate ? { y: [0, -5, 0], rotate: [-2, 2, -2], scale: [1, 1.04, 1] } : undefined, transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' as const } };
  const fallback = <svg viewBox="0 0 160 160" width="100%" height="100%" aria-hidden="true" className="overflow-visible drop-shadow-[0_16px_22px_rgba(0,0,0,.45)]">
      <defs><linearGradient id={`a${id}`} x1="0" y1="0" x2="1" y2="1"><stop stopColor={p.a}/><stop offset=".5" stopColor={p.b}/><stop offset="1" stopColor={p.c}/></linearGradient><radialGradient id={`g${id}`}><stop stopColor={p.a} stopOpacity=".8"/><stop offset="1" stopColor={p.b} stopOpacity="0"/></radialGradient><filter id={`f${id}`}><feGaussianBlur stdDeviation="6"/></filter></defs>
      <circle cx="80" cy="80" r="64" fill={`url(#g${id})`} filter={`url(#f${id})`} opacity=".75" />
      {renderId.includes('fire') || renderId === 'flame' ? <><path d="M82 143C38 132 46 96 72 77c-2 20 13 19 14 2 4-21 25-32 19-59 35 29 39 62 20 87-10 14-25 27-43 36Z" fill={`url(#a${id})`} stroke={p.a} strokeWidth="2"/><path d="M82 127c-20-13-12-32 4-47 0 13 10 13 13 0 9 14 10 29-17 47Z" fill={p.a} opacity=".9" /></> : renderId.includes('rose') || renderId === 'rose' ? <><path d="M80 72c-29-35 32-48 40-20 7 26-29 42-40 20Z" fill={`url(#a${id})`}/><path d="M80 68C48 55 61 28 83 43c-3-25 35-20 34 4-1 24-28 33-37 21Z" fill={p.b} opacity=".85"/><path d="M80 69v65" stroke="#41d58b" strokeWidth="7"/></> : renderId.includes('yacht') || renderId.includes('boat') ? <><path d="M26 94h108l-14 25H47Z" fill={`url(#a${id})`} stroke={p.a} strokeWidth="3"/><path d="M78 91V31l39 60M78 40 45 91" fill="none" stroke={p.a} strokeWidth="4"/><path d="M28 130c18 9 36 9 54 0 18 9 36 9 54 0" fill="none" stroke="#65f4ff" strokeWidth="4" strokeLinecap="round"/></> : renderId.includes('teddy') || renderId.includes('bear') ? <><circle cx="48" cy="46" r="19" fill={p.b}/><circle cx="112" cy="46" r="19" fill={p.b}/><circle cx="80" cy="82" r="48" fill={`url(#a${id})`} stroke={p.a} strokeWidth="3"/><circle cx="63" cy="77" r="5" fill="#3a2118"/><circle cx="97" cy="77" r="5" fill="#3a2118"/><ellipse cx="80" cy="96" rx="15" ry="11" fill="#ffe0ad"/><path d="M74 96q6 8 12 0" fill="none" stroke="#70402b" strokeWidth="3"/></> : renderId.includes('diamond') || renderId.includes('ice') || renderId === 'diamond' ? <path d="m80 12 49 47-49 88L31 59 80 12Z" fill={`url(#a${id})`} stroke={p.a} strokeWidth="3"/> : renderId.includes('crown') || renderId.includes('royalty') || renderId === 'crown' ? <path d="m25 47 30 25 25-50 25 50 30-25-12 75H37L25 47Z" fill={`url(#a${id})`} stroke={p.a} strokeWidth="3"/> : renderId.includes('heart') || renderId.includes('love') || renderId === 'heart' ? <path d="M80 137C24 104 30 57 57 48c13-4 22 3 23 13 2-10 12-17 25-13 28 9 34 56-25 89Z" fill={`url(#a${id})`} stroke={p.a} strokeWidth="3"/> : <path d="M80 18 123 55l-12 67H49L37 55 80 18Z" fill={`url(#a${id})`} stroke={p.a} strokeWidth="3"/>}
      <path d="M45 35Q65 15 88 24" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" opacity=".65" />
    </svg>;
  return <motion.div {...common} className={`relative shrink-0 ${className}`} style={{ width: size, height: size }}>
    {assetUrl && !assetFailed ? (/\.(mp4|webm)(\?|$)/i.test(assetUrl)
      ? <video src={assetUrl} autoPlay={animate} loop muted playsInline preload={animate ? 'metadata' : 'none'} onError={() => setAssetFailed(true)} className="h-full w-full object-contain" />
      : <img src={assetUrl} alt="" loading={animate ? 'eager' : 'lazy'} onError={() => setAssetFailed(true)} className="h-full w-full object-contain" />)
      : useWebGl ? <GiftScene3D id={renderId} palette={p} animate={animate} fallback={fallback} /> : fallback}
  </motion.div>;
}
