'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Gift, Lock, Users } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import VantaCoinIcon from '@/components/ui/VantaCoinIcon';
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
    if (!token || !campaign || claiming) return;
    setClaiming(true);
    try {
      const claimed = await claimFollowerReward(token, campaign.id);
      setResult({
        rewardType: claimed.rewardType,
        coinAmount: claimed.rewardType === 'COINS' ? (claimed.rewardPerUser ?? campaign.rewardPerUser) : null,
      });
      setAvailability((current) => (current ? { ...current, available: false, reason: 'already-claimed' } : current));
      toast.success('Reward claimed 🎉');
    } catch (reason: any) {
      toast.error('Could not claim the reward', reason?.message);
      void load();
    } finally {
      setClaiming(false);
    }
  };

  const rewardLabel = (owner: { rewardType: string; rewardPerUser: number; gift?: { name?: string; emoji?: string | null } | null }) => {
    if (owner.rewardType === 'GIFT') return `${owner.gift?.emoji ?? '🎁'} ${owner.gift?.name ?? 'A gift'}`;
    return `${owner.rewardPerUser.toLocaleString()} VANTA Coins`;
  };

  // ---------- Success state (immutable claim already recorded) ----------
  if (result) {
    return (
      <section className="mx-4 mt-3 overflow-hidden rounded-2xl border border-[var(--active-border)] bg-[var(--active-soft)]" aria-live="polite">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--active)] text-[var(--active-foreground)]">
            <Gift size={18} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              {result.rewardType === 'GIFT' ? 'Gift delivered!' : `${(result.coinAmount ?? 0).toLocaleString()} coins added`}
            </p>
            <p className="text-xs text-[var(--text-secondary)]">This reward was sent straight to your wallet.</p>
          </div>
        </div>
      </section>
    );
  }

  if (loading || !availability) return null;
// ---------- Quiet unavailable states (no noise for things that don't concern us) ----------
  if (availability.reason === 'not-authenticated') {
    return (
      <section className="mx-4 mt-3 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--active-soft)] text-[var(--active)]">
            <Lock size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[var(--text-primary)]">A follower reward is waiting</p>
            <p className="text-xs text-[var(--text-muted)]">Sign in and follow @{creatorUsername} to claim it.</p>
          </div>
          <button
            className="shrink-0 rounded-xl bg-[var(--active)] px-3 py-2 text-xs font-semibold text-[var(--active-foreground)] transition-opacity hover:opacity-90"
            onClick={() => router.push(`/login?next=${encodeURIComponent(`/profile/${creatorUsername}`)}`)}
          >
            Sign in
          </button>
        </div>
      </section>
    );
  }

  if (availability.reason === 'not-following') {
    return (
      <section className="mx-4 mt-3 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--active-soft)] text-[var(--active)]">
            <Users size={15} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--text-primary)]">@{(campaign?.creatorUsername ?? creatorUsername)} rewards followers</p>
            <p className="text-xs text-[var(--text-muted)]">Follow them to unlock this reward.</p>
          </div>
        </div>
      </section>
    );
  }

  if (!availability.available || !campaign || expired) return null;

  // ---------- Claimable ----------
  return (
    <section className="mx-4 mt-3 overflow-hidden rounded-2xl border border-[var(--active-border)] bg-[var(--surface)] shadow-[var(--active-glow)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-2.5">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--active)]">
          <Gift size={12} /> Reward available
        </span>
        {campaign.expiresAt && (
          <span className="text-[10px] text-[var(--text-muted)]">
            {new Date(campaign.expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--active-soft)] text-[var(--active)]">
          {campaign.rewardType === 'COINS' ? <VantaCoinIcon size={20} /> : <Gift size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{rewardLabel(campaign)}</p>
          <p className="text-xs text-[var(--text-secondary)]">
            {campaign.claimedUsers.toLocaleString()} of {campaign.totalAllocation.toLocaleString()} claimed
            {campaign.rewardType === 'GIFT' ? ` · ${campaign.gift?.name ?? 'gift'}` : ''}
          </p>
        </div>
        {token ? (
          <button
            className="shrink-0 rounded-xl bg-[var(--active)] px-4 py-2.5 text-sm font-semibold text-[var(--active-foreground)] transition-transform active:scale-[0.98] disabled:opacity-60"
            onClick={() => void claim()}
            disabled={claiming}
          >
            {claiming ? 'Claiming…' : 'Claim'}
          </button>
        ) : (
          <button
            className="shrink-0 rounded-xl border border-[var(--active-border)] px-4 py-2.5 text-sm font-semibold text-[var(--active)] transition-colors hover:bg-[var(--active-soft)]"
            onClick={() => router.push(`/login?next=${encodeURIComponent(`/profile/${creatorUsername}`)}`)}
          >
            Sign in
          </button>
        )}
      </div>
    </section>
  );
}