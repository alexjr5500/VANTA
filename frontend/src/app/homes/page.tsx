import { fetchHomes, fetchHomePropertyTypes, fetchHomeRentPeriods } from '@/lib/services';
import { HomeFilterBar } from '@/components/homes/HomeFilterBar';
import EmptyState from '@/components/ui/EmptyState';
import Button from '@/components/ui/Button';
import { PostHomeButton } from '@/components/homes/PostHomeButton';
import HomesResults from '@/components/homes/HomesResults';

const PAGE_LIMIT = 20;

export const metadata = {
  title: 'VANTA Homes — Rentals',
  description: 'Discover homes and apartments available for rent on VANTA.',
};

export default async function HomesPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const params: Record<string, string> = {};
  const setIf = (key: string, val: string | string[] | undefined) => {
    if (val !== undefined && val !== '') params[key] = Array.isArray(val) ? val[0] : val;
  };
  setIf('city', searchParams.city);
  setIf('area', searchParams.area);
  setIf('propertyType', searchParams.propertyType);
  setIf('minRent', searchParams.minRent);
  setIf('maxRent', searchParams.maxRent);
  setIf('bedrooms', searchParams.bedrooms);
  setIf('bathrooms', searchParams.bathrooms);
  setIf('furnished', searchParams.furnished);
  setIf('q', searchParams.q);
  // The filter UI calls this field `q`; the API contract calls it `search`.
  // Keep `q` for the controlled input and send `search` to the backend.
  if (params.q) params.search = params.q;
  setIf('sort', searchParams.sort || 'newest');
  if (!params.limit) params.limit = String(PAGE_LIMIT);

  let propertyTypes: string[] = [];
  let rentPeriods: string[] = [];
  try { propertyTypes = (await fetchHomePropertyTypes())?.propertyTypes || []; } catch {}
  try { rentPeriods = (await fetchHomeRentPeriods())?.rentPeriods || []; } catch {}

  let data: any = { data: [], nextCursor: null, hasMore: false };
  try {
    const res = await fetchHomes(params);
    data = res || data;
  } catch { data = { data: [], nextCursor: null, hasMore: false }; }

  return (
    <div className="min-h-[var(--vanta-vh,100dvh)] bg-[var(--background)] text-[var(--foreground)]">
      <div className="px-4 pt-6 pb-2">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-[#c9a227] font-bold text-sm tracking-wider uppercase">VANTA Homes</span>
            <h1 className="text-2xl font-bold text-white">Homes for Rent</h1>
          </div>
          <p className="text-white/50 text-sm mb-6">Discover houses and apartments available for rent. All listings are free to browse.</p>
          <HomeFilterBar propertyTypes={propertyTypes} rentPeriods={rentPeriods} current={params} />
        </div>
      </div>
      <div className="max-w-5xl mx-auto px-4 pb-24">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold">Listings</h2>
          <PostHomeButton />
        </div>
        {data.data.length === 0 ? (
          <EmptyState title="No homes found" description="Try adjusting your filters or search for a different location." action={<Button variant="outline" onClick={() => (window.location.search = '')}>Reset filters</Button>} />
        ) : (
          <HomesResults
            initialListings={data.data}
            initialCursor={data.nextCursor || null}
            initialHasMore={Boolean(data.hasMore && data.nextCursor)}
            filters={params}
            pageLimit={PAGE_LIMIT}
          />
        )}
      </div>
    </div>
  );
}