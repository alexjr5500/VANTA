'use client';

import { motion } from 'framer-motion';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { paletteFor, renderGiftArtwork, resolveGiftArtworkId } from './GiftArtworkSvgs';

export type GiftArtworkProps = {
  slug?: string;
  name?: string;
  artworkType?: string;
  assetUrl?: string;
  size?: number;
  animate?: boolean;
  className?: string;
  /** 0-5 artistic intensity derived from the EXISTING price/rarity/impact. */
  quality?: number;
};

const GiftScene3D = dynamic(() => import('./GiftScene3D'), { ssr: false });

function key(slug = '', name = '') {
  return (slug || name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/**
 * Single render entry for EVERY gift surface in VANTA (Gift Store grid,
 * pickers, gift history, admin, realtime overlay + previews):
 *   1. If a DB assetUrl exists (image/video) it wins and fails back to SVG.
 *   2. Large hero sizes (>= 140px) render the cinematic WebGL scene.
 *   3. Everything else renders the shared premium SVG artwork library —
 *      one VANTA universe, consistent stage, quality-scaled effects.
 */
export default function GiftArtwork({ slug, name, artworkType, assetUrl, size = 120, animate = true, className = '', quality = 1 }: GiftArtworkProps) {
  const [assetFailed, setAssetFailed] = useState(false);
  const id = key(slug, name);
  const artId = resolveGiftArtworkId(slug, artworkType);
  const hue = Array.from(id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  const p = paletteFor(artId, hue);
  // Keep catalog grids GPU-light; reserve WebGL for previews and overlay hero moments.
  const useWebGl = size >= 140;
  const common = {
    initial: { y: 0, rotate: 0, scale: 1 },
    animate: animate ? { y: [0, -5, 0], rotate: [-2, 2, -2], scale: [1, 1.04, 1] } : undefined,
    transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' as const },
  };
  const svg = (
    <svg viewBox="0 0 160 160" width="100%" height="100%" aria-hidden="true" className="overflow-visible drop-shadow-[0_16px_22px_rgba(0,0,0,.45)]">
      {renderGiftArtwork({ id: artId, u: id, p, quality, animate })}
    </svg>
  );
  return (
    <motion.div {...common} className={`relative shrink-0 ${className}`} style={{ width: size, height: size }}>
      {assetUrl && !assetFailed ? (/\\.(mp4|webm)(\\?|$)/i.test(assetUrl)
        ? <video src={assetUrl} autoPlay={animate} loop muted playsInline preload={animate ? 'metadata' : 'none'} onError={() => setAssetFailed(true)} className="h-full w-full object-contain" />
        : <img src={assetUrl} alt="" loading={animate ? 'eager' : 'lazy'} onError={() => setAssetFailed(true)} className="h-full w-full object-contain" />)
        : useWebGl ? <GiftScene3D id={artId} palette={p} animate={animate} quality={quality} fallback={svg} /> : svg}
    </motion.div>
  );
}