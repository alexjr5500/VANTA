'use client';

import { motion } from 'framer-motion';
import { useState } from 'react';
import GiftArtworkUnique from './GiftArtworkUnique';
import { giftArtworkAsset } from './giftArtworkAssets';

export type GiftArtworkProps = {
  slug?: string;
  name?: string;
  artworkType?: string;
  assetUrl?: string;
  size?: number;
  responsive?: boolean;
  animate?: boolean;
  className?: string;
  /** 0-5 artistic intensity derived from the existing price/rarity/impact. */
  quality?: number;
};

/**
 * Shared renderer used by VANTA gift surfaces.
 * Catalog-provided media takes precedence; a failed/missing asset falls back
 * to the slug-specific artwork. This component changes presentation only.
 */
export default function GiftArtwork({
  slug,
  name,
  assetUrl,
  size = 120,
  responsive = false,
  animate = true,
  className = '',
  quality = 1,
}: GiftArtworkProps) {
  const [assetFailed, setAssetFailed] = useState(false);
  const id = (slug || name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const resolvedAssetUrl = assetUrl || giftArtworkAsset(slug, name);
  const showAsset = Boolean(resolvedAssetUrl && !assetFailed);
  const isVideo = Boolean(resolvedAssetUrl && /\.(mp4|webm)(\?|$)/i.test(resolvedAssetUrl));

  const common = {
    initial: { y: 0, rotate: 0, scale: 1 },
    animate: animate ? { y: [0, -5, 0], rotate: [-2, 2, -2], scale: [1, 1.04, 1] } : undefined,
    transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' as const },
  };

  return (
    <motion.div {...common} className={`relative shrink-0 ${className}`} style={responsive ? { width: '100%', height: '100%' } : { width: size, height: size }}>
      {showAsset && resolvedAssetUrl ? (
        isVideo ? (
          <video
            src={resolvedAssetUrl}
            autoPlay={animate}
            loop
            muted
            playsInline
            preload={animate ? 'metadata' : 'none'}
            onError={() => setAssetFailed(true)}
            className="h-full w-full object-contain"
          />
        ) : (
          <img
            src={resolvedAssetUrl}
            alt={name || 'VANTA gift'}
            loading={animate ? 'eager' : 'lazy'}
            onError={() => setAssetFailed(true)}
            className="h-full w-full object-contain"
          />
        )
      ) : (
        <GiftArtworkUnique slug={id} name={name} size={size} quality={quality} />
      )}
    </motion.div>
  );
}
