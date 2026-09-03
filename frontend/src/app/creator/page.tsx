'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/apiClient';
import { cn } from '@/lib/utils';
import {
  BarChart3,
  TrendingUp,
  Users,
  Eye,
  Heart,
  MessageCircle,
  Share2,
  Bookmark,
  Gift,
  Sparkles,
  Loader2,
  FileText,
  Video,
  Radio,
  Coins,
  ChevronRight,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types mirror the REAL payloads returned by the backend creator endpoints.
// Every field here maps to data aggregated from existing VANTA tables; there
// are no invented metrics or client-side financial calculations.
// ---------------------------------------------------------------------------
interface CreatorStats {
  username: string;
  fullName: string | null;
  avatar: string | null;
  verified: boolean;
  role: string;
  totalFollowers: number;
  totalFollowing: number;
  totalPosts: number;
  totalReels: number;
  totalLiveSessions: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalSaves: number;
  giftsReceived: number;
  coins: number;
  earnings: number;
  earningsBalance: number;
}

interface CreatorContentItem {
  id: string;
  type: 'post' | 'reel';
  title: string;
  mediaUrl: string | null;
  views: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  createdAt: string;
}

const tabs = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'content', label: 'Content', icon: FileText },
  { id: 'analytics', label: 'Analytics', icon: TrendingUp },
  { id: 'live', label: 'Live', icon: Radio },
  { id: 'earnings', label: 'Earnings', icon: Coins },
];

// Compact number formatting (e.g. 159.2K) — presentation only, no derived data.
function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) < 1000) return String(value);
  return Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

// Mobile-first metric card. Sits in a responsive 2-up grid on phones.
function MetricCard({
  icon: Icon,
  label,
  value,
  accent = 'text-white/70',
}: {
  icon: any;
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="card-premium p-4 min-w-0">
      <div className="w-9 h-9 rounded-xl bg-white/[0.05] border border-white/[0.06] flex items-center justify-center mb-3">
        <Icon size={16} className={accent} />
      </div>
      <p className="text-xl font-bold text-white truncate">{value}</p>
      <p className="text-[11px] text-white/40 mt-1 truncate">{label}</p>
    </div>
  );
}

