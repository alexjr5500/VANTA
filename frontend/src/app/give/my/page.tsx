'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Heart, Plus, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { listMyFundraisers } from '@/lib/fundraiserApi';
import { canCreateFundraiser } from '@/lib/canCreateFundraiser';
import FundraiserCard from '@/components/give/FundraiserCard';
import EmptyState from '@/components/ui/EmptyState';
import type { Fundraiser } from '@/types/fundraiser';

export default function MyFundraisersPage() {
  const router = useRouter();
  const { token, isLoading: authLoading, user } = useAuth();
  const fundraiserAllowed = canCreateFundraiser(user);
  const [items, setItems] = useState<Fundraiser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  const load = useCallback(async () => {
    if (authLoading) return;
    if (!token) {
      router.replace('/login?next=/give/my');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const fundraisers = await listMyFundraisers(token);
      setItems(fundraisers);
    } catch (reason: any) {
      setError(reason?.message || 'Your fundraisers could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [authLoading, token, router]);

  useEffect(() => {
    void load();
  }, [load, retry]);

  return (
    <div className="page-container">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="text-label text-[var(--vanta-gold-bright)]">VANTA Give</p>
          <h1 className="mt-1 text-h1 text-white">My fundraisers</h1>
          <p className="mt-1 text-secondary text-white/45">Manage your drafts, campaigns and applications.</p>
        </div>
        <div className="shrink-0">
          {fundraiserAllowed ? (
            <Link href="/give/start" className="btn-gold shrink-0">
              <Plus size={16} />
              Start fundraiser
            </Link>
          ) : (
            <button
              type="button"
              disabled
              title="Verification required to create a fundraiser"
              className="btn-gold shrink-0 cursor-not-allowed opacity-50"
            >
              <ShieldCheck size={16} />
              Verification required
            </button>
          )}
        </div>
      </header>

      {loading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="aspect-[4/5] animate-pulse rounded-2xl bg-white/[0.03]" />
          ))}
        </div>
      )}

      {!loading && error && (
        <EmptyState
          icon={<Heart size={28} />}
          title="Unable to load your fundraisers"
          description={error}
          action={
            <button type="button" onClick={() => setRetry((v) => v + 1)} className="btn-secondary">
              Try again
            </button>
          }
        />
      )}

      {!loading && !error && items.length === 0 && (
        <EmptyState
          icon={<Heart size={28} />}
          title="No fundraisers yet"
          description={fundraiserAllowed ? "Start a fundraiser for a cause that matters to you." : "Verification required to create a fundraiser."}
          action={fundraiserAllowed ? (
            <Link href="/give/start" className="btn-gold">
              <Plus size={15} />
              Start a fundraiser
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-white/45">
              <ShieldCheck size={14} className="text-[#d6a83f]" />
              Verify your account to start a fundraiser
            </span>
          )}
        />
      )}

      {!loading && !error && items.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <div key={item.id} className="relative">
              <FundraiserCard fundraiser={item as any} />
              <Link
                href={`/give/my/${item.id}`}
                className="absolute inset-0 rounded-2xl"
                aria-label={`Manage ${item.title}`}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}