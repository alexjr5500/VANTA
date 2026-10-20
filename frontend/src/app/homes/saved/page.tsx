'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fetchSavedHomes } from '@/lib/services';
import PropertyCard from '@/components/homes/PropertyCard';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import { useAuth } from '@/context/AuthContext';
import { ArrowLeft, Bookmark } from 'lucide-react';

const PAGE_LIMIT = 20;

export default function SavedHomesPage() {
  const router = useRouter();
  const { user, token, isLoading: authLoading } = useAuth();

  const [listings, setListings] = useState<any[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchSavedHomes({ limit: PAGE_LIMIT }, token);
      const items = Array.isArray(res?.data) ? res.data : [];
      setListings(items);
      setNextCursor(res?.nextCursor || null);
      setHasMore(Boolean(res?.hasMore && res?.nextCursor));
    } catch (e: any) {
      setError(e?.message || 'Could not load your saved homes.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/login?redirect=/homes/saved');
      return;
    }
    void load();
  }, [authLoading, user, load, router]);

  const loadMore = async () => {
    if (!token || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetchSavedHomes({ cursor: nextCursor, limit: PAGE_LIMIT }, token);
      const items = Array.isArray(res?.data) ? res.data : [];
      setListings((prev) => [...prev, ...items]);
      setNextCursor(res?.nextCursor || null);
      setHasMore(Boolean(res?.hasMore && res?.nextCursor));
    } catch {
      // Keep what we already have; the button stays available for a retry.
    } finally {
      setLoadingMore(false);
    }
  };

  // Auth still resolving, or a logged-out visitor being redirected.
  if (authLoading || (!user && !loading)) {
    return (
      <div className="min-h-[var(--vanta-vh,100dvh)] bg-[var(--background)]">
        <div className="max-w-5xl mx-auto px-4 py-6">
          <Skeleton className="mb-6 h-4 w-24" />
          <Skeleton className="mb-4 h-8 w-48" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} variant="card" className="h-64" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[var(--vanta-vh,100dvh)] bg-[var(--background)] text-[var(--foreground)]">
      <div className="max-w-5xl mx-auto px-4 py-6 pb-24">
        <button
          onClick={() => router.push('/homes')}
          className="mb-4 inline-flex items-center gap-2 text-sm text-white/60 transition-colors hover:text-white"
        >
          <ArrowLeft size={16} /> All homes
        </button>

        <div className="mb-6">
          <span className="text-sm font-bold uppercase tracking-wider text-[#c9a227]">VANTA Homes</span>
          <h1 className="text-2xl font-bold text-white">Saved homes</h1>
          <p className="mt-1 text-sm text-white/50">Places you have bookmarked to revisit later.</p>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} variant="card" className="h-64" />
            ))}
          </div>
        ) : error ? (
          <EmptyState
            title="Could not load saved homes"
            description={error}
            action={<Button variant="gold" onClick={() => void load()}>Try again</Button>}
          />
        ) : listings.length === 0 ? (
          <EmptyState
            icon={<Bookmark size={24} />}
            title="Nothing saved yet"
            description="Tap the save icon on any listing and it will show up here for quick access."
            action={
              <div className="flex items-center gap-2">
                <Button variant="gold" onClick={() => router.push('/homes')}>Browse homes</Button>
                <Link href="/">
                  <Button variant="outline">Back to feed</Button>
                </Link>
              </div>
            }
          />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {listings.map((listing) => (
                <PropertyCard key={listing.id} listing={{ ...listing, isSaved: true }} />
              ))}
            </div>

            {hasMore && nextCursor && (
              <div className="mt-8 flex justify-center">
                <Button variant="outline" loading={loadingMore} onClick={() => void loadMore()}>
                  Load more
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
