'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  fetchHome, fetchHomeContactOptions, contactHomeListing, toggleSaveHome, createHomeReport,
} from '@/lib/services';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import ImageViewer from '@/components/ui/ImageViewer';
import Skeleton from '@/components/ui/Skeleton';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/lib/i18n/context';
import { formatDate } from '@/lib/utils';
import VerificationBadge from '@/components/ui/VerificationBadge';
import {
  MapPin, Bed, Bath, Home, Play, Share2, Phone, MessageCircle,
  AlertCircle, User, ChevronLeft, ChevronRight, Maximize2, Bookmark,
  CalendarDays, Building2, Wallet, Shield, ArrowLeft, Flag,
} from 'lucide-react';

const PERIOD_LABEL: Record<string, string> = {
  WEEKLY: '/week',
  MONTHLY: '/month',
  YEARLY: '/year',
};

const PERIOD_NAME: Record<string, string> = {
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  YEARLY: 'Yearly',
};

const TYPE_LABEL: Record<string, string> = {
  APARTMENT: 'Apartment',
  STUDIO: 'Studio',
  FLAT: 'Flat',
  DETACHED_HOUSE: 'Detached House',
  SEMI_DETACHED_HOUSE: 'Semi-Detached House',
  DUPLEX: 'Duplex',
  ROOM_SHARED: 'Shared Room',
  OTHER: 'Other',
};

const STATUS_META: Record<string, { label: string; className: string }> = {
  PUBLISHED: { label: 'Available', className: 'text-emerald-400 border-emerald-400/40 bg-emerald-500/10' },
  RESERVED: { label: 'Reserved', className: 'text-amber-400 border-amber-400/40 bg-amber-500/10' },
  RENTED: { label: 'Rented', className: 'text-red-400 border-red-400/40 bg-red-500/10' },
  PAUSED: { label: 'Not available', className: 'text-white/60 border-white/[0.12] bg-white/[0.04]' },
};

const VERIFICATION_META: Record<string, { type: 'BLUE' | 'GOLD' | 'NONE'; label: string }> = {
  VERIFIED: { type: 'GOLD', label: 'Verified Owner' },
  PENDING_REVIEW: { type: 'NONE', label: 'Verification pending' },
  REJECTED: { type: 'NONE', label: 'Verification failed' },
  EXPIRED: { type: 'NONE', label: 'Verification expired' },
  UNVERIFIED: { type: 'NONE', label: 'Unverified owner' },
};

