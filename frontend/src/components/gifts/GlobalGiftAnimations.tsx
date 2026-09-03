'use client';

/**
 * Global gift animation host.
 * ---------------------------
 * Renders the gift overlay on EVERY app page (except the live viewer/studio
 * pages, which mount their own overlay) and receives `gift_received` events
 * delivered to the signed-in user's personal socket room — so the *recipient*
 * (and sender) see the real animated overlay in real time no matter where they
 * are, while the gift transaction/message is persisted separately by the
 * backend API. A dedicated pooled socket keeps this listener independent of
 * other consumers, and the queue de-duplicates by transaction id.
 */

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { createSocket } from '@/lib/socketClient';
import GiftAnimationOverlay, { type GiftEvent } from './GiftAnimationOverlay';
import { useGiftAnimationQueue } from './useGiftAnimationQueue';

/** Normalize any `gift_received` / `gift:received` payload into a GiftEvent. */
function toGiftEvent(payload: any): GiftEvent | null {
  if (!payload || typeof payload !== 'object') return null;
  const tx = (payload.transaction && typeof payload.transaction === 'object' ? payload.transaction : payload) || {};
  if (!tx.id || !tx.giftId) return null;
  return {
    id: tx.id,
    streamId: tx.streamId ?? payload.streamId,
    senderId: tx.senderId,
    senderName: tx.senderName || payload.senderName,
    receiverId: tx.receiverId,
    giftId: tx.giftId,
    giftSlug: tx.giftSlug ?? payload.giftSlug,
    giftName: tx.giftName || payload.giftName || 'a gift',
    amount: Number(tx.amount ?? payload.amount ?? 0),
    quantity: Number(tx.quantity || tx.comboCount || payload.quantity || payload.comboCount || 1),
    comboCount: Number(tx.comboCount || payload.comboCount || 1),
    isAnon: Boolean(tx.isAnon ?? payload.isAnon),
    isSuper: Boolean(tx.isSuper ?? payload.isSuper),
    isLegendary: Boolean(tx.isLegendary ?? payload.isLegendary),
    artworkType: tx.artworkType ?? payload.artworkType,
    rarity: tx.rarity ?? payload.rarity,
    tier: tx.tier ?? payload.tier,
    impactLevel: Number(tx.impactLevel ?? payload.impactLevel ?? 0),
    effectProfile: tx.effectProfile ?? payload.effectProfile,
    thumbnailUrl: tx.thumbnailUrl ?? payload.thumbnailUrl,
    animationUrl: tx.animationUrl ?? payload.animationUrl,
    animationType: tx.animationType ?? payload.animationType,
    glowColor: tx.glowColor ?? payload.glowColor,
    particleColor: tx.particleColor ?? payload.particleColor,
    animationDuration: Number(tx.animationDuration ?? payload.animationDuration ?? 0),
    createdAt: tx.createdAt ?? payload.createdAt,
  };
}

export default function GlobalGiftAnimations() {
  const { token, user } = useAuth();
  const pathname = usePathname();
  const { giftAnimations, enqueueGiftAnimation } = useGiftAnimationQueue();

  // The /live viewer + studio pages mount their own overlay and sockets, so the
  // global host stays quiet there to avoid double-playing the same gift.
  const onLivePage = pathname === '/live' || (pathname || '').startsWith('/live/');
  const canListen = Boolean(token && user?.id && !onLivePage);

  useEffect(() => {
    if (!canListen) return;
    const socket = createSocket(token, undefined, 'global-gift-animations');
    const handle = (payload: any) => {
      const event = toGiftEvent(payload);
      if (event) enqueueGiftAnimation(event);
    };
    // Primary channel: `gift_received` delivered to this user's personal room.
    socket.on('gift_received', handle);
    // Defensive: `gift:received` in case a future channel emits on the default ns.
    socket.on('gift:received', handle);
    socket.connect();
    return () => {
      socket.off('gift_received', handle);
      socket.off('gift:received', handle);
      socket.disconnect();
    };
  }, [canListen, enqueueGiftAnimation]);

  if (!canListen) return null;
  return <GiftAnimationOverlay events={giftAnimations} />;
}