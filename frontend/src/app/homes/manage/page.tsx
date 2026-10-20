'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  fetchMyHomes, submitHomeListingForReview, setHomeListingAvailability, archiveHomeListing,
} from '@/lib/services';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import {
  ArrowLeft, Plus, Archive, Home as HomeIcon,
} from 'lucide-react';

const PAGE_LIMIT = 20;

const STATUS_META: Record<string, { label: string; className: string; hint?: string }> = {
  DRAFT: { label: 'Draft', className: 'text-white/60 border-white/[0.12] bg-white/[0.04]', hint: 'Not submitted yet.' },
  PENDING_REVIEW: { label: 'In review', className: 'text-amber-400 border-amber-400/40 bg-amber-500/10', hint: 'A moderator is checking this listing.' },
  PUBLISHED: { label: 'Live', className: 'text-emerald-400 border-emerald-400/40 bg-emerald-500/10', hint: 'Visible to everyone on VANTA Homes.' },
  PAUSED: { label: 'Paused', className: 'text-white/60 border-white/[0.12] bg-white/[0.04]', hint: 'Hidden from public browsing.' },
  RESERVED: { label: 'Reserved', className: 'text-amber-400 border-amber-400/40 bg-amber-500/10', hint: 'Held for a prospective tenant.' },
  RENTED: { label: 'Rented', className: 'text-sky-400 border-sky-400/40 bg-sky-500/10', hint: 'No longer taking enquiries.' },
  REJECTED: { label: 'Rejected', className: 'text-red-400 border-red-400/40 bg-red-500/10', hint: 'Update the listing before resubmitting.' },
  ARCHIVED: { label: 'Archived', className: 'text-white/50 border-white/[0.1] bg-white/[0.03]', hint: 'Stored away and hidden.' },
};

type PendingAction = {
  kind: 'status' | 'archive' | 'submit';
  /** Listing the action applies to — needed because the dialog is rendered
   *  before the request starts, so `busyId` is still null at that point. */
  id: string;
  status?: string;
  title: string;
  body: string;
  confirmLabel: string;
};

