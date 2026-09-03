'use client';
import { AnimatePresence, motion } from 'framer-motion';
import GiftArtwork from './GiftArtwork';

export type GiftEvent = { id?: string; giftId?: string; giftName?: string; giftSlug?: string; artworkType?: string; amount?: number; quantity?: number; comboCount?: number; animationDuration?: number; animationType?: string; effectProfile?: string; impactLevel?: number; tier?: string; rarity?: string; glowColor?: string; particleColor?: string; animationUrl?: string; thumbnailUrl?: string; senderId?: string; senderName?: string; isLegendary?: boolean; createdAt?: string; receivedAt?: number };

export type GiftTier = 'normal' | 'premium' | 'luxury';

// Derive the celebration tier from server-authored gift metadata (tier / rarity /
// impactLevel / price) so Normal, Premium and Luxury gifts feel distinct.
export function resolveGiftTier(event: GiftEvent): GiftTier {
  const rarity = (event.rarity || '').toLowerCase();
  const tier = (event.tier || '').toLowerCase();
  const impact = event.impactLevel || 0;
  const amount = event.amount || 0;
  if (event.isLegendary || rarity === 'mythic' || rarity === 'legendary' || tier === 'high' || impact >= 4 || amount >= 1000) return 'luxury';
  if (rarity === 'rare' || impact === 3 || amount >= 250) return 'premium';
  return 'normal';
}

// Single source of truth for how long a gift animation lives on screen. Shared
// with the queue so cleanup timing and the visual transition never drift.
// Normal ~1.2-2.5s, Premium ~2-4s, Luxury ~4-8s (task animation hierarchy).
export function giftAnimationDurationMs(event: GiftEvent): number {
  const tier = resolveGiftTier(event);
  const configured = event.animationDuration && event.animationDuration > 0 ? event.animationDuration * 1000 : 0;
  const [min, max, fallback] = tier === 'luxury' ? [4000, 8000, 6000] : tier === 'premium' ? [2000, 4000, 3000] : [1200, 2500, 1800];
  return Math.min(max, Math.max(min, configured || fallback));
}

const lanes = ['left-[26%]', 'left-1/2', 'left-[74%]'];

const TIER_CONFIG: Record<GiftTier, { size: number; particles: number; ring: number; glow: number; peak: number; spin: number; rise: string; label: string }> = {
  normal: { size: 120, particles: 6, ring: 60, glow: 0.2, peak: 1, spin: 0, rise: '-18vh', label: 'text-[12px]' },
  premium: { size: 186, particles: 12, ring: 78, glow: 0.34, peak: 1.08, spin: 4, rise: '-22vh', label: 'text-[13px]' },
  luxury: { size: 264, particles: 22, ring: 96, glow: 0.52, peak: 1.16, spin: 9, rise: '-26vh', label: 'text-sm' },
};

export default function GiftAnimationOverlay({ events }: { events: GiftEvent[] }) {
  // Cap concurrent hero animations so gift spam can never destroy the live UI.
  const active = events.slice(-3);
  return <div className="pointer-events-none fixed inset-0 z-[100] overflow-hidden" aria-live="polite"><AnimatePresence>{active.map((event, i) => {
    const key = event.id || `${event.giftId}-${i}`;
    const tier = resolveGiftTier(event);
    const cfg = TIER_CONFIG[tier];
    const durationS = giftAnimationDurationMs(event) / 1000;
    const glow = event.glowColor || '#d6a83f';
    const particle = event.particleColor || '#f2c75c';
    const combo = event.comboCount || 1;
    // Prefer a real cinematic asset (WebM/Lottie/animated image) when the gift
    // ships one; GiftArtwork gracefully falls back to WebGL/SVG on failure.
    const asset = tier === 'normal' ? event.thumbnailUrl : event.animationUrl || event.thumbnailUrl;
    return <motion.div
      key={key}
      initial={{ opacity: 0, y: '26vh', x: '-50%', scale: 0.4, rotate: tier === 'normal' ? 0 : -11 }}
      animate={{ opacity: [0, 1, 1, 0], y: ['26vh', '1vh', '-5vh', cfg.rise], x: '-50%', scale: [0.4, 1, cfg.peak, tier === 'normal' ? 0.85 : 0.7], rotate: tier === 'normal' ? 0 : [-11, 0, cfg.spin * 0.4, cfg.spin] }}
      exit={{ opacity: 0, y: '-32vh', scale: tier === 'normal' ? 0.9 : 1.28 }}
      transition={{ duration: durationS, times: [0, 0.18, 0.66, 1], ease: 'easeInOut' }}
      className={`absolute top-1/2 ${lanes[i % lanes.length]} flex flex-col items-center`}
    >
      {tier === 'luxury' && <motion.div className="pointer-events-none fixed inset-0 -z-10" initial={{ opacity: 0 }} animate={{ opacity: [0, 0.55, 0.4, 0] }} transition={{ duration: durationS, times: [0, 0.2, 0.7, 1] }} style={{ background: `radial-gradient(circle at 50% 44%, ${glow}55, transparent 62%)` }} />}
      <div className="relative">
        <div className="absolute inset-0 scale-150 rounded-full blur-3xl" style={{ background: glow, opacity: cfg.glow }} />
        {Array.from({ length: cfg.particles }, (_, n) => <i key={n} className="absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full" style={{ background: particle, opacity: tier === 'normal' ? 0.75 : 0.9, transform: `rotate(${n * (360 / cfg.particles)}deg) translateY(-${cfg.ring + (n % 3) * 18}px)` }} />)}
        <GiftArtwork slug={event.giftSlug} name={event.giftName} artworkType={event.artworkType} assetUrl={asset} size={cfg.size} />
      </div>
      <div className="mt-3 max-w-[calc(100vw-24px)] rounded-full border border-white/12 bg-black/55 px-3.5 py-1.5 text-center shadow-xl backdrop-blur-md">
        <b className={`block truncate font-semibold text-white ${cfg.label}`}>
          {event.senderName || 'Someone'} <span className="font-normal text-white/60">sent</span> {event.giftName || 'a gift'}
          {combo > 1 && <strong className="ml-1.5 text-[var(--vanta-gold-bright)]">×{combo}</strong>}
        </b>
      </div>
    </motion.div>;
  })}</AnimatePresence></div>;
}
