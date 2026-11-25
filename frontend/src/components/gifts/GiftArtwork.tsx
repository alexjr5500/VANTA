'use client';

import { motion, useReducedMotion } from 'framer-motion';
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
 * Approved reference artwork takes precedence over old thumbnails; an actual animated video can be used during celebration. A failed/missing asset falls back
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
  const [failedAssetUrl, setFailedAssetUrl] = useState<string | undefined>();
  const reducedMotion = useReducedMotion();
  const motionEnabled = animate && !reducedMotion;
  const id = (slug || name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const referenceAsset = giftArtworkAsset(slug, name);
  const suppliedVideo = assetUrl && /\.(mp4|webm)(\?|$)/i.test(assetUrl);
  const preferredAsset = motionEnabled && suppliedVideo ? assetUrl : referenceAsset || assetUrl;
  const resolvedAssetUrl = preferredAsset === failedAssetUrl ? (referenceAsset !== failedAssetUrl ? referenceAsset : undefined) : preferredAsset;
  const showAsset = Boolean(resolvedAssetUrl);
  const isVideo = Boolean(resolvedAssetUrl && /\.(mp4|webm)(\?|$)/i.test(resolvedAssetUrl));

  const common = {
    initial: { y: 0, rotate: 0, scale: 1 },
    animate: motionEnabled ? { y: [0, -5, 0], rotate: [-2, 2, -2], scale: [1, 1.04, 1] } : undefined,
    transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' as const },
  };

  return (
    <motion.div {...common} className={`relative shrink-0 ${className}`} style={responsive ? { width: '100%', height: '100%' } : { width: size, height: size }}>
      {showAsset && resolvedAssetUrl ? (
        isVideo ? (
          <video
            src={resolvedAssetUrl}
            autoPlay={motionEnabled}
            loop
            muted
            playsInline
            preload={motionEnabled ? 'metadata' : 'none'}
            onError={() => setFailedAssetUrl(resolvedAssetUrl)}
            className="h-full w-full object-contain"
          />
        ) : (
          <img
            src={resolvedAssetUrl}
            alt={name || 'VANTA gift'}
            loading={motionEnabled ? 'eager' : 'lazy'}
            onError={() => setFailedAssetUrl(resolvedAssetUrl)}
            className="h-full w-full object-contain"
          />
        )
      ) : (
        <GiftArtworkUnique slug={id} name={name} size={size} quality={quality} />
      )}
    </motion.div>
  );
}
