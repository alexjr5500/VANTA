"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { FileText, Video, Eye, Heart, MessageCircle, Search, ArrowUpRight, Share2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/apiClient';
import type { CreatorContentItem } from '@/lib/creatorStudio';
import ConsolePanel from '@/components/console/Panel';
import { ConsoleErrorState, ConsoleEmptyState, SkeletonRows } from '@/components/console/States';
import { fmtCompact, fmtDate } from '@/components/console/format';
import { cn } from '@/lib/utils';

// ============================================================================
// CREATOR CONTENT — real published posts from /api/creator/content with their
// actual performance numbers. The backend exposes no creator post
// edit/delete/publish endpoints, so this is an honest read-only performance
// workspace: every row links to the real post. Desktop gets a dense table;
// phones get a compact record list (no forced horizontal scrolling).
// ============================================================================

type TypeFilter = 'all' | 'post' | 'reel';

export default function CreatorContentPage() {
  const { token } = useAuth();
  const [items, setItems] = useState<CreatorContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  const fetchData = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ content: CreatorContentItem[] }>('/api/creator/content?limit=50', token, { skipCache: true });
      setItems(Array.isArray(res?.content) ? res.content : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load your content.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (typeFilter !== 'all' && item.type !== typeFilter) return false;
      if (q && !item.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, search, typeFilter]);

  if (loading) {
    return (
      <div className="vc-panel" aria-busy="true">
        <SkeletonRows rows={6} />
      </div>
    );
  }

  if (error) {
    return <ConsoleErrorState title="Couldn't load your content" message={error} onRetry={() => void fetchData()} />;
  }

  return (
    <div className="space-y-4 pb-8">
      {/* Toolbar: search + type filter + count */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="vc-input flex min-w-0 flex-1 items-center gap-2 sm:max-w-xs">
          <Search size={14} className="shrink-0 text-console-text-3" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your content…"
            aria-label="Search your content"
            className="w-full min-w-0 border-none bg-transparent py-2 text-[13px] text-console-text outline-none placeholder:text-console-text-3"
          />
        </div>
        <div className="flex items-center rounded-[var(--vc-radius)] border border-console-border bg-console-bg2 p-0.5" role="group" aria-label="Filter by content type">
          {([['all', 'All'], ['post', 'Posts'], ['reel', 'Reels']] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTypeFilter(id)}
              aria-pressed={typeFilter === id}
              className={cn(
                'vc-focus min-h-8 rounded-[calc(var(--vc-radius)-2px)] px-3 text-xs font-semibold transition-colors',
                typeFilter === id ? 'bg-console-gold-soft text-console-gold' : 'text-console-text-3 hover:text-console-text-2',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="ml-auto shrink-0 text-[11px] text-console-text-3">
          {items.length} published · showing {filtered.length}
        </span>
      </div>

      {items.length === 0 ? (
        <ConsolePanel bodyClassName="p-0">
          <ConsoleEmptyState
            icon={<FileText size={19} />}
            title="No content yet"
            description="Posts you publish will appear here with their views, likes and comments."
          />
        </ConsolePanel>
      ) : filtered.length === 0 ? (
        <ConsolePanel bodyClassName="p-0">
          <ConsoleEmptyState
            icon={<Search size={19} />}
            title="No matching content"
            description="No published content matches your search or filter."
            action={
              <button
                type="button"
                onClick={() => { setSearch(''); setTypeFilter('all'); }}
                className="vc-focus min-h-9 rounded-[var(--vc-radius)] border border-console-border-strong px-4 text-xs font-semibold text-console-text-2 hover:bg-white/[0.04]"
              >
                Clear filters
              </button>
            }
          />
        </ConsolePanel>
      ) : (
        <>
          {/* Desktop: dense table */}
          <ConsolePanel className="hidden md:block" bodyClassName="p-0">
            <table className="vc-table">
              <caption className="sr-only">Your published content with performance metrics</caption>
              <thead>
                <tr>
                  <th scope="col">Content</th>
                  <th scope="col">Type</th>
                  <th scope="col" className="text-right">Views</th>
                  <th scope="col" className="text-right">Likes</th>
                  <th scope="col" className="text-right">Comments</th>
                  <th scope="col" className="text-right">Shares</th>
                  <th scope="col" className="text-right">Saves</th>
                  <th scope="col">Published</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id}>
                    <td className="max-w-[280px]">
                      <div className="flex items-center gap-2.5">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-console-border bg-console-bg2 text-console-text-3">
                          {item.type === 'reel' ? <Video size={13} aria-hidden /> : <FileText size={13} aria-hidden />}
                        </span>
                        <span className="truncate font-medium text-console-text">{item.title}</span>
                      </div>
                    </td>
                    <td className="uppercase text-console-text-3">{item.type}</td>
                    <td className="text-right font-semibold tabular-nums text-console-text">{fmtCompact(item.views)}</td>
                    <td className="text-right tabular-nums">{fmtCompact(item.likes)}</td>
                    <td className="text-right tabular-nums">{fmtCompact(item.comments)}</td>
                    <td className="text-right tabular-nums">{fmtCompact(item.shares)}</td>
                    <td className="text-right tabular-nums">{fmtCompact(item.saves)}</td>
                    <td className="whitespace-nowrap">{fmtDate(item.createdAt)}</td>
                    <td className="text-right">
                      <Link
                        href={`/post/${item.id}`}
                        className="vc-focus inline-flex items-center gap-1 rounded-[var(--vc-radius)] border border-console-border px-2.5 py-1 text-[11px] font-semibold text-console-text-2 transition-colors hover:bg-white/[0.04] hover:text-console-text"
                      >
                        View <ArrowUpRight size={11} aria-hidden />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ConsolePanel>

          {/* Mobile: compact record list — no forced horizontal scrolling */}
          <div className="vc-panel divide-y divide-console-border md:hidden">
            {filtered.map((item) => (
              <Link
                key={item.id}
                href={`/post/${item.id}`}
                className="vc-focus flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.02]"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--vc-radius)] border border-console-border bg-console-bg2 text-console-text-3">
                  {item.type === 'reel' ? <Video size={14} aria-hidden /> : <FileText size={14} aria-hidden />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-console-text">{item.title}</span>
                  <span className="mt-0.5 flex items-center gap-2 text-[11px] text-console-text-3">
                    <span className="uppercase">{item.type}</span>
                    <span aria-hidden>·</span>
                    <span>{fmtDate(item.createdAt)}</span>
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-[13px] font-semibold tabular-nums text-console-text">{fmtCompact(item.views)}</span>
                  <span className="block text-[10px] text-console-text-3">{fmtCompact(item.likes)} likes</span>
                </span>
              </Link>
            ))}
          </div>

        </>
      )}
    </div>
  );
}
