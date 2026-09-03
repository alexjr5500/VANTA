'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Heart, RefreshCw, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { getFundraiserCategories, listFundraisers } from '@/lib/fundraiserApi';
import FundraiserCard from '@/components/give/FundraiserCard';
import EmptyState from '@/components/ui/EmptyState';
import type { FundraiserCategory, FundraiserListItem } from '@/types/fundraiser';

const SORTS = [
  { id: 'featured', label: 'Featured' },
  { id: 'recently-verified', label: 'Recently verified' },
  { id: 'most-supported', label: 'Most supported' },
  { id: 'ending-soon', label: 'Ending soon' },
] as const;

export default function GivePage() {
  const { token } = useAuth();
  const searchParams = useSearchParams();
  const initialCategory = searchParams?.get('category') || 'all';

  const [categories, setCategories] = useState<FundraiserCategory[]>([]);
  const [items, setItems] = useState<FundraiserListItem[]>([]);
  const [category, setCategory] = useState(initialCategory);
  const [sort, setSort] = useState<string>('featured');
  const [query, setQuery] = useState('');
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    getFundraiserCategories(token || undefined)
      .then(setCategories)
      .catch(() => setCategories([]));
  }, [token]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    listFundraisers(
      { category, sort: sort === 'featured' ? undefined : sort, search: query || undefined },
      token || undefined
    )
      .then((result) => {
        if (!active) return;
        setItems(result.items || []);
        setNextCursor(result.nextCursor);
      })
      .catch((reason: any) => {
        if (active) setError(reason?.message || 'Fundraisers could not be loaded.');
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [category, sort, query, retry, token]);
const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await listFundraisers({ category, sort: sort === 'featured' ? undefined : sort, cursor: nextCursor }, token || undefined);
      setItems((prev) => [...prev, ...(result.items || [])]);
      setNextCursor(result.nextCursor);
    } catch {
      // Keep existing results; the user can retry by scrolling again.
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="page-container">
      {/* Header */}
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-label text-[var(--vanta-gold-bright)]">VANTA Give</p>
          <h1 className="mt-1 text-h1 text-white">Fundraising for what matters</h1>
          <p className="mt-1.5 max-w-xl text-secondary text-white/45">
            Support genuine needs — medical emergencies, education, disaster recovery and community causes. Every campaign is
            reviewed by VANTA before going live.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRetry((v) => v + 1)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] text-white/45 transition hover:text-white"
          aria-label="Refresh fundraisers"
        >
          <RefreshCw size={16} />
        </button>
      </header>

      {/* Search + category chips */}
      <div className="mb-5 space-y-3">
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search fundraisers…"
            className="form-input pl-10"
          />
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide" role="tablist" aria-label="Fundraiser categories">
          <button
            type="button"
            role="tab"
            aria-selected={category === 'all'}
            onClick={() => setCategory('all')}
            className={cn(
              'shrink-0 rounded-full px-3.5 py-2 text-xs font-medium transition',
              category === 'all' ? 'bg-white text-black' : 'bg-white/[0.05] text-white/55 hover:text-white'
            )}
          >
            All
          </button>
          {categories.map((item) => {
            const active = category === item.slug;
            return (
              <button
                key={item.slug}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setCategory(item.slug)}
                className={cn(
                  'shrink-0 rounded-full px-3.5 py-2 text-xs font-medium transition',
                  active ? 'bg-white text-black' : 'bg-white/[0.05] text-white/55 hover:text-white'
                )}
              >
                {item.emoji && <span className="mr-1">{item.emoji}</span>}
                {item.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Sort tabs */}
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-white/[0.06] scrollbar-hide" role="tablist" aria-label="Sort fundraisers">
        {SORTS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={sort === item.id}
            onClick={() => setSort(item.id)}
            className={cn(
              'relative shrink-0 px-4 py-2.5 text-sm font-medium transition',
              sort === item.id
                ? 'text-white after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-[var(--vanta-gold)]'
                : 'text-white/40 hover:text-white/70'
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
{/* Results */}
      {loading && items.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-[4/5] animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.03]" />
          ))}
        </div>
      ) : error && items.length === 0 ? (
        <EmptyState
          icon={<Heart size={28} />}
          title="Unable to load fundraisers"
          description={error}
          action={
            <button type="button" onClick={() => setRetry((v) => v + 1)} className="btn-secondary">
              Try again
            </button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Heart size={28} />}
          title="No fundraisers here yet"
          description="Be the first to start a fundraiser for a cause that matters."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <FundraiserCard key={item.id} fundraiser={item} />
          ))}
        </div>
      )}

      {nextCursor && (
        <div className="mt-8 flex justify-center">
          <button type="button" onClick={loadMore} disabled={loadingMore} className="btn-secondary">
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}