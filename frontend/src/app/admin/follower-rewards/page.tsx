"use client";

import { useCallback, useEffect, useState } from 'react';
import { Coins, Gift, Search, TrendingUp, Users, Wallet, ChevronRight, XCircle, CheckCircle, PauseCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  getAdminFollowerRewardStats,
  listAdminFollowerRewardCampaigns,
  getAdminFollowerRewardClaims,
  getAdminFollowerRewardTransactions,
  type FollowerRewardAdminStats,
  type FollowerRewardCampaign,
  type RewardClaimsPage,
  type FollowerRewardTransactionRow,
} from '@/lib/followerRewardsApi';

// ============================================================================
// FOLLOWER REWARDS — ADMIN (read-only audit + real-data dashboards)
// ============================================================================

function coin(number: number): string {
  return Number(number || 0).toLocaleString();
}

function statusChip(status: string): string {
  switch (status) {
    case 'ACTIVE': return 'bg-emerald-500/15 text-emerald-300';
    case 'PAUSED': return 'bg-amber-500/15 text-amber-300';
    case 'COMPLETED': return 'bg-sky-500/15 text-sky-300';
    case 'EXPIRED': return 'bg-orange-500/15 text-orange-300';
    case 'ENDED': return 'bg-white/[0.08] text-gray-300';
    default: return 'bg-white/[0.06] text-gray-400';
  }
}

