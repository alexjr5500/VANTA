'use client';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { giftVisualQuality } from '@/lib/giftCatalog';
import GiftArtwork from './GiftArtwork';

export type GiftEvent = { id?: string; giftId?: string; giftName?: string; giftSlug?: string; streamId?: string; artworkType?: string; amount?: number; quantity?: number; comboCount?: number; animationDuration?: number; animationType?: string; effectProfile?: string; impactLevel?: number; tier?: string; rarity?: string; glowColor?: string; particleColor?: string; animationUrl?: string; thumbnailUrl?: string; senderId?: string; senderName?: string; receiverId?: string; isAnon?: boolean; isSuper?: boolean; isLegendary?: boolean; createdAt?: string; receivedAt?: number };

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

type EffectFamily = 'petal' | 'flight' | 'ocean' | 'fire' | 'cosmic' | 'crystal' | 'celebration';

export function resolveGiftEffect(slug = ''): EffectFamily {
  if (/rose|heart|butterfly|love-letter|valentine/.test(slug) && !/diamond/.test(slug)) return 'petal';
  if (/jet|shuttle|car$|motorcycle|ferrari|g-wagon|helicopter|carriage|shooting-star/.test(slug)) return 'flight';
  if (/yacht|ocean|dolphin|water-elemental|rain-cloud/.test(slug)) return 'ocean';
  if (/phoenix|fire|lightning|lion|dragon-egg|^dragon$/.test(slug)) return 'fire';
  if (/galaxy|infinity|aurora|moon|space-ring|wind-elemental|crystal-ball/.test(slug)) return 'cosmic';
  if (/diamond|crown|throne|castle|treasure|golden-key|hourglass|earth-elemental|magic/.test(slug)) return 'crystal';
  return 'celebration';
}

function particleMotion(family: EffectFamily, n: number, count: number, radius: number) {
  const angle = n * Math.PI * 2 / count;
  const x = Math.cos(angle) * radius;
  const y = Math.sin(angle) * radius;
  switch (family) {
    case 'petal': return { x: [x * .15, x * .8, x * 1.2], y: [-radius * .5, y * .45, radius * 1.2], rotate: [0, 120, 260] };
    case 'flight': return { x: [-radius * 1.3, -x * .4, radius * 1.2], y: [y * .35, y * .45, y * .25], rotate: [0, 0, 0] };
    case 'ocean': return { x: [x * .4, x, x * 1.3], y: [y * .25, -Math.abs(y), y * .7], rotate: [0, 30, 70] };
    case 'fire': return { x: [x * .15, x * .55, x * .8], y: [radius * .6, -Math.abs(y), -radius * 1.45], rotate: [0, 25, 70] };
    case 'cosmic': return { x: [x * .3, -y, -x * 1.2], y: [y * .3, x, -y * 1.2], rotate: [0, 160, 300] };
    case 'crystal': return { x: [0, x, x * 1.35], y: [0, y, y * 1.35], rotate: [45, 135, 225] };
    default: return { x: [0, x * .9, x * 1.25], y: [0, y * .8 - radius * .25, radius * .8], rotate: [0, 90, 180] };
  }
}

export default function GiftAnimationOverlay({ events }: { events: GiftEvent[] }) {
  const reducedMotion = useReducedMotion();
  // Cap concurrent hero animations so gift spam can never destroy the live UI.
  const active = events.slice(-3);
  return <div className="pointer-events-none fixed inset-0 z-[100] overflow-hidden" aria-live="polite"><AnimatePresence>{active.map((event, i) => {
    const key = event.id || `${event.giftId}-${i}`;
    const tier = resolveGiftTier(event);
    const cfg = TIER_CONFIG[tier];
    const family = resolveGiftEffect(event.giftSlug || event.giftName?.toLowerCase().replace(/\s+/g, '-'));
    const heroSize = tier === 'luxury' && (event.impactLevel || 0) >= 5 ? 300 : cfg.size;
    const durationS = giftAnimationDurationMs(event) / 1000;
    const glow = event.glowColor || '#d6a83f';
    const particle = event.particleColor || '#f2c75c';
    const combo = event.comboCount || 1;
    // Prefer a real cinematic asset (WebM/Lottie/animated image) when the gift
    // ships one; GiftArtwork gracefully falls back to WebGL/SVG on failure.
    const asset = tier === 'normal' ? event.thumbnailUrl : event.animationUrl || event.thumbnailUrl;
    return <motion.div
      key={key}
      initial={reducedMotion ? { opacity: 0, x: '-50%' } : { opacity: 0, y: '26vh', x: '-50%', scale: 0.4, rotate: tier === 'normal' ? 0 : -11 }}
      animate={reducedMotion ? { opacity: [0, 1, 1, 0], x: '-50%' } : { opacity: [0, 1, 1, 0], y: ['26vh', '1vh', '-5vh', cfg.rise], x: '-50%', scale: [0.4, 1, cfg.peak, tier === 'normal' ? 0.85 : 0.7], rotate: tier === 'normal' ? 0 : [-11, 0, cfg.spin * 0.4, cfg.spin] }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: '-32vh', scale: tier === 'normal' ? 0.9 : 1.28 }}
      transition={{ duration: durationS, times: [0, 0.18, 0.66, 1], ease: 'easeInOut' }}
      className={`absolute top-1/2 ${lanes[i % lanes.length]} flex flex-col items-center`}
    >
      {tier === 'luxury' && <motion.div className="pointer-events-none fixed inset-0 -z-10" initial={{ opacity: 0 }} animate={{ opacity: [0, 0.55, 0.4, 0] }} transition={{ duration: durationS, times: [0, 0.2, 0.7, 1] }} style={{ background: `radial-gradient(circle at 50% 44%, ${glow}55, transparent 62%)` }} />}
      <div className="relative">
        <div className="absolute inset-0 scale-150 rounded-full blur-3xl" style={{ background: glow, opacity: cfg.glow }} />
        {!reducedMotion && Array.from({ length: cfg.particles }, (_, n) => {
          const particleSize = family === 'petal' ? 7 : family === 'flight' ? 3 : 5;
          return <motion.i key={n} aria-hidden="true" className="absolute left-1/2 top-1/2"
            style={{ width: family === 'flight' ? particleSize * 5 : particleSize, height: particleSize, background: particle, borderRadius: family === 'crystal' ? 1 : family === 'petal' ? '70% 25%' : '999px', boxShadow: '0 0 8px ' + particle }}
            initial={{ opacity: 0, scale: .3 }}
            animate={{ ...particleMotion(family, n, cfg.particles, cfg.ring + (n % 3) * 14), opacity: [0, .85, 0], scale: [.3, 1, .2] }}
            transition={{ duration: Math.min(durationS, 3.5), delay: (n % 5) * .06, ease: 'easeOut' }} />;
        })}
        <GiftArtwork slug={event.giftSlug} name={event.giftName} artworkType={event.artworkType} assetUrl={asset} size={heroSize} animate={!reducedMotion} quality={giftVisualQuality({ price: event.amount, rarity: event.rarity, impactLevel: event.impactLevel, isLegendary: event.isLegendary })} />
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
