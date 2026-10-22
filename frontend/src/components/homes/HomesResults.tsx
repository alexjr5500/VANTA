'use client';

import React, { useState } from 'react';
import PropertyCard from '@/components/homes/PropertyCard';
import Button from '@/components/ui/Button';
import { fetchHomes } from '@/lib/services';

type HomesResultsProps = {
  initialListings: any[];
  initialCursor: string | null;
  initialHasMore: boolean;
  filters: Record<string, string>;
  pageLimit: number;
};

export default function HomesResults({
  initialListings,
  initialCursor,
  initialHasMore,
  filters,
  pageLimit,
}: HomesResultsProps) {
  const [listings, setListings] = useState<any[]>(initialListings);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMore = async () => {
    if (!cursor || loading || !hasMore) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchHomes({
        cursor,
        limit: pageLimit,
        city: filters.city,
        area: filters.area,
        propertyType: filters.propertyType,
        minRent: filters.minRent,
        maxRent: filters.maxRent,
        bedrooms: filters.bedrooms,
        bathrooms: filters.bathrooms,
        furnished: filters.furnished,
        search: filters.search,
        sort: filters.sort,
      });
      const next = Array.isArray(result?.data) ? result.data : [];
      setListings((previous) => {
        const known = new Set(previous.map((item) => item.id));
        return [...previous, ...next.filter((item: any) => !known.has(item.id))];
      });
      setCursor(result?.nextCursor || null);
      setHasMore(Boolean(result?.hasMore && result?.nextCursor));
    } catch (e: any) {
      setError(e?.message || 'Could not load more homes. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {listings.map((listing) => <PropertyCard key={listing.id} listing={listing} />)}
      </div>
      {error && <p role="alert" className="mt-4 text-center text-sm text-red-400">{error}</p>}
      {hasMore && cursor && (
        <div className="mt-8 flex justify-center">
          <Button variant="outline" disabled={loading} onClick={loadMore}>
            {loading ? 'Loading…' : error ? 'Try again' : 'Load more'}
          </Button>
        </div>
      )}
    </>
  );
}