export default function AdminFollowerRewardsPage() {
  const { token } = useAuth();
  const [stats, setStats] = useState<FollowerRewardAdminStats | null>(null);
  const [campaigns, setCampaigns] = useState<FollowerRewardCampaign[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<FollowerRewardCampaign | null>(null);
  const [claims, setClaims] = useState<RewardClaimsPage | null>(null);
  const [transactions, setTransactions] = useState<FollowerRewardTransactionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const reloadCampaigns = useCallback(async () => {
    if (!token) return;
    try {
      const result = await listAdminFollowerRewardCampaigns(token, {
        search: search || undefined,
        rewardType: typeFilter || undefined,
        status: statusFilter || undefined,
        page,
        limit: 25,
      });
      setCampaigns(result.campaigns);
      setTotal(result.total);
    } catch (reason: any) {
      console.error('[admin follower-rewards] Failed to load campaigns', reason);
    }
  }, [token, search, typeFilter, statusFilter, page]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([getAdminFollowerRewardStats(token), listAdminFollowerRewardCampaigns(token, { page, limit: 25 })])
      .then(([statsData, campaignsData]) => {
        setStats(statsData);
        setCampaigns(campaignsData.campaigns);
        setTotal(campaignsData.total);
      })
      .catch((reason: any) => console.error('[admin follower-rewards] Failed to load dashboard', reason))
      .finally(() => setLoading(false));
  }, [token]); // initial load only (filters re-fetch via reloadCampaigns)

  useEffect(() => {
    if (!campaigns.length && !loading) return;
    const timer = setTimeout(() => { void reloadCampaigns(); }, 200);
    return () => clearTimeout(timer);
  }, [search, typeFilter, statusFilter, page, reloadCampaigns, campaigns.length, loading]);

  const openDetail = async (campaign: FollowerRewardCampaign) => {
    if (!token) return;
    setSelected(campaign);
    setClaims(null);
    setTransactions([]);
    try {
      const [claimsData, txData] = await Promise.all([
        getAdminFollowerRewardClaims(token, campaign.id),
        getAdminFollowerRewardTransactions(token, campaign.id),
      ]);
      setClaims(claimsData);
      setTransactions(txData.transactions);
    } catch (reason: any) {
      console.error('[admin follower-rewards] Failed to load detail', reason);
    }
  };
const statsCards = [
    { label: 'Active campaigns', value: stats ? `${stats.activeCampaigns}` : '—', icon: TrendingUp, tone: 'text-emerald-300' },
    { label: 'Paused', value: stats ? `${stats.pausedCampaigns}` : '—', icon: PauseCircle, tone: 'text-amber-300' },
    { label: 'Reserved (coins)', value: stats ? coin(stats.coinsReserved) : '—', icon: Wallet, tone: 'text-sky-300' },
    { label: 'Distributed', value: stats ? coin(stats.coinsDistributed) : '—', icon: Coins, tone: 'text-[#e6c34a]' },
    { label: 'Claims', value: stats ? `${stats.totalClaims}` : '—', icon: Users, tone: 'text-violet-300' },
    { label: 'Gifts sent', value: stats ? `${stats.giftsDistributed}` : '—', icon: Gift, tone: 'text-pink-300' },
  ];

  return (
    <div className="lg:pl-0">
      <div className="mb-4 flex items-start justify-between gap-3 px-1">
        <div>
          <h1 className="text-lg font-semibold text-white">Follower Rewards</h1>
          <p className="text-sm text-gray-400">Gold creator reward campaigns · immutable claim ledger · audit transactions.</p>
        </div>
        {stats && (
          <div className="hidden items-center gap-2 text-xs text-gray-400 sm:flex">
            <CheckCircle size={13} className="text-emerald-400" /> {stats.completedCampaigns} completed
            <XCircle size={13} className="text-orange-400" /> {stats.expiredCampaigns} expired
          </div>
        )}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {statsCards.map((card) => (
          <div key={card.label} className="rounded-xl border border-white/[0.08] bg-[#0d0d0f] px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-gray-500"><card.icon size={12} /> {card.label}</p>
            <p className={`mt-1 text-lg font-semibold ${card.tone}`}>{card.value}</p>
          </div>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative flex min-w-[200px] flex-1 items-center">
          <Search size={14} className="pointer-events-none absolute left-3 text-gray-500" />
          <input
            type="search"
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            placeholder="Search campaign or creator…"
            className="w-full rounded-xl border border-white/[0.08] bg-[#0d0d0f] py-2 pl-9 pr-3 text-sm text-white outline-none focus:border-[#c9a227]/40"
          />
        </label>
        <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}
          className="rounded-xl border border-white/[0.08] bg-[#0d0d0f] px-3 py-2 text-sm text-gray-300 outline-none focus:border-[#c9a227]/40">
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="PAUSED">Paused</option>
          <option value="COMPLETED">Completed</option>
          <option value="EXPIRED">Expired</option>
          <option value="ENDED">Ended</option>
        </select>
        <select value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setPage(1); }}
          className="rounded-xl border border-white/[0.08] bg-[#0d0d0f] px-3 py-2 text-sm text-gray-300 outline-none focus:border-[#c9a227]/40">
          <option value="">All rewards</option>
          <option value="COINS">Coins</option>
          <option value="GIFT">Gift</option>
        </select>
      </div>
{loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((item) => <div key={item} className="h-14 animate-pulse rounded-xl bg-white/[0.04]" />)}
        </div>
      ) : campaigns.length === 0 ? (
        <div className="rounded-xl border border-white/[0.08] bg-[#0d0d0f] px-4 py-10 text-center text-sm text-gray-500">No follower reward campaigns found.</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#0d0d0f]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-white/[0.08] text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Creator</th>
                  <th className="px-3 py-2.5 font-medium">Reward</th>
                  <th className="px-3 py-2.5 font-medium">Eligibility</th>
                  <th className="px-3 py-2.5 font-medium">Allocation</th>
                  <th className="px-3 py-2.5 font-medium">Claims</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Expires</th>
                  <th className="px-2 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.id} className="cursor-pointer border-b border-white/[0.04] transition-colors hover:bg-white/[0.03]"
                    onClick={() => void openDetail(campaign)}>
                    <td className="px-3 py-2.5 font-medium text-white">{campaign.creatorUsername || campaign.creatorId.slice(0, 8)}</td>
                    <td className="px-3 py-2.5 text-gray-300">
                      {campaign.rewardType === 'COINS'
                        ? `${coin(campaign.rewardPerUser)} coins`
                        : `🎁 ${campaign.gift?.name ?? 'gift'}`}
                    </td>
                    <td className="px-3 py-2.5 text-gray-400">{campaign.eligibilityType}</td>
                    <td className="px-3 py-2.5 text-gray-300">{coin(campaign.totalAllocation)} slots</td>
                    <td className="px-3 py-2.5 text-gray-300">{campaign.claimedUsers.toLocaleString()}</td>
                    <td className="px-3 py-2.5"><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusChip(campaign.status)}`}>{campaign.status}</span></td>
                    <td className="px-3 py-2.5 text-gray-400">{campaign.expiresAt ? new Date(campaign.expiresAt).toLocaleDateString() : '—'}</td>
                    <td className="px-2 py-2.5 text-gray-500"><ChevronRight size={14} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] px-3 py-2.5 text-xs text-gray-400">
            <span>{coin(total)} total campaigns</span>
            <div className="flex items-center gap-1.5">
              <button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}
                className="rounded-lg border border-white/[0.08] px-3 py-1.5 text-gray-300 transition-colors hover:bg-white/[0.05] disabled:opacity-40">Prev</button>
              <span className="px-1">Page {page}</span>
              <button disabled={campaigns.length < 25} onClick={() => setPage((value) => value + 1)}
                className="rounded-lg border border-white/[0.08] px-3 py-1.5 text-gray-300 transition-colors hover:bg-white/[0.05] disabled:opacity-40">Next</button>
            </div>
          </div>
        </div>
      )}
{/* Detail panel */}
      {selected && (
        <section className="mt-4 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0d0d0f]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-white">Campaign {selected.id.slice(0, 8)} · @{selected.creatorUsername ?? 'unknown'}</h2>
              <p className="text-xs text-gray-400">
                {selected.rewardType === 'COINS'
                  ? `${coin(selected.rewardPerUser)} coins × ${coin(selected.totalAllocation)} followers`
                  : `Gift reward · ${selected.gift?.name ?? 'catalog gift'}`}
                {' '}· {coin(selected.distributedAmount)} / {coin(selected.reservedAmount)} coins delivered
              </p>
            </div>
            <button type="button" onClick={() => setSelected(null)}
              className="rounded-lg border border-white/[0.08] px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/[0.05]">Close</button>
          </div>

          <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Claims</h3>
              {claims ? (
                claims.claims.length > 0 ? (
                  <ul className="max-h-72 space-y-1.5 overflow-y-auto">
                    {claims.claims.map((claim) => (
                      <li key={claim.id} className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.03] px-2.5 py-2">
                        <span className="truncate text-xs font-medium text-white">{claim.user?.username || claim.userId?.slice(0, 8)}</span>
                        <span className="shrink-0 text-[11px] text-gray-400">
                          {claim.rewardType === 'COINS' ? `+${coin(claim.coinAmount ?? 0)}` : claim.giftSnapshot?.name ?? 'gift'}
                          <span className="ml-2">{new Date(claim.createdAt).toLocaleDateString()}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-lg bg-white/[0.03] px-3 py-6 text-center text-xs text-gray-500">No claims.</p>
                )
              ) : (
                <p className="rounded-lg bg-white/[0.03] px-3 py-6 text-center text-xs text-gray-500">Loading claims…</p>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Ledger transactions</h3>
              {transactions.length > 0 ? (
                <ul className="max-h-72 space-y-1.5 overflow-y-auto">
                  {transactions.map((tx) => (
                    <li key={tx.id} className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.03] px-2.5 py-2">
                      <span className="truncate text-xs text-gray-200">
                        <span className="mr-1.5 rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-[#e6c34a]">{tx.type.replace(/^FOLLOWER_REWARD_/, '')}</span>
                        {tx.description}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-gray-400">
                        {tx.amount > 0 ? '+' : ''}{coin(tx.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-lg bg-white/[0.03] px-3 py-6 text-center text-xs text-gray-500">No ledger rows.</p>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}