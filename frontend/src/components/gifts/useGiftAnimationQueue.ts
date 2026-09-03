'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { giftAnimationDurationMs, type GiftEvent } from './GiftAnimationOverlay';

const COMBO_WINDOW_MS = 4_000;
const SEEN_TTL_MS = 60_000;

export function useGiftAnimationQueue() {
  const [events, setEvents] = useState<GiftEvent[]>([]);
  const seen = useRef(new Map<string, number>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const remove = useCallback((id: string) => {
    setEvents(current => current.filter(event => event.id !== id));
    timers.current.delete(id);
  }, []);

  const enqueue = useCallback((payload: any) => {
    const incoming = (payload?.transaction || payload) as GiftEvent;
    const id = incoming.id || `${incoming.giftId}-${incoming.senderId || incoming.senderName}-${incoming.createdAt || Date.now()}`;
    const now = Date.now();
    if (seen.current.has(id)) return;
    seen.current.set(id, now);
    for (const [key, timestamp] of seen.current) if (now - timestamp > SEEN_TTL_MS) seen.current.delete(key);

    let displayId = id;
    setEvents(current => {
      const comboIndex = current.findIndex(event =>
        event.giftId === incoming.giftId && event.senderId === incoming.senderId && now - (event.receivedAt || 0) <= COMBO_WINDOW_MS,
      );
      if (comboIndex < 0) return [...current.slice(-7), { ...incoming, id, receivedAt: now, comboCount: Math.max(1, incoming.comboCount || incoming.quantity || 1) }];
      const next = [...current];
      displayId = next[comboIndex].id || id;
      next[comboIndex] = { ...next[comboIndex], amount: (next[comboIndex].amount || 0) + (incoming.amount || 0), comboCount: (next[comboIndex].comboCount || 1) + (incoming.comboCount || incoming.quantity || 1), receivedAt: now };
      return next;
    });

    // Cleanup timing mirrors the overlay's tier-aware duration so a completed
    // animation always unmounts (Normal ~1.2-2.5s, Premium ~2-4s, Luxury ~4-8s).
    // Re-arming on each combo hit keeps an active combo on screen.
    const previousTimer = timers.current.get(displayId);
    if (previousTimer) clearTimeout(previousTimer);
    const duration = giftAnimationDurationMs(incoming);
    timers.current.set(displayId, setTimeout(() => remove(displayId), duration));
  }, [remove]);

  useEffect(() => () => { for (const timer of timers.current.values()) clearTimeout(timer); }, []);
  return { giftAnimations: events, enqueueGiftAnimation: enqueue };
}