// lucide-react no longer ships brand icons, so the WhatsApp glyph is inlined.
function WhatsAppGlyph({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

interface ListingMedia {
  id: string;
  type: 'IMAGE' | 'VIDEO';
  order: number;
  isCover: boolean;
  thumbnailUrl?: string | null;
  duration?: number | null;
  uploadedFile?: { url?: string | null } | null;
}

interface ListingOwner {
  id: string;
  username?: string;
  fullName?: string | null;
  avatar?: string | null;
  verified?: boolean;
}

interface ContactOptions {
  vantaMessaging?: boolean;
  whatsapp?: string | null;
  whatsappUrl?: string | null;
  phone?: string | null;
  phoneUrl?: string | null;
}

interface MediaFee {
  label?: string;
  amount?: number;
  currency?: string;
}

function parseJsonArray<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function locationLine(listing: any): string {
  const parts = [listing?.area, listing?.city, listing?.state, listing?.country].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'Location to be confirmed';
}

const AMENITY_LABEL: Record<string, string> = {
  WATER: 'Running water',
  ELECTRICITY: '24/7 electricity',
  WIFI: 'Wi-Fi',
  AIR_CONDITIONING: 'Air conditioning',
  PARKING: 'Parking',
  FURNISHED: 'Furnished',
  SECURITY: 'Security',
  GATED_ESTATE: 'Gated estate',
  BALCONY: 'Balcony',
  GARDEN: 'Garden',
  SWIMMING_POOL: 'Swimming pool',
  GYM: 'Gym',
  PETS_ALLOWED: 'Pets allowed',
  KITCHEN: 'Kitchen',
  WASHER: 'Washing machine',
  GENERATOR: 'Generator',
  BOREHOLE: 'Borehole',
  CCTV: 'CCTV',
};

const amenityLabel = (key: string) => AMENITY_LABEL[key] || key.replace(/_/g, ' ').toLowerCase();

export default function HomeDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
  const { user, token, isLoading: authLoading } = useAuth();
  const { showToast } = useToast();
  const { formatCurrency } = useI18n();

  const [listing, setListing] = useState<any>(null);
  const [contactOptions, setContactOptions] = useState<ContactOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [contacting, setContacting] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const [message, setMessage] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [reportType, setReportType] = useState('SCAM');
  const [reportReason, setReportReason] = useState('');
  const [reportDescription, setReportDescription] = useState('');
  const [reporting, setReporting] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      // The token is optional: the backend resolves the viewer from the
      // Authorization header and returns isSaved only when it recognizes us.
      const data = await fetchHome(id, token);
      if (!data || data.error) {
        setListing(null);
        setError(typeof data?.error === 'string' ? data.error : 'This listing is unavailable.');
        return;
      }
      setListing(data);
      setSaved(Boolean(data.isSaved));
      setViewerIndex(0);
    } catch (e: any) {
      if (e?.statusCode === 404) {
        setListing(null);
        setError('This listing is no longer available. It may have been rented or removed.');
      } else if (e?.statusCode === 403) {
        setListing(null);
        setError('This listing is not available for browsing.');
      } else {
        setError(e?.message || 'Could not load this listing. Check your connection and try again.');
      }
    } finally {
      setLoading(false);
    }
  }, [id, token]);

  // Wait for auth to settle so the very first request already carries our token.
  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [authLoading, load]);

  // Public contact channels are fetched separately and are cacheable.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetchHomeContactOptions(id)
      .then((data) => { if (!cancelled) setContactOptions(data || null); })
      .catch(() => { if (!cancelled) setContactOptions(null); });
    return () => { cancelled = true; };
  }, [id]);

  const media = useMemo<ListingMedia[]>(() => {
    const items: ListingMedia[] = Array.isArray(listing?.media) ? listing.media : [];
    return [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [listing]);

  const activeIndex = Math.min(viewerIndex, Math.max(media.length - 1, 0));
  const activeMedia = media[activeIndex] || null;
  const activeSrc = activeMedia?.uploadedFile?.url || activeMedia?.thumbnailUrl || null;

  const amenities = useMemo(() => parseJsonArray<string>(listing?.amenities), [listing]);
  const fees = useMemo<MediaFee[]>(() => parseJsonArray<MediaFee>(listing?.additionalFees), [listing]);

  const owner = listing?.owner as ListingOwner | undefined;
  const ownerName = owner?.fullName || (owner?.username ? `@${owner.username}` : 'Property owner');
  const verif = VERIFICATION_META[listing?.ownerVerificationStatus || 'UNVERIFIED'] || VERIFICATION_META.UNVERIFIED;
  const statusMeta = STATUS_META[listing?.availabilityStatus || ''] || null;
  const isOwner = Boolean(user && owner && user.id === owner.id);
  const canContact = contactOptions?.vantaMessaging !== false;

  const handleSave = async () => {
    if (!user) {
      showToast({ type: 'error', title: 'Sign in required', message: 'Log in to save this property.' });
      router.push(`/login?redirect=/homes/${id}`);
      return;
    }
    if (saving) return;
    const previous = saved;
    setSaving(true);
    setSaved(!previous);
    try {
      const result = await toggleSaveHome(id, token);
      setSaved(Boolean(result?.saved));
      showToast({ type: 'success', title: result?.saved ? 'Saved' : 'Removed from saved' });
    } catch (e: any) {
      setSaved(previous);
      showToast({ type: 'error', title: 'Could not save', message: e?.message || 'Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  const handleReport = async () => {
    if (!user) {
      router.push(`/login?redirect=/homes/${id}`);
      return;
    }
    if (!reportReason.trim()) {
      showToast({ type: 'error', title: 'Reason required', message: 'Tell us why this listing should be reviewed.' });
      return;
    }
    if (reporting) return;
    setReporting(true);
    try {
      await createHomeReport({
        listingId: id,
        type: reportType,
        reason: reportReason.trim(),
        description: reportDescription.trim() || undefined,
      }, token);
      showToast({ type: 'success', title: 'Report submitted', message: 'Our moderation team will review this listing.' });
      setReportOpen(false);
      setReportReason('');
      setReportDescription('');
    } catch (e: any) {
      showToast({ type: 'error', title: 'Could not submit report', message: e?.message || 'Please try again.' });
    } finally {
      setReporting(false);
    }
  };

  // Opens a VANTA conversation with the owner and navigates into it.
  const handleContact = async (prefill?: string) => {
    if (!user) {
      showToast({ type: 'error', title: 'Sign in required', message: 'Log in to message the owner.' });
      router.push(`/login?redirect=/homes/${id}`);
      return;
    }
    if (isOwner) {
      showToast({ type: 'info', title: 'This is your listing', message: 'Manage enquiries from your Homes dashboard.' });
      return;
    }
    if (contacting) return;
    setContacting(true);
    try {
      const result = await contactHomeListing(id, prefill, token);
      const conversationId = result?.conversationId;
      if (conversationId) {
        // `/chat/[id]` is the canonical conversation route; `/messages/[id]`
        // is only a legacy redirect to it.
        router.push(`/chat/${encodeURIComponent(conversationId)}`);
      } else {
        showToast({ type: 'success', title: 'Message sent', message: 'The owner has been notified.' });
        setShowComposer(false);
        setMessage('');
      }
    } catch (e: any) {
      showToast({ type: 'error', title: 'Could not send', message: e?.message || 'Please try again.' });
    } finally {
      setContacting(false);
    }
  };

  const handleShare = async () => {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const title = listing?.title || 'VANTA Homes';
    try {
      if (navigator.share) {
        await navigator.share({ title, text: listing?.description || title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      showToast({ type: 'success', title: 'Link copied', message: 'Share it with anyone looking for a place.' });
    } catch {
      // A dismissed share sheet throws AbortError; nothing to report then.
    }
  };

  const stepGallery = useCallback((delta: number) => {
    setViewerIndex((i) => (media.length === 0 ? 0 : (i + delta + media.length) % media.length));
  }, [media.length]);

  const rent = typeof listing?.rentAmount === 'number' ? formatCurrency(listing.rentAmount, listing.currency || 'NGN') : '';
  const periodSuffix = PERIOD_LABEL[listing?.rentPeriod || 'MONTHLY'] || '/month';
  const typeLabel = TYPE_LABEL[listing?.propertyType || 'OTHER'] || 'Other';

  // ---------------------------------------------------------------------------
  // Loading / error / empty states
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="min-h-[var(--vanta-vh,100dvh)] bg-[var(--background)]">
        <div className="max-w-5xl mx-auto px-4 py-6">
          <Skeleton className="w-24 h-4 mb-6" />
          <Skeleton variant="rectangular" className="h-72 sm:h-96 w-full mb-4" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <Skeleton className="w-3/4 h-7" />
              <Skeleton className="w-1/2 h-5" />
              <Skeleton className="w-full h-32" />
            </div>
            <div className="space-y-4">
              <Skeleton className="w-full h-48" />
              <Skeleton className="w-full h-32" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !listing) {
    return (
      <div className="min-h-[var(--vanta-vh,100dvh)] bg-[var(--background)]">
        <div className="max-w-5xl mx-auto px-4 py-10">
          <button
            onClick={() => router.push('/homes')}
            className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm mb-6 transition-colors"
          >
            <ArrowLeft size={16} /> Back to homes
          </button>
          <EmptyState
            icon={<Home size={24} />}
            title="Listing unavailable"
            description={error || 'We could not find this property.'}
            action={
              <div className="flex items-center gap-2">
                <Button variant="gold" onClick={() => void load()}>Try again</Button>
                <Button variant="outline" onClick={() => router.push('/homes')}>Browse all homes</Button>
              </div>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[var(--vanta-vh,100dvh)] bg-[var(--background)] text-[var(--foreground)]">
      <div className="max-w-5xl mx-auto px-4 py-5 pb-24">
        {/* Top bar ------------------------------------------------------- */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <button
            onClick={() => router.push('/homes')}
            className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm transition-colors"
          >
            <ArrowLeft size={16} /> All homes
          </button>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" icon={<Share2 size={16} />} onClick={() => void handleShare()}>
              Share
            </Button>
            {!isOwner && (
              <Button
                size="sm"
                variant={saved ? 'gold' : 'goldGhost'}
                icon={<Bookmark size={16} fill={saved ? 'currentColor' : 'none'} />}
                loading={saving}
                onClick={() => void handleSave()}
              >
                {saved ? 'Saved' : 'Save'}
              </Button>
            )}
            {!isOwner && (
              <Button size="sm" variant="ghost" icon={<Flag size={15} />} onClick={() => setReportOpen((open) => !open)}>
                Report
              </Button>
            )}
          </div>
        </div>

        {reportOpen && !isOwner && (
          <Card variant="glass" padding="lg" className="mb-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-white">Report this listing</h2>
              <button type="button" onClick={() => setReportOpen(false)} className="text-sm text-white/50 hover:text-white">Cancel</button>
            </div>
            <div className="space-y-3">
              <label className="block text-xs font-medium text-white/60" htmlFor="home-report-type">Reason category</label>
              <select id="home-report-type" value={reportType} onChange={(event) => setReportType(event.target.value)} className="w-full rounded-[var(--radius-lg)] border border-white/[0.1] bg-black/30 px-3 py-2.5 text-sm text-white">
                <option value="SCAM">Suspected scam</option>
                <option value="FAKE_PROPERTY">Fake property</option>
                <option value="UNAUTHORIZED_LISTING">Unauthorized listing</option>
                <option value="MISLEADING_MEDIA">Misleading photos or description</option>
                <option value="INCORRECT_PRICE">Incorrect price or hidden charges</option>
                <option value="DUPLICATE_LISTING">Duplicate listing</option>
                <option value="ALREADY_RENTED">Already rented</option>
                <option value="INAPPROPRIATE">Inappropriate content</option>
                <option value="OTHER">Other</option>
              </select>
              <label className="block text-xs font-medium text-white/60" htmlFor="home-report-reason">What happened? <span className="text-red-300">*</span></label>
              <textarea id="home-report-reason" value={reportReason} onChange={(event) => setReportReason(event.target.value)} rows={2} maxLength={500} required placeholder="Describe the concern so our moderators can review it." className="w-full resize-y rounded-[var(--radius-lg)] border border-white/[0.1] bg-black/30 px-3 py-2.5 text-sm text-white placeholder-white/30" />
              <label className="block text-xs font-medium text-white/60" htmlFor="home-report-details">Additional details (optional)</label>
              <textarea id="home-report-details" value={reportDescription} onChange={(event) => setReportDescription(event.target.value)} rows={2} maxLength={1000} placeholder="Add any helpful context." className="w-full resize-y rounded-[var(--radius-lg)] border border-white/[0.1] bg-black/30 px-3 py-2.5 text-sm text-white placeholder-white/30" />
              <div className="flex justify-end">
                <Button variant="gold" loading={reporting} onClick={() => void handleReport()}>Submit report</Button>
              </div>
            </div>
          </Card>
        )}

        {/* Owner-only banner while the listing is not public -------------- */}
        {isOwner && listing.availabilityStatus !== 'PUBLISHED' && (
          <div className="mb-4 flex items-center gap-2 rounded-[var(--radius-xl)] border border-[#c9a227]/30 bg-[#c9a227]/[0.07] px-3.5 py-2.5 text-sm text-[#e6c65a]">
            <AlertCircle size={16} className="shrink-0" />
            <span>
              This listing is{' '}
              <strong>{(listing.availabilityStatus || 'DRAFT').replace(/_/g, ' ').toLowerCase()}</strong> and is only
              visible to you until it is published.
            </span>
          </div>
        )}

        {/* Media gallery ------------------------------------------------- */}
        <Card variant="glass" padding="none" className="mb-6 overflow-hidden">
          <div className="relative bg-black/40">
            <div className="relative h-64 sm:h-96">
              {activeMedia ? (
                activeMedia.type === 'VIDEO' ? (
                  <video
                    key={activeMedia.id}
                    src={activeSrc || undefined}
                    poster={activeMedia.thumbnailUrl || undefined}
                    controls
                    playsInline
                    className="h-full w-full object-contain bg-black"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setLightboxOpen(true)}
                    className="group relative h-full w-full"
                    aria-label="Open photo full screen"
                  >
                    <img
                      src={activeSrc || undefined}
                      alt={listing.title}
                      className="h-full w-full object-contain bg-black"
                    />
                    <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-black/60 px-2.5 py-1.5 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                      <Maximize2 size={13} /> View
                    </span>
                  </button>
                )
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-white/25">
                  <Home size={40} />
                  <span className="text-xs">No photos yet</span>
                </div>
              )}

              {statusMeta && (
                <span
                  className={`absolute left-3 top-3 z-10 rounded-[var(--radius-md)] border px-2.5 py-1 text-xs font-semibold backdrop-blur ${statusMeta.className}`}
                >
                  {statusMeta.label}
                </span>
              )}

              {media.length > 1 && (
                <>
                  <button
                    onClick={() => stepGallery(-1)}
                    className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white/80 backdrop-blur transition hover:bg-black/70 hover:text-white"
                    aria-label="Previous photo"
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <button
                    onClick={() => stepGallery(1)}
                    className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white/80 backdrop-blur transition hover:bg-black/70 hover:text-white"
                    aria-label="Next photo"
                  >
                    <ChevronRight size={20} />
                  </button>
                </>
              )}
            </div>

            {media.length > 1 && (
              <div className="flex gap-2 overflow-x-auto px-3 py-3">
                {media.map((item, index) => {
                  const thumb = item.thumbnailUrl || item.uploadedFile?.url || '';
                  const isActive = index === activeIndex;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setViewerIndex(index)}
                      className={`relative h-14 w-20 shrink-0 overflow-hidden rounded-[var(--radius-md)] border transition ${
                        isActive ? 'border-[#c9a227]' : 'border-white/10 opacity-60 hover:opacity-100'
                      }`}
                      aria-label={`View ${item.type === 'VIDEO' ? 'video' : 'photo'} ${index + 1}`}
                      aria-current={isActive}
                    >
                      {thumb ? (
                        <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center bg-white/5">
                          <Home size={14} className="text-white/30" />
                        </span>
                      )}
                      {item.type === 'VIDEO' && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                          <Play size={14} className="text-white" fill="currentColor" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </Card>

        <ImageViewer
          src={lightboxOpen && activeMedia?.type === 'IMAGE' ? activeSrc : null}
          alt={listing.title}
          onClose={() => setLightboxOpen(false)}
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Left: the listing itself ------------------------------------ */}
          <div className="lg:col-span-2 space-y-5">
            <Card variant="glass" padding="lg">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="text-2xl font-bold text-white leading-tight">{listing.title}</h1>
                  <p className="mt-2 flex items-center gap-1.5 text-sm text-white/55">
                    <MapPin size={15} className="shrink-0" />
                    {locationLine(listing)}
                  </p>
                </div>
                <span className="shrink-0 rounded-[var(--radius-md)] bg-white/[0.05] px-2.5 py-1 text-xs font-semibold text-white/70">
                  {typeLabel}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap items-baseline gap-1.5">
                <span className="text-3xl font-bold text-[#c9a227]">{rent}</span>
                <span className="text-sm text-white/45">{periodSuffix}</span>
              </div>

              {/* Attribute chips */}
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-[var(--radius-lg)] bg-white/[0.04] px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-white/40">
                    <Bed size={13} /> Bedrooms
                  </div>
                  <div className="mt-1 text-lg font-semibold text-white">{listing.bedrooms ?? '—'}</div>
                </div>
                <div className="rounded-[var(--radius-lg)] bg-white/[0.04] px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-white/40">
                    <Bath size={13} /> Bathrooms
                  </div>
                  <div className="mt-1 text-lg font-semibold text-white">{listing.bathrooms ?? '—'}</div>
                </div>
                <div className="rounded-[var(--radius-lg)] bg-white/[0.04] px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-white/40">
                    <Building2 size={13} /> Furnishing
                  </div>
                  <div className="mt-1 text-lg font-semibold text-white">
                    {listing.furnished ? 'Furnished' : 'Unfurnished'}
                  </div>
                </div>
                <div className="rounded-[var(--radius-lg)] bg-white/[0.04] px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-white/40">
                    <CalendarDays size={13} /> Rent period
                  </div>
                  <div className="mt-1 text-lg font-semibold text-white">
                    {PERIOD_NAME[listing.rentPeriod || 'MONTHLY'] || 'Monthly'}
                  </div>
                </div>
              </div>
            </Card>

            {/* Description */}
            <Card variant="glass" padding="lg">
              <h2 className="mb-3 text-lg font-semibold text-white">About this home</h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-white/65">
                {listing.description || 'The owner has not added a description yet.'}
              </p>
            </Card>

            {/* Amenities */}
            {amenities.length > 0 && (
              <Card variant="glass" padding="lg">
                <h2 className="mb-3 text-lg font-semibold text-white">What this place offers</h2>
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {amenities.map((amenity) => (
                    <li
                      key={amenity}
                      className="flex items-center gap-2 rounded-[var(--radius-md)] bg-white/[0.03] px-3 py-2 text-sm text-white/70"
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#c9a227]" />
                      {amenityLabel(amenity)}
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {/* Costs: deposit + disclosed fees + move-in note */}
            {(typeof listing.depositAmount === 'number' || fees.length > 0 || listing.moveInInfo) && (
              <Card variant="glass" padding="lg">
                <h2 className="mb-3 text-lg font-semibold text-white">Costs &amp; move-in</h2>
                <ul className="divide-y divide-white/[0.06]">
                  {typeof listing.depositAmount === 'number' && listing.depositAmount > 0 && (
                    <li className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <span className="flex items-center gap-2 text-white/60">
                        <Wallet size={15} /> Security deposit
                      </span>
                      <span className="font-semibold text-white">
                        {formatCurrency(listing.depositAmount, listing.currency || 'NGN')}
                      </span>
                    </li>
                  )}
                  {fees.map((fee, index) => (
                    <li key={`${fee.label || 'fee'}-${index}`} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <span className="text-white/60">{fee.label || 'Additional fee'}</span>
                      <span className="font-semibold text-white">
                        {typeof fee.amount === 'number'
                          ? formatCurrency(fee.amount, fee.currency || listing.currency || 'NGN')
                          : '—'}
                      </span>
                    </li>
                  ))}
                </ul>
                {listing.moveInInfo && (
                  <p className="mt-3 flex items-start gap-2 rounded-[var(--radius-md)] bg-white/[0.03] px-3 py-2.5 text-sm text-white/60">
                    <CalendarDays size={15} className="mt-0.5 shrink-0" />
                    <span>{listing.moveInInfo}</span>
                  </p>
                )}
              </Card>
            )}
          </div>

          {/* Right: owner + contact ---------------------------------------- */}
          <div className="space-y-5 lg:sticky lg:top-5">
            {/* Owner */}
            <Card variant="glass" padding="lg">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/40">Listed by</h2>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => owner?.username && router.push(`/profile/${owner.username}`)}
                  disabled={!owner?.username}
                  className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-white/[0.06] disabled:cursor-default"
                  aria-label={owner?.username ? `View ${ownerName}'s profile` : 'Property owner'}
                >
                  {owner?.avatar ? (
                    <img src={owner.avatar} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-white/40">
                      <User size={22} />
                    </span>
                  )}
                </button>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate font-semibold text-white">{ownerName}</p>
                    {verif.type !== 'NONE' && <VerificationBadge type={verif.type} verified size="sm" showTooltip />}
                  </div>
                  <p className="text-xs text-white/45">{verif.label}</p>
                </div>
              </div>
              {verif.type === 'NONE' && (
                <p className="mt-3 flex items-start gap-2 rounded-[var(--radius-md)] bg-white/[0.03] px-3 py-2.5 text-xs leading-relaxed text-white/50">
                  <Shield size={14} className="mt-0.5 shrink-0" />
                  <span>
                    This owner has not completed VANTA verification. Keep conversations and payments inside VANTA
                    until you have seen the property.
                  </span>
                </p>
              )}
            </Card>

            {/* Contact */}
            <Card variant="glass" padding="lg">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/40">Contact</h2>

              {isOwner ? (
                <div className="space-y-3">
                  <p className="text-sm text-white/55">This is your listing. Review enquiries from your dashboard.</p>
                  <Button variant="gold" fullWidth onClick={() => router.push('/homes/manage')}>
                    Manage this listing
                  </Button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {canContact && (
                    <Button
                      variant="gold"
                      fullWidth
                      icon={<MessageCircle size={17} />}
                      loading={contacting}
                      onClick={() => (message.trim() ? void handleContact(message.trim()) : setShowComposer(true))}
                    >
                      Message on VANTA
                    </Button>
                  )}

                  {contactOptions?.whatsappUrl && (
                    <a
                      href={contactOptions.whatsappUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-emerald-400/30 bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/20"
                    >
                      <WhatsAppGlyph size={17} /> Chat on WhatsApp
                    </a>
                  )}

                  {contactOptions?.phoneUrl && (
                    <a
                      href={contactOptions.phoneUrl}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-white/[0.1] bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white/80 transition hover:bg-white/[0.08]"
                    >
                      <Phone size={16} /> {contactOptions.phone || 'Call owner'}
                    </a>
                  )}

                  {!canContact && !contactOptions?.whatsappUrl && !contactOptions?.phoneUrl && (
                    <p className="text-sm text-white/50">This owner is not accepting enquiries right now.</p>
                  )}

                  <p className="pt-1 text-xs leading-relaxed text-white/35">
                    Never send a deposit before you have viewed the home. VANTA does not process rental payments.
                  </p>
                </div>
              )}

              {/* Inline composer ------------------------------------------- */}
              {showComposer && !isOwner && (
                <div className="mt-4 border-t border-white/[0.06] pt-4">
                  <label htmlFor="home-enquiry" className="mb-2 block text-xs font-medium text-white/50">
                    Your message
                  </label>
                  <textarea
                    id="home-enquiry"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    rows={3}
                    placeholder="Hi, is this home still available? I'd like to arrange a viewing."
                    className="w-full resize-none rounded-[var(--radius-lg)] border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder-white/30 outline-none transition focus:border-[#c9a227]/60"
                  />
                  <div className="mt-2.5 flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="gold"
                      loading={contacting}
                      disabled={message.trim().length === 0}
                      onClick={() => void handleContact(message.trim())}
                    >
                      Send &amp; open chat
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setShowComposer(false); setMessage(''); }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </Card>

            {/* Listing meta */}
            <Card variant="glass" padding="md">
              <ul className="space-y-2 text-xs text-white/40">
                {listing.publishedAt && (
                  <li className="flex items-center gap-2">
                    <CalendarDays size={13} /> Listed {formatDate(listing.publishedAt)}
                  </li>
                )}
                <li className="flex items-center gap-2">
                  <AlertCircle size={13} /> Reference {String(listing.id).slice(0, 10).toUpperCase()}
                </li>
              </ul>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}


