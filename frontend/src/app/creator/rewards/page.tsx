"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Coins, Gift, History, Lock, Pause, Play, Plus, Square, Users, ChevronDown, ExternalLink,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { apiGet } from '@/lib/apiClient';
import {
  createFollowerRewardCampaign,
  getFollowerRewardClaims,
  getFollowerRewardDashboard,
  endFollowerRewardCampaign,
  pauseFollowerRewardCampaign,
  resumeFollowerRewardCampaign,
  type CreateFollowerRewardInput,
  type FollowerRewardCampaign,
  type FollowerRewardType,
  type FollowerRewardEligibility,
  type RewardClaimsPage,
} from '@/lib/followerRewardsApi';
import VantaCoinIcon from '@/components/ui/VantaCoinIcon';

// ============================================================================
// FOLLOWER REWARDS — CREATOR STUDIO
// ============================================================================
// Gold-only campaign manager: reserve coins (or fund a catalog gift) in an
// atomic, fully-ledgered campaign. The backend re-validates the Gold gate and
// wallet availability on every call; this page is a thin typed client that
// also pre-validates the divide-evenly coin rule before submit.
// ============================================================================

const EXPIRY_OPTIONS = [
  { hours: 24, label: '24 hours' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '7 days' },
  { hours: 720, label: '30 days' },
] as const;

const ELIGIBILITY_LABELS: Record<FollowerRewardEligibility, { label: string; hint: string }> = {
  NEW: { label: 'New followers', hint: 'People who followed after launch' },
  EXISTING: { label: 'Existing followers', hint: 'People who followed before launch' },
  ALL: { label: 'All followers', hint: 'Everyone currently following' },
};

interface GiftOption {
  id: string;
  name: string;
  emoji?: string | null;
  price: number;
  thumbnailUrl?: string | null;
}

function coin(number: number): string {
  return Number(number || 0).toLocaleString();
}