export default function ManageHomesPage() {
  const router = useRouter();
  const { user, token, isLoading: authLoading } = useAuth();
  const { showToast } = useToast();

  const [listings, setListings] = useState<any[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchMyHomes({ limit: PAGE_LIMIT }, token);
      const items = Array.isArray(res?.data) ? res.data : [];
      setListings(items);
      setNextCursor(res?.nextCursor || null);
      setHasMore(Boolean(res?.hasMore && res?.nextCursor));
    } catch (e: any) {
      setError(e?.message || 'Could not load your listings.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/login?redirect=/homes/manage');
      return;
    }
    void load();
  }, [authLoading, user, load, router]);

  const loadMore = async () => {
    if (!token || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetchMyHomes({ cursor: nextCursor, limit: PAGE_LIMIT }, token);
      const items = Array.isArray(res?.data) ? res.data : [];
      setListings((prev) => [...prev, ...items]);
      setNextCursor(res?.nextCursor || null);
      setHasMore(Boolean(res?.hasMore && res?.nextCursor));
    } catch {
      // Retain what we have; the button remains for another attempt.
    } finally {
      setLoadingMore(false);
    }
  };

  const applyLocal = (id: string, status: string) => {
    setListings((prev) => prev.map((l) => (l.id === id ? { ...l, availabilityStatus: status } : l)));
  };

  // Runs the action the operator just confirmed in the dialog.
  const runConfirmed = async (action: PendingAction) => {
    if (!token) return;
    const target = listings.find((l) => l.id === action.id);
    if (!target) { setPending(null); return; }
    const previous = target.availabilityStatus;
    setBusyId(action.id);
    try {
      if (action.kind === 'archive') {
        await archiveHomeListing(action.id, token);
        applyLocal(action.id, 'ARCHIVED');
        showToast({ type: 'success', title: 'Listing archived', message: 'It is now hidden from VANTA Homes.' });
      } else if (action.kind === 'submit') {
        await submitHomeListingForReview(action.id, token);
        applyLocal(action.id, 'PENDING_REVIEW');
        showToast({ type: 'success', title: 'Submitted for review', message: 'We will publish it once it is approved.' });
      } else if (action.kind === 'status' && action.status) {
        await setHomeListingAvailability(action.id, action.status, token);
        applyLocal(action.id, action.status);
        showToast({ type: 'success', title: 'Availability updated' });
      }
    } catch (e: any) {
      applyLocal(action.id, previous);
      showToast({ type: 'error', title: 'Action failed', message: e?.message || 'Please try again.' });
    } finally {
      setBusyId(null);
      setPending(null);
    }
  };

  const coverOf = (l: any) => {
    const items: any[] = Array.isArray(l?.media) ? l.media : [];
    const sorted = [...items].sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0));
    const cover = sorted.find((m) => m?.isCover) || sorted[0];
    return cover?.uploadedFile?.url || cover?.thumbnailUrl || null;
  };

  const hasPhotos = (l: any) => Array.isArray(l?.media) && l.media.length > 0;

  // A draft/paused listing can be sent for review once it has at least one
  // photo. Rejected listings must be edited first (enforced server-side too).
  const canSubmit = (l: any) =>
    ['DRAFT', 'PAUSED'].includes(l?.availabilityStatus) && hasPhotos(l);

  if (authLoading || (!user && !loading)) {
    return (
      <div className="min-h-[var(--vanta-vh,100dvh)] bg-[var(--background)]">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <Skeleton className="mb-6 h-4 w-24" />
          <Skeleton className="mb-4 h-8 w-52" />
          <Skeleton className="mb-3 h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[var(--vanta-vh,100dvh)] bg-[var(--background)] text-[var(--foreground)]">
      <div className="max-w-4xl mx-auto px-4 py-6 pb-24">
        <button
          onClick={() => router.push('/homes')}
          className="mb-4 inline-flex items-center gap-2 text-sm text-white/60 transition-colors hover:text-white"
        >
          <ArrowLeft size={16} /> All homes
        </button>

        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <span className="text-sm font-bold uppercase tracking-wider text-[#c9a227]">VANTA Homes</span>
            <h1 className="text-2xl font-bold text-white">Manage your listings</h1>
            <p className="mt-1 text-sm text-white/50">Publish, pause and track every property you list.</p>
          </div>
          <Button variant="gold" icon={<Plus size={18} />} onClick={() => router.push('/homes/create')}>
            New listing
          </Button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} variant="rectangular" className="h-32 w-full" />
            ))}
          </div>
        ) : error ? (
          <EmptyState
            title="Could not load your listings"
            description={error}
            action={<Button variant="gold" onClick={() => void load()}>Try again</Button>}
          />
        ) : listings.length === 0 ? (
          <EmptyState
            icon={<HomeIcon size={24} />}
            title="You have not listed a home yet"
            description="Post your first property and reach people looking for a place to rent."
            action={<Button variant="gold" onClick={() => router.push('/homes/create')}>Post a property</Button>}
          />
        ) : (
          <div className="space-y-3">
            {listings.map((listing) => {
              const meta = STATUS_META[listing.availabilityStatus] || STATUS_META.DRAFT;
              const cover = coverOf(listing);
              const isBusy = busyId === listing.id;
              return (
                <div
                  key={listing.id}
                  className="flex flex-col gap-3 rounded-[var(--radius-xl)] border border-white/[0.07] bg-white/[0.03] p-3 sm:flex-row sm:items-center"
                >
                  <div className="h-24 w-full shrink-0 overflow-hidden rounded-[var(--radius-lg)] bg-white/[0.05] sm:h-20 sm:w-28">
                    {cover ? (
                      <img src={cover} alt={listing.title} className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-white/20">
                        <HomeIcon size={22} />
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate font-semibold text-white">{listing.title}</h2>
                      <span className={`shrink-0 rounded-[var(--radius-md)] border px-2 py-0.5 text-[11px] font-semibold ${meta.className}`}>
                        {meta.label}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-white/45">
                      {[listing.area, listing.city, listing.country].filter(Boolean).join(', ')}
                    </p>
                    <p className="mt-1 text-xs text-white/35">
                      {hasPhotos(listing)
                        ? `${listing.media.length} photo${listing.media.length === 1 ? '' : 's'}`
                        : 'No photos yet — add some before submitting'}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={() => router.push(`/homes/${listing.id}`)}>
                      View
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => router.push(`/homes/create?edit=${listing.id}`)}>
                      Edit
                    </Button>
                    {canSubmit(listing) && (
                      <Button
                        size="sm"
                        variant="gold"
                        loading={isBusy}
                        onClick={() => setPending({
                          kind: 'submit',
                          id: listing.id,
                          title: 'Submit for review?',
                          body: 'A moderator will check this listing before it appears publicly. You can keep editing it meanwhile.',
                          confirmLabel: 'Submit',
                        })}
                      >
                        Submit
                      </Button>
                    )}
                    {listing.availabilityStatus === 'PUBLISHED' && (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={isBusy}
                        onClick={() => setPending({
                          kind: 'status',
                          id: listing.id,
                          status: 'PAUSED',
                          title: 'Pause this listing?',
                          body: 'It will be hidden from public browsing. You can publish it again at any time.',
                          confirmLabel: 'Pause',
                        })}
                      >
                        Pause
                      </Button>
                    )}
                    {['PAUSED', 'RESERVED', 'RENTED'].includes(listing.availabilityStatus) && (
                      <Button
                        size="sm"
                        variant="goldGhost"
                        loading={isBusy}
                        onClick={() => setPending({
                          kind: 'status',
                          id: listing.id,
                          status: 'PUBLISHED',
                          title: 'Publish this listing?',
                          body: 'It will become visible to everyone browsing VANTA Homes.',
                          confirmLabel: 'Publish',
                        })}
                      >
                        Publish
                      </Button>
                    )}
                    {['PUBLISHED', 'PAUSED', 'RESERVED'].includes(listing.availabilityStatus) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={isBusy}
                        onClick={() => setPending({
                          kind: 'status',
                          id: listing.id,
                          status: 'RENTED',
                          title: 'Mark as rented?',
                          body: 'The listing stays on your dashboard but stops taking new enquiries.',
                          confirmLabel: 'Mark rented',
                        })}
                      >
                        Rented
                      </Button>
                    )}
                    {listing.availabilityStatus !== 'ARCHIVED' && (
                      <Button
                        size="sm"
                        variant="danger"
                        loading={isBusy}
                        onClick={() => setPending({
                          kind: 'archive',
                          id: listing.id,
                          title: 'Archive this listing?',
                          body: 'It will be removed from VANTA Homes. You can still find it here.',
                          confirmLabel: 'Archive',
                        })}
                      >
                        <Archive size={14} />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {hasMore && nextCursor && !loading && (
          <div className="mt-6 flex justify-center">
            <Button variant="outline" loading={loadingMore} onClick={() => void loadMore()}>
              Load more
            </Button>
          </div>
        )}

        {/* Confirmation dialog for destructive / publishing actions -------- */}
        {pending && (
          <div
            className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label={pending.title}
            onClick={() => setPending(null)}
          >
            <div
              className="w-full max-w-sm rounded-[var(--radius-2xl)] border border-white/[0.08] bg-[var(--background)] p-5"
              onClick={(event) => event.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-white">{pending.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/60">{pending.body}</p>
              <div className="mt-5 flex items-center justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setPending(null)}>Cancel</Button>
                <Button
                  size="sm"
                  variant={pending.kind === 'archive' ? 'danger' : 'gold'}
                  loading={busyId === pending.id}
                  onClick={() => void runConfirmed(pending)}
                >
                  {pending.confirmLabel}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
