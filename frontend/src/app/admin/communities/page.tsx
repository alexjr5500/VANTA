'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  Building2, Search, Users, MessageSquare, Lock,
  AlertTriangle, RefreshCw, Globe,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import { getCommunities } from '@/lib/adminApi';
import { cn } from '@/lib/utils';

interface CommunityRow {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  isPrivate: boolean;
  createdAt: string;
  owner: { id: string; username: string };
  _count?: { members?: number; posts?: number };
}

export default function CommunitiesPage() {
  const [search, setSearch] = useState('');
  const [communities, setCommunities] = useState<CommunityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('vanta_token') || localStorage.getItem('token');
      if (!token) return;
      const result: any = await getCommunities(token);
      setCommunities(result.communities || (Array.isArray(result) ? result : []));
    } catch (err: any) {
      setError(err?.message || 'Failed to load communities.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const filtered = communities.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q);
  });

  const totalMembers = communities.reduce((s, c) => s + (c._count?.members || 0), 0);
  const totalPosts = communities.reduce((s, c) => s + (c._count?.posts || 0), 0);
  const privateCount = communities.filter((c) => c.isPrivate).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Building2 size={14} className="text-[#d9a83f]" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold">Community</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Communities</h1>
          <p className="text-sm text-gray-400 mt-1">Real community data from the platform.</p>
        </div>
        <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => void fetchData()}>Refresh</Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="Total Communities" value={String(communities.length)} icon={<Building2 size={16} />} cls="bg-[#d9a83f]/15 text-[#d9a83f]" />
        <SummaryCard label="Total Members" value={totalMembers.toLocaleString()} icon={<Users size={16} />} cls="bg-sky-500/15 text-sky-400" />
        <SummaryCard label="Total Posts" value={totalPosts.toLocaleString()} icon={<MessageSquare size={16} />} cls="bg-emerald-500/15 text-emerald-400" />
        <SummaryCard label="Private" value={String(privateCount)} icon={<Lock size={16} />} cls="bg-violet-500/15 text-violet-400" />
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 bg-white/5 rounded-xl px-3 py-2 border border-white/[0.06]">
        <Search size={14} className="text-gray-500 shrink-0" />
        <input type="text" placeholder="Search communities..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-transparent border-none outline-none text-sm text-white placeholder-gray-500" />
      </div>
{/* List */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 rounded-2xl bg-white/5 animate-pulse" />)}
        </div>
      ) : error ? (
        <div className="py-10 text-center glass rounded-2xl">
          <AlertTriangle size={32} className="mx-auto mb-3 text-red-400" />
          <p className="text-sm text-gray-400">{error}</p>
          <Button variant="primary" size="sm" className="mt-3" onClick={() => void fetchData()}>Retry</Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center glass rounded-2xl">
          <Building2 size={34} className="mx-auto mb-3 text-white/15" />
          <p className="text-sm text-white/50">No communities match your search.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {filtered.map((comm) => (
            <div key={comm.id} className="glass rounded-2xl p-5 border border-white/[0.06]">
              <div className="flex items-start gap-3 mb-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10 text-white font-bold text-sm">
                  {comm.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-sm font-bold text-white truncate">{comm.name}</h3>
                    {comm.category && <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-gray-300 shrink-0">{comm.category}</span>}
                  </div>
                  {comm.description && <p className="text-xs text-gray-400 truncate mt-0.5">{comm.description}</p>}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 mb-3">
                <span className="flex items-center gap-1"><Users size={12} />{(comm._count?.members || 0).toLocaleString()}</span>
                <span className="flex items-center gap-1"><MessageSquare size={12} />{(comm._count?.posts || 0).toLocaleString()}</span>
                <span className={cn('px-1.5 py-0.5 rounded-full text-[9px]', comm.isPrivate ? 'bg-yellow-500/15 text-yellow-400' : 'bg-emerald-500/15 text-emerald-400')}>
                  {comm.isPrivate ? 'private' : 'public'}
                </span>
                <span className="flex items-center gap-1 text-[10px] text-gray-600 ml-auto"><Globe size={10} />@{comm.owner?.username || 'unknown'}</span>
              </div>
              <p className="text-[10px] text-gray-600">{new Date(comm.createdAt).toLocaleDateString()}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, icon, cls }: { label: string; value: string; icon: any; cls: string }) {
  return (
    <div className="glass rounded-2xl border border-white/[0.06] p-4">
      <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center mb-2', cls)}>{icon}</div>
      <p className="text-xl font-bold text-white tabular-nums">{value}</p>
      <p className="text-xs text-gray-400 mt-0.5">{label}</p>
    </div>
  );
}