export default function CreatorRewardsPage() {
  const { token } = useAuth();
  const toast = useToast();
  const [dashboard, setDashboard] = useState<Awaited<ReturnType<typeof getFollowerRewardDashboard>> | null>(null);
  const [gifts, setGifts] = useState<GiftOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [goldRequired, setGoldRequired] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Create form state
  const [rewardType, setRewardType] = useState<FollowerRewardType>('COINS');
  const [eligibilityType, setEligibilityType] = useState<FollowerRewardEligibility>('ALL');
  const [targetUsers, setTargetUsers] = useState(100);
  const [totalCoins, setTotalCoins] = useState(1000);
  const [giftId, setGiftId] = useState('');
  const [expiresInHours, setExpiresInHours] = useState<number>(168);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(() => setReloadKey((value) => value + 1), []);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    setGoldRequired(false);
    Promise.all([
      getFollowerRewardDashboard(token),
      apiGet<any>('/api/monetization/gifts', token, { skipCache: true }).catch(() => []),
    ])
      .then(([data, catalog]) => {
        if (!active) return;
        setDashboard(data);
        const list = Array.isArray(catalog)
          ? catalog
          : Array.isArray((catalog as any)?.gifts)
            ? (catalog as any).gifts
            : [];
        setGifts(
          (list as any[])
            .filter((gift: any) => gift && gift.id && Number(gift.price) > 0)
            .map((gift: any) => ({
              id: gift.id,
              name: gift.name || gift.id,
              emoji: gift.emoji ?? null,
              price: Number(gift.price),
              thumbnailUrl: gift.thumbnailUrl ?? gift.image ?? null,
            })),
        );
      })
      .catch((reason: any) => {
        if (!active) return;
        if (reason?.data?.code === 'GOLD_REQUIRED' || reason?.statusCode === 403) {
          setGoldRequired(true);
        } else {
          toast.error('Could not load rewards dashboard', reason?.message);
        }
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [token, reloadKey, toast]);

  const active = dashboard?.activeCampaign ?? null;
  const wallet = dashboard?.wallet ?? { coinBalance: 0, lockedCoins: 0, availableCoins: 0 };
  const history = dashboard?.history ?? [];
// ---------- Validation + preview ----------
  const divideError = useMemo(() => {
    if (rewardType !== 'COINS') return '';
    const users = Math.floor(Number(targetUsers) || 0);
    const coins = Math.floor(Number(totalCoins) || 0);
    if (users < 1) return 'Target at least 1 follower.';
    if (coins < 1) return 'Total coins must be a positive whole number.';
    if (coins % users !== 0) return `${coin(coins)} does not divide evenly across ${coin(users)} followers.`;
    return '';
  }, [rewardType, targetUsers, totalCoins]);

  const perUserPreview = useMemo(() => {
    if (rewardType === 'GIFT') {
      const gift = gifts.find((item) => item.id === giftId);
      return gift ? `${gift.price.toLocaleString()} coins each · ${(gift.price * (Math.floor(Number(targetUsers)) || 0)).toLocaleString()} total` : 'Select a gift';
    }
    if (divideError) return '';
    const users = Math.floor(Number(targetUsers)) || 0;
    const coins = Math.floor(Number(totalCoins)) || 0;
    return users > 0 ? `${coin(coins / users)} coins × ${coin(users)} followers · ${coin(coins)} total` : '';
  }, [divideError, gifts, giftId, rewardType, targetUsers, totalCoins]);

  const create = async () => {
    if (!token || creating) return;
    if (rewardType === 'GIFT' && !giftId) {
      toast.error('Choose the gift each follower will receive');
      return;
    }
    const input: CreateFollowerRewardInput = {
      rewardType,
      eligibilityType,
      targetUsers: Math.floor(Number(targetUsers) || 0),
      expiresInHours: Number(expiresInHours) || 24,
    };
    if (rewardType === 'COINS') {
      if (divideError) { toast.error(divideError); return; }
      input.totalCoins = Math.floor(Number(totalCoins) || 0);
    } else {
      input.giftId = giftId;
    }
    setCreating(true);
    try {
      await createFollowerRewardCampaign(token, input);
      toast.success('Follower reward is live 🎉');
      reload();
    } catch (reason: any) {
      toast.error('Could not start the reward', reason?.message);
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return <div className="mx-auto w-full max-w-2xl px-4"><RewardsSkeleton /></div>;
  }

  if (goldRequired) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4">
        <section className="mt-6 overflow-hidden rounded-2xl border border-[var(--active-border)] bg-[var(--surface)]">
          <div className="px-5 py-6 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[var(--active-soft)] text-[var(--active)]">
              <Lock size={22} />
            </span>
            <h1 className="mt-3 text-lg font-semibold text-[var(--text-primary)]">Follower Rewards is Gold-only</h1>
            <p className="mx-auto mt-1 max-w-sm text-sm text-[var(--text-secondary)]">
              Reserve coins or catalog gifts for your followers. This creator capability unlocks with an active Gold Verified badge.
            </p>
            <Link href="/creator/upgrade" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[var(--active)] px-4 py-2.5 text-sm font-semibold text-[var(--active-foreground)] transition-opacity hover:opacity-90">
              Upgrade to Gold <ExternalLink size={14} />
            </Link>
          </div>
        </section>
      </div>
    );
  }
return (
    <div className="mx-auto w-full max-w-2xl px-4">
      <header className="flex items-center justify-between gap-3 pt-6 pb-4">
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Follower Rewards</h1>
          <p className="text-sm text-[var(--text-secondary)]">Reserve coins or gifts for your followers — claims are immutable and fully ledgered.</p>
        </div>
      </header>

      <section className="mb-4 grid grid-cols-3 gap-2">
        <StatCard label="Available" value={coin(wallet.availableCoins)} accent />
        <StatCard label="Reserved" value={coin(wallet.lockedCoins)} />
        <StatCard label="Balance" value={coin(wallet.coinBalance)} />
      </section>

      {active && <ActiveCampaignCard campaign={active} token={token} onChanged={reload} />}

      {!active && (
        <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
            <Plus size={15} className="text-[var(--active)]" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Start a follower reward</h2>
          </div>
          <div className="space-y-4 px-4 py-4">
            <div className="grid grid-cols-2 gap-2">
              {(['COINS', 'GIFT'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setRewardType(type)}
                  className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                    rewardType === type
                      ? 'border-[var(--active-border)] bg-[var(--active-soft)] text-[var(--active)]'
                      : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]'
                  }`}
                >
                  {type === 'COINS' ? <Coins size={15} /> : <Gift size={15} />}
                  {type === 'COINS' ? 'VANTA Coins' : 'A Gift'}
                </button>
              ))}
            </div>

            <div>
              <p className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Who can claim</p>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(ELIGIBILITY_LABELS) as FollowerRewardEligibility[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setEligibilityType(key)}
                    className={`rounded-xl border px-2 py-2 text-xs font-medium transition-colors ${
                      eligibilityType === key
                        ? 'border-[var(--active-border)] bg-[var(--active-soft)] text-[var(--active)]'
                        : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]'
                    }`}
                  >
                    {ELIGIBILITY_LABELS[key].label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">{ELIGIBILITY_LABELS[eligibilityType].hint}</p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="target-users" className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)]">
                  <Users size={12} /> Follower slots
                </label>
                <input
                  id="target-users"
                  type="number"
                  min={1}
                  max={1000000}
                  value={targetUsers}
                  onChange={(event) => setTargetUsers(Number(event.target.value))}
                  className="w-full rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--active-border)]"
                />
              </div>
              <div>
                <label htmlFor="reward-alloc" className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)]">
                  {rewardType === 'COINS' ? (<><Coins size={12} /> Total coins</>) : (<><Gift size={12} /> Gift</>)}
                </label>
                {rewardType === 'COINS' ? (
                  <input
                    id="reward-alloc"
                    type="number"
                    min={1}
                    max={100000000}
                    value={totalCoins}
                    onChange={(event) => setTotalCoins(Number(event.target.value))}
                    className="w-full rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--active-border)]"
                  />
                ) : (
                  <select
                    id="reward-alloc"
                    value={giftId}
                    onChange={(event) => setGiftId(event.target.value)}
                    className="w-full rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--active-border)]"
                  >
                    <option value="">Select a gift…</option>
                    {gifts.map((gift) => (
                      <option key={gift.id} value={gift.id}>
                        {gift.emoji ? `${gift.emoji} ` : ''}{gift.name} · {gift.price.toLocaleString()} coins
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {divideError && <p className="text-xs text-red-400">{divideError}</p>}
            {perUserPreview && !divideError && <p className="text-xs text-[var(--text-secondary)]">{perUserPreview}</p>}

            <div>
              <p className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Offer expires in</p>
              <div className="flex flex-wrap gap-2">
                {EXPIRY_OPTIONS.map((option) => (
                  <button
                    key={option.hours}
                    type="button"
                    onClick={() => setExpiresInHours(option.hours)}
                    className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${
                      expiresInHours === option.hours
                        ? 'border-[var(--active-border)] bg-[var(--active-soft)] text-[var(--active)]'
                        : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => void create()}
              disabled={creating || (rewardType === 'GIFT' && !giftId)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--active)] px-4 py-3 text-sm font-semibold text-[var(--active-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {creating ? 'Reserving…' : `Launch ${rewardType === 'COINS' ? 'coins' : 'gift'} reward`}
            </button>
          </div>
        </section>
      )}
{history.length > 0 && (
        <section className="mt-5">
          <div className="mb-2 flex items-center gap-2 px-1">
            <History size={14} className="text-[var(--text-muted)]" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">History</h2>
          </div>
          <div className="space-y-2">
            {history.map((campaign) => (
              <div key={campaign.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                    {campaign.rewardType === 'COINS'
                      ? `${coin(campaign.rewardPerUser)} coins × ${coin(campaign.totalAllocation)}`
                      : `Gift · ${campaign.gift?.name ?? 'catalog gift'}`}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {campaign.claimedUsers.toLocaleString()} claimed · {campaign.status.toLowerCase()}
                    {campaign.endedAt ? ` · ended ${new Date(campaign.endedAt).toLocaleDateString()}` : ''}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${statusChip(campaign.status)}`}>
                  {campaign.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ============================================================================
// HELPERS
// ============================================================================

function RewardsSkeleton() {
  return (
    <div className="mt-6 space-y-3">
      <div className="h-6 w-48 animate-pulse rounded-lg bg-white/[0.06]" />
      <div className="grid grid-cols-3 gap-2">
        {[1, 2, 3].map((item) => <div key={item} className="h-16 animate-pulse rounded-2xl bg-white/[0.06]" />)}
      </div>
      <div className="h-72 animate-pulse rounded-2xl bg-white/[0.06]" />
    </div>
  );
}

function StatCard({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
      <p className={`mt-0.5 flex items-center gap-1 text-base font-semibold ${accent ? 'text-[var(--active)]' : 'text-[var(--text-primary)]'}`}>
        <VantaCoinIcon size={13} /> <span className="truncate">{value}</span>
      </p>
    </div>
  );
}

function statusChip(status: string): string {
  switch (status) {
    case 'ACTIVE': return 'bg-emerald-500/15 text-emerald-300';
    case 'PAUSED': return 'bg-amber-500/15 text-amber-300';
    case 'COMPLETED': return 'bg-sky-500/15 text-sky-300';
    case 'EXPIRED': return 'bg-orange-500/15 text-orange-300';
    default: return 'bg-white/[0.06] text-[var(--text-secondary)]';
  }
}
// ----------------------------------------------------------------------------
// ACTIVE CAMPAIGN CARD (live progress + controls + claim ledger)
// ----------------------------------------------------------------------------

function ActiveCampaignCard({ campaign, token, onChanged }: { campaign: FollowerRewardCampaign; token: string | null; onChanged: () => void }) {
  const toast = useToast();
  const [claims, setClaims] = useState<RewardClaimsPage | null>(null);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const loadClaims = useCallback(async (page = 1) => {
    if (!token) return;
    try {
      setClaims(await getFollowerRewardClaims(token, campaign.id, page, 25));
    } catch (reason: any) {
      toast.error('Could not load claims', reason?.message);
    }
  }, [campaign.id, token, toast]);

  const run = async (action: string, operation: () => Promise<unknown>) => {
    if (!token || busy) return;
    setBusy(action);
    try {
      await operation();
      toast.success(action === 'pause' ? 'Reward paused' : action === 'resume' ? 'Reward resumed' : 'Reward ended');
      onChanged();
    } catch (reason: any) {
      toast.error('Action failed', reason?.message);
    } finally {
      setBusy(null);
    }
  };

  const progress = campaign.computed?.progressPct ?? 0;
  const paused = campaign.status === 'PAUSED';

  return (
    <section className="mb-4 overflow-hidden rounded-2xl border border-[var(--active-border)] bg-[var(--surface)] shadow-[var(--active-glow)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--active-soft)] text-[var(--active)]">
            {campaign.rewardType === 'COINS' ? <Coins size={16} /> : <Gift size={16} />}
          </span>
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              {campaign.rewardType === 'COINS'
                ? `${coin(campaign.rewardPerUser)} coins per follower`
                : `Gift · ${campaign.gift?.name ?? 'catalog gift'}`}
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              {paused ? 'Paused' : 'Active'} · expires {campaign.expiresAt ? new Date(campaign.expiresAt).toLocaleDateString() : '—'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50"
            disabled={!!busy}
            onClick={() => void run(paused ? 'resume' : 'pause', paused ? () => resumeFollowerRewardCampaign(token!, campaign.id) : () => pauseFollowerRewardCampaign(token!, campaign.id))}
          >
            {paused ? <Play size={13} className="inline" /> : <Pause size={13} className="inline" />} {paused ? 'Resume' : 'Pause'}
          </button>
          <button
            type="button"
            className="rounded-lg border border-red-500/25 px-2.5 py-1.5 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/10 disabled:opacity-50"
            disabled={!!busy}
            onClick={() => void run('end', () => endFollowerRewardCampaign(token!, campaign.id))}
          >
            <Square size={12} className="inline" /> End
          </button>
        </div>
      </div>

      <div className="px-4 py-3.5">
        <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
          <span>{campaign.claimedUsers.toLocaleString()} of {campaign.totalAllocation.toLocaleString()} claimed</span>
          <span>{campaign.computed.availableClaims.toLocaleString()} left</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full rounded-full bg-[var(--active)]" style={{ width: `${Math.max(2, Math.min(100, progress))}%` }} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--text-muted)]">
          <span>{coin(campaign.distributedAmount)} / {coin(campaign.reservedAmount)} coins delivered</span>
          <span>{campaign.rewardType === 'GIFT' ? `${coin(campaign.rewardPerUser)} coins per gift` : `${coin(campaign.rewardPerUser)} each`}</span>
        </div>
      </div>

      <button
        type="button"
        className="flex w-full items-center justify-center gap-1.5 border-t border-[var(--border)] px-4 py-2.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)]"
        onClick={() => {
          const next = !ledgerOpen;
          setLedgerOpen(next);
          if (next && !claims) void loadClaims(1);
        }}
      >
        <ChevronDown size={14} className={`transition-transform ${ledgerOpen ? 'rotate-180' : ''}`} />
        Claim ledger
      </button>
{ledgerOpen && (
        <div className="border-t border-[var(--border)] bg-black/20 px-3 py-3">
          {claims ? (
            claims.claims.length > 0 ? (
              <ul className="space-y-1.5">
                {claims.claims.map((claim) => (
                  <li key={claim.id} className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.03] px-2.5 py-2">
                    <span className="truncate text-xs font-medium text-[var(--text-primary)]">
                      {claim.user?.username || 'Anonymous'}{claim.user?.fullName ? ` · ${claim.user.fullName}` : ''}
                    </span>
                    <span className="shrink-0 text-[11px] text-[var(--text-muted)]">
                      {claim.rewardType === 'COINS'
                        ? `+${coin(claim.coinAmount ?? 0)} coins`
                        : claim.giftSnapshot?.name ?? 'gift'}
                      <span className="ml-2">{new Date(claim.createdAt).toLocaleDateString()}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-2 text-center text-xs text-[var(--text-muted)]">No claims yet.</p>
            )
          ) : (
            <p className="py-2 text-center text-xs text-[var(--text-muted)]">Loading ledger…</p>
          )}
          {claims && claims.pages > 1 && (
            <div className="mt-2 flex items-center justify-center gap-2">
              {Array.from({ length: Math.min(claims.pages, 5) }, (_, index) => index + 1).map((page) => (
                <button
                  key={page}
                  type="button"
                  className={`grid h-7 w-7 place-items-center rounded-lg text-xs ${
                    claims.page === page
                      ? 'bg-[var(--active)] text-[var(--active-foreground)]'
                      : 'text-[var(--text-muted)] hover:bg-[var(--surface-hover)]'
                  }`}
                  onClick={() => void loadClaims(page)}
                >
                  {page}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}