export default function CreatorStudioPage() {
  const { token, user } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<CreatorStats | null>(null);
  const [content, setContent] = useState<CreatorContentItem[]>([]);
  const [accessDenied, setAccessDenied] = useState(false);

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    setAccessDenied(false);
    try {
      // Server decides access. A normal user who navigates to /creator is
      // rejected here rather than being trusted by the client.
      const access = await apiGet<{ allowed: boolean }>('/api/creator/access', token).catch(() => null);
      if (access && access.allowed === false) {
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      const [statsRes, contentRes] = await Promise.all([
        apiGet<{ stats: CreatorStats }>('/api/creator/stats', token),
        apiGet<{ content: CreatorContentItem[] }>('/api/creator/content', token).catch(() => ({ content: [] })),
      ]);
      setStats(statsRes?.stats ?? null);
      setContent(Array.isArray(contentRes?.content) ? contentRes.content : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load Creator Studio');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Prefer the authoritative /me verified flag; fall back to the stats payload.

  if (loading) {
    return (
      <div className="w-full space-y-4">
        <div className="skeleton h-10 w-40 rounded-xl" />
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton h-28 rounded-2xl" />
          ))}
        </div>
        <div className="skeleton h-48 rounded-2xl" />
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="w-full py-12 flex flex-col items-center text-center">
        <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-4">
          <Sparkles size={22} className="text-[#d6a83f]" />
        </div>
        <h2 className="text-base font-semibold text-white/80 mb-1">Creator Studio is locked</h2>
        <p className="text-sm text-white/40 max-w-xs">
          Your account doesn&apos;t have creator access yet. Verified creators and members can open the Studio.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full py-12 flex flex-col items-center text-center">
        <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
          <Loader2 size={22} className="text-red-400" />
        </div>
        <h2 className="text-base font-medium text-white/70 mb-1">Couldn&apos;t load Creator Studio</h2>
        <p className="text-sm text-white/40 mb-5">{error}</p>
        <button onClick={fetchData} className="btn-primary text-sm">
          Try again
        </button>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="w-full pb-[calc(env(safe-area-inset-bottom,0px)+72px)] space-y-5"
    >
      {/* Horizontally scrollable tab bar (no horizontal page overflow) */}
      <div className="flex items-center gap-1 bg-white/[0.04] rounded-xl p-1 overflow-x-auto scrollbar-hide -mx-1 px-1">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap shrink-0',
                isActive
                  ? 'bg-gradient-to-r from-[#d6a83f] to-[#c8c8cc] text-black shadow-sm'
                  : 'text-white/50 hover:text-white'
              )}
            >
              <Icon size={13} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* OVERVIEW */}
      {activeTab === 'overview' && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-5"
        >
          <div className="grid grid-cols-2 gap-3">
            <MetricCard icon={Eye} label="Total views" value={formatCompact(stats?.totalViews ?? 0)} accent="text-[#c8c8cc]" />
            <MetricCard icon={Users} label="Followers" value={formatCompact(stats?.totalFollowers ?? 0)} accent="text-[#c8c8cc]" />
            <MetricCard icon={Heart} label="Likes" value={formatCompact(stats?.totalLikes ?? 0)} accent="text-rose-300" />
            <MetricCard icon={Gift} label="Gifts received" value={formatCompact(stats?.giftsReceived ?? 0)} accent="text-[#d6a83f]" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <MetricCard icon={FileText} label="Posts" value={formatCompact(stats?.totalPosts ?? 0)} />
            <MetricCard icon={Video} label="Reels" value={formatCompact(stats?.totalReels ?? 0)} />
            <MetricCard icon={Radio} label="Live" value={formatCompact(stats?.totalLiveSessions ?? 0)} />
          </div>

          {/* Recent content preview from real posts */}
          <section className="card-premium p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                <FileText size={15} className="text-[#d6a83f]" />
                Recent content
              </h2>
              {content.length > 0 && (
                <button onClick={() => setActiveTab('content')} className="flex items-center gap-0.5 text-[11px] text-white/40 hover:text-white/70 transition">
                  View all <ChevronRight size={11} />
                </button>
              )}
            </div>
            {content.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <FileText size={22} className="text-white/10 mb-2" />
                <p className="text-sm text-white/30">No content yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {content.slice(0, 5).map((item) => (
                  <div key={item.id} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/[0.03] transition">
                    <div className="w-9 h-9 shrink-0 rounded-lg bg-white/[0.05] flex items-center justify-center">
                      {item.type === 'reel' ? <Video size={15} className="text-white/40" /> : <FileText size={15} className="text-white/40" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{item.title}</p>
                      <p className="text-[11px] text-white/35">
                        {formatCompact(item.views)} views · {formatCompact(item.likes)} likes
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </motion.div>
      )}

      {/* CONTENT */}
      {activeTab === 'content' && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          {content.length === 0 ? (
            <div className="card-premium py-14 flex flex-col items-center text-center">
              <FileText size={30} className="text-white/10 mb-3" />
              <h3 className="text-white/50 font-medium text-sm mb-1">No content yet</h3>
              <p className="text-white/25 text-xs max-w-[15rem]">Your posts and reels will appear here with their performance.</p>
            </div>
          ) : (
            content.map((item) => (
              <div key={item.id} className="card-premium p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 shrink-0 rounded-xl bg-white/[0.05] flex items-center justify-center">
                    {item.type === 'reel' ? <Video size={16} className="text-white/40" /> : <FileText size={16} className="text-white/40" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{item.title}</p>
                    <p className="text-[11px] text-white/30 mt-0.5">{new Date(item.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 mt-3 text-center">
                  <div className="rounded-lg bg-white/[0.03] py-2">
                    <p className="text-sm font-semibold text-white">{formatCompact(item.views)}</p>
                    <p className="text-[9px] text-white/35 mt-0.5">Views</p>
                  </div>
                  <div className="rounded-lg bg-white/[0.03] py-2">
                    <p className="text-sm font-semibold text-white">{formatCompact(item.likes)}</p>
                    <p className="text-[9px] text-white/35 mt-0.5">Likes</p>
                  </div>
                  <div className="rounded-lg bg-white/[0.03] py-2">
                    <p className="text-sm font-semibold text-white">{formatCompact(item.comments)}</p>
                    <p className="text-[9px] text-white/35 mt-0.5">Comments</p>
                  </div>
                  <div className="rounded-lg bg-white/[0.03] py-2">
                    <p className="text-sm font-semibold text-white">{formatCompact(item.saves)}</p>
                    <p className="text-[9px] text-white/35 mt-0.5">Saves</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </motion.div>
      )}

      {/* ANALYTICS — aggregated engagement from real content */}
      {activeTab === 'analytics' && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <MetricCard icon={Eye} label="Views" value={formatCompact(stats?.totalViews ?? 0)} accent="text-[#c8c8cc]" />
            <MetricCard icon={Heart} label="Likes" value={formatCompact(stats?.totalLikes ?? 0)} accent="text-rose-300" />
            <MetricCard icon={MessageCircle} label="Comments" value={formatCompact(stats?.totalComments ?? 0)} accent="text-sky-300" />
            <MetricCard icon={Share2} label="Shares" value={formatCompact(stats?.totalShares ?? 0)} accent="text-emerald-300" />
            <MetricCard icon={Bookmark} label="Saves" value={formatCompact(stats?.totalSaves ?? 0)} accent="text-amber-300" />
            <MetricCard icon={Users} label="Following" value={formatCompact(stats?.totalFollowing ?? 0)} />
          </div>
        </motion.div>
      )}

      {/* LIVE */}
      {activeTab === 'live' && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <MetricCard icon={Radio} label="Live sessions" value={formatCompact(stats?.totalLiveSessions ?? 0)} accent="text-rose-300" />
            <MetricCard icon={Gift} label="Gifts received" value={formatCompact(stats?.giftsReceived ?? 0)} accent="text-[#d6a83f]" />
          </div>
          <p className="text-[11px] text-white/30 px-1">
            Live session counts reflect the streams you&apos;ve hosted on VANTA.
          </p>
        </motion.div>
      )}

      {/* EARNINGS — reuses the existing wallet/earnings system, no client math */}
      {activeTab === 'earnings' && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          <div className="card-premium p-5">
            <p className="text-[11px] text-white/40 uppercase tracking-wider mb-1">Creator earnings</p>
            <p className="text-3xl font-bold text-white">{formatCompact(stats?.earnings ?? 0)}</p>
            <p className="text-[11px] text-white/35 mt-1">Available earnings balance: {formatCompact(stats?.earningsBalance ?? 0)}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <MetricCard icon={Coins} label="Coins" value={formatCompact(stats?.coins ?? 0)} accent="text-[#d6a83f]" />
            <MetricCard icon={Gift} label="Gifts received" value={formatCompact(stats?.giftsReceived ?? 0)} accent="text-[#d6a83f]" />
          </div>
          <p className="text-[11px] text-white/30 px-1">
            Balances come from your VANTA wallet. Manage withdrawals from the Balance screen.
          </p>
        </motion.div>
      )}
    </motion.div>
  );
}
