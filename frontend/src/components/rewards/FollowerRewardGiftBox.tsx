'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Gift } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import {
  claimFollowerReward,
  getRewardAvailability,
  type RewardAvailability,
} from '@/lib/followerRewardsApi';

// ============================================================================
// FOLLOWER REWARD GIFT BOX — PROFILE
// ============================================================================
// The "primary discovery" surface for Gold follower rewards: a quiet, gold
// gift box on a creator's profile that appears ONLY when there is something
// real to show the current viewer. Every claim re-validates server-side
// (follow + eligibility + immutable UNIQUE(campaignId, userId)), so this UI
// never has to guess — it paints whatever the backend authorizes.
// ============================================================================

interface Props {
  creatorUsername: string;
  token?: string | null;
}

export default function FollowerRewardGiftBox({ creatorUsername, token }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [availability, setAvailability] = useState<RewardAvailability | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [opening, setOpening] = useState(false);
  const [done, setDone] = useState(false);
  const claimLock = useRef(false);
  const [result, setResult] = useState<{ rewardType: string; coinAmount: number | null } | null>(null);

  const load = useCallback(async () => {
    if (!creatorUsername) {
      setAvailability(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await getRewardAvailability(token, creatorUsername);
      setAvailability(next);
    } catch {
      // The gift box is a quiet surface — a backend hiccup must never break a profile.
      setAvailability({ available: false, reason: null, campaign: null });
    } finally {
      setLoading(false);
    }
  }, [creatorUsername, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const campaign = availability?.campaign ?? null;
  const expired = campaign?.expiresAt ? new Date(campaign.expiresAt).getTime() < Date.now() : false;

  const claim = async () => {
    if (!token || !campaign || claiming || claimLock.current) return;
    claimLock.current = true;
    setClaiming(true);
    try {
      const claimed = await claimFollowerReward(token, campaign.id);
      setResult({
        rewardType: claimed.rewardType,
        coinAmount: claimed.rewardType === 'COINS' ? (claimed.rewardPerUser ?? campaign.rewardPerUser) : null,
      });
      setOpening(true);
      setAvailability((current) => (current ? { ...current, available: false, reason: 'already-claimed' } : current));
      toast.success('Reward claimed 🎉');
    } catch (reason: any) {
      toast.error('Could not claim the reward', reason?.message);
      void load();
    } finally {
      claimLock.current = false;
      setClaiming(false);
    }
  };

  // ---------- Opened state: box opens, then disappears ----------
  if (result || opening) {
    return (
      <div className="relative mx-4 mt-1 h-14" aria-live="polite">
        <motion.div
          className="absolute right-3 top-0 origin-top text-[var(--active)]"
          initial={{ scale: 1, rotate: 0, opacity: 1 }}
          animate={{ scale: [1, 1.25, 1.5], rotate: [0, -14, 14, -8, 0], opacity: [1, 1, 0] }}
          transition={{ duration: 1.1, ease: 'easeOut' }}
          onAnimationComplete={() => setDone(true)}
        >
          <GiftOpen />
        </motion.div>
        <span className="sr-only">{result?.rewardType === 'GIFT' ? 'Gift delivered' : `${(result?.coinAmount ?? 0).toLocaleString()} coins added`}</span>
      </div>
    );
  }

  if (done) return null;
  if (loading || !availability) return null;
  // Unavailable / not-following / signed-out-without-campaign states render nothing.
  if (availability.reason === 'not-authenticated' || availability.reason === 'not-following') return null;

  if (!availability.available || !campaign || expired) return null;

  // ---------- Claimable: only a dangling gift box ----------
  if (!token) {
    return (
      <div className="relative mx-4 mt-1 h-14">
        <button
          type="button"
          aria-label="Sign in to claim your reward"
          className="absolute right-3 top-0 origin-top text-[var(--active)] focus-visible:outline-none"
          onClick={() => router.push(`/login?next=${encodeURIComponent(`/profile/${creatorUsername}`)}`)}
        >
          <Dangle><Gift size={34} /></Dangle>
        </button>
      </div>
    );
  }
  return (
    <div className="relative mx-4 mt-1 h-14">
      <button
        type="button"
        aria-label="Claim your reward"
        className="absolute right-3 top-0 origin-top text-[var(--active)] disabled:pointer-events-none focus-visible:outline-none"
        onClick={() => void claim()}
        disabled={claiming}
      >
        <Dangle><Gift size={34} /></Dangle>
      </button>
    </div>
  );
}

function Dangle({ children }: { children: React.ReactNode }) {
  return (
    <motion.span
      className="block origin-top"
      animate={{ rotate: [-7, 7, -7] }}
      transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
    >
      <span className="mx-auto block h-3 w-px bg-[var(--active-border)]" />
      <span className="block drop-shadow-[var(--active-glow)]">{children}</span>
    </motion.span>
  );
}

function GiftOpen() {
  return (
    <span className="block">
      <span className="mx-auto block h-3 w-px bg-[var(--active-border)]" />
      <Gift size={34} />
    </span>
  );
}
