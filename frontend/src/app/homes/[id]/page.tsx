'use client';

import BookmarkIcon from '@/components/ui/BookmarkIcon';

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
import { formatDate } from '@/lib/utils';
import Avatar from '@/components/ui/Avatar';
import HomeMediaImage from '@/components/homes/HomeMediaImage';
import { homeMediaSource, homeImageCandidates, isHomeVideo } from '@/lib/homeMedia';
import VerificationBadge from '@/components/ui/VerificationBadge';
import {
  MapPin, Bed, Bath, Home, Play, Share2, Phone, MessageCircle,
  AlertCircle, User, ChevronLeft, ChevronRight, Maximize2,
  CalendarDays, Building2, Wallet, Shield, ArrowLeft, Flag,
} from 'lucide-react';

const CURRENCY_SYMBOL: Record<string, string> = {
  NGN: '₦', USD: '$', GBP: '£', EUR: '€', CAD: 'C$', AUD: 'A$',
  GHS: '₵', KES: 'KSh', ZAR: 'R', INR: '₹', JPY: '¥', CNY: '¥',
};
const formatHomePrice = (value: number, currency = 'NGN') => {
  const symbol = CURRENCY_SYMBOL[currency.toUpperCase()] || currency.toUpperCase() + ' ';
  return symbol + new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(Number(value) || 0);
};

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
  type: 'IMAGE' | 'VIDEO' | 'PHOTO' | 'image' | 'video';
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
  const [loadedPhoto, setLoadedPhoto] = useState<{id: string; src: string} | null>(null);

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
    return [...items].sort((a, b) => Number(Boolean(b.isCover)) - Number(Boolean(a.isCover)) || (a.order ?? 0) - (b.order ?? 0));
  }, [listing]);

  const activeIndex = Math.min(viewerIndex, Math.max(media.length - 1, 0));
  const activeMedia = media[activeIndex] || null;
  const activeSrc = homeMediaSource(activeMedia);
  const activePhoto = loadedPhoto?.id === activeMedia?.id ? loadedPhoto?.src : null;

  const amenities = useMemo(() => parseJsonArray<string>(listing?.amenities), [listing]);
  const fees = useMemo<MediaFee[]>(() => parseJsonArray<MediaFee>(listing?.additionalFees), [listing]);

  const owner = listing?.owner as ListingOwner | undefined;
  const ownerName = owner?.fullName || (owner?.username ? `@${owner.username}` : 'Property owner');
  const verif = VERIFICATION_META[listing?.ownerVerificationStatus || 'UNVERIFIED'] || VERIFICATION_META.UNVERIFIED;
  const statusMeta = STATUS_META[listing?.availabilityStatus || ''] || null;
  const isOwner = Boolean(user && owner && user.id === owner.id);
  // Only show VANTA messaging after the published listing's contact settings explicitly allow it.
  // A failed or pending contact-options request must never default to enabled.
  const canContact = contactOptions?.vantaMessaging === true;

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
        // Open the conversation through VANTA's single canonical chat route.
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

  const rent = typeof listing?.rentAmount === 'number' ? formatHomePrice(listing.rentAmount, listing.currency || 'NGN') : '';
  const periodSuffix = PERIOD_LABEL[listing?.rentPeriod || 'MONTHLY'] || '/month';
  const typeLabel = TYPE_LABEL[listing?.propertyType || 'OTHER'] || 'Other';

  // ---------------------------------------------------------------------------
  // Loading / error / empty states
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="relative left-1/2 min-h-[var(--vanta-vh,100dvh)] w-screen max-w-none -translate-x-1/2 overflow-x-clip bg-[var(--background)]">
        <div className="w-full px-0 py-4">
          <Skeleton className="w-24 h-4 mb-6" />
          <Skeleton variant="rectangular" className="h-72 sm:h-96 w-full mb-4" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <Skeleton className="w-3/4 h-7" />
              <Skeleton className="w-1/2 h-5" />
              <Skeleton className="w-full h-32" />
            </div>
            <div className="min-w-0 space-y-4">
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
        <div className="w-full px-0 py-6">
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
    <main className="relative left-1/2 h-[var(--vanta-vh,100dvh)] min-h-0 w-screen max-w-none -translate-x-1/2 overflow-x-clip bg-[#080808] text-white flex flex-col overflow-hidden">
      <header className="relative z-50 h-14 shrink-0 border-b border-white/[.07] bg-[#1f2630]/95 px-3 backdrop-blur-xl sm:px-5">
        <div className="flex h-full w-full items-center justify-between gap-3">
          <a href="/homes" className="flex min-w-0 items-center gap-2.5" aria-label="VANTA Homes">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#c9a227] text-black"><Building2 size={19} /></span>
            <span className="flex items-baseline gap-2"><span className="text-sm font-black tracking-[.16em] text-[#d7b548]">VANTA</span><span className="text-sm font-medium text-white/80">Homes</span></span>
          </a>
          <div className="flex shrink-0 items-center gap-2">
            <a href="/homes/manage" className="hidden px-2 py-2 text-sm text-white/55 transition hover:text-white sm:inline-flex">My listings</a>
            <a href="/homes/create" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#c9a227] px-3 text-xs font-bold text-black transition hover:bg-[#e0bd46] sm:px-4 sm:text-sm"><Home size={15} /> List a property</a>
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">


      <div className="mx-auto w-full max-w-[1440px] pb-28 lg:pb-12">
        <div className="flex min-h-12 items-center justify-between gap-3 px-3 sm:px-5 lg:px-8">
          <button type="button" onClick={() => router.push('/homes')} className="inline-flex min-h-10 items-center gap-2 text-sm text-white/55 transition hover:text-white"><ArrowLeft size={16} /> All homes</button>
          <div className="flex items-center gap-1 sm:gap-2">
            <button type="button" onClick={() => void handleShare()} aria-label="Share property" className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs text-white/65 transition hover:bg-white/[.06] hover:text-white sm:px-3 sm:text-sm"><Share2 size={15} /><span>Share</span></button>
            {!isOwner && <button type="button" onClick={() => void handleSave()} disabled={saving} aria-pressed={saved} className={"inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs transition sm:px-3 sm:text-sm " + (saved ? "text-[#dfbd55]" : "text-white/65 hover:text-white")}><BookmarkIcon size={15} saved={saved} /><span>{saved ? 'Saved' : 'Save'}</span></button>}
            {!isOwner && <button type="button" onClick={() => setReportOpen((open) => !open)} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs text-white/55 transition hover:bg-white/[.06] hover:text-white sm:px-3 sm:text-sm"><Flag size={14} /><span className="hidden sm:inline">Report</span></button>}
          </div>
        </div>

        {reportOpen && !isOwner && (
          <section className="mx-3 mb-4 border-y border-white/[.09] py-4 sm:mx-5">
            <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">Report this listing</h2><button type="button" onClick={() => setReportOpen(false)} className="text-sm text-white/50 hover:text-white">Cancel</button></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-3">
                <label className="block text-xs text-white/55" htmlFor="home-report-type">Reason category</label>
                <select id="home-report-type" value={reportType} onChange={(event) => setReportType(event.target.value)} className="w-full rounded-lg border border-white/10 bg-[#111] px-3 py-2.5 text-sm text-white">
                  <option value="SCAM">Suspected scam</option><option value="FAKE_PROPERTY">Fake property</option><option value="UNAUTHORIZED_LISTING">Unauthorized listing</option><option value="MISLEADING_MEDIA">Misleading photos or description</option><option value="INCORRECT_PRICE">Incorrect price or hidden charges</option><option value="DUPLICATE_LISTING">Duplicate listing</option><option value="ALREADY_RENTED">Already rented</option><option value="INAPPROPRIATE">Inappropriate content</option><option value="OTHER">Other</option>
                </select>
                <label className="block text-xs text-white/55" htmlFor="home-report-reason">What happened? *</label>
                <textarea id="home-report-reason" value={reportReason} onChange={(event) => setReportReason(event.target.value)} rows={3} maxLength={500} required placeholder="Describe the concern for our moderators." className="w-full resize-y rounded-lg border border-white/10 bg-[#111] px-3 py-2.5 text-sm text-white placeholder-white/30" />
              </div>
              <div className="flex flex-col gap-3">
                <label className="block text-xs text-white/55" htmlFor="home-report-details">Additional details (optional)</label>
                <textarea id="home-report-details" value={reportDescription} onChange={(event) => setReportDescription(event.target.value)} rows={4} maxLength={1000} placeholder="Add any helpful context." className="w-full flex-1 rounded-lg border border-white/10 bg-[#111] px-3 py-2.5 text-sm text-white placeholder-white/30" />
                <div className="flex justify-end"><Button variant="gold" loading={reporting} onClick={() => void handleReport()}>Submit report</Button></div>
              </div>
            </div>
          </section>
        )}

        {isOwner && listing.availabilityStatus !== 'PUBLISHED' && <div className="mx-3 mb-3 flex items-start gap-2 border-l-2 border-[#c9a227] bg-[#c9a227]/[.06] px-3 py-3 text-sm text-[#e6c65a] sm:mx-5"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>This listing is <strong>{(listing.availabilityStatus || 'DRAFT').replace(/_/g, ' ').toLowerCase()}</strong> and is only visible to you until it is published.</span></div>}

        <section aria-label="Property photos" className="relative mx-auto w-full overflow-hidden bg-[#111] sm:px-5 lg:px-8">
          <div className="relative h-[56vw] min-h-[230px] max-h-[560px] overflow-hidden bg-[#10151c] sm:rounded-2xl sm:ring-1 sm:ring-white/[.08] lg:h-[min(58vh,560px)]">
            {activeMedia ? (
              isHomeVideo(activeMedia) ? (
                <video key={activeMedia.id} src={activeSrc || undefined} poster={homeImageCandidates(activeMedia, true)[0] || undefined} controls playsInline className="h-full w-full bg-[#101010] object-contain" />
              ) : (
                <button type="button" disabled={!activePhoto} onClick={() => setLightboxOpen(true)} className="group relative block h-full w-full disabled:cursor-default" aria-label="Open photo full screen">
                  <HomeMediaImage key={activeMedia.id} media={activeMedia} alt={listing.title || "Property photo"} onReady={src => setLoadedPhoto({id: activeMedia.id, src})} />
                  <span className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-black/10" />
                  {activePhoto && <span className="absolute bottom-4 right-4 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-2 text-xs text-white backdrop-blur-sm"><Maximize2 size={13} /> View photo</span>}
                </button>
              )
            ) : <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-white/25"><Home size={42} strokeWidth={1.2} /><span className="text-xs">Photos coming soon</span></div>}
            {statusMeta && <span className={"absolute left-3 top-3 rounded-full px-3 py-1.5 text-xs font-semibold backdrop-blur " + statusMeta.className}>{statusMeta.label}</span>}
            {media.length > 1 && <>
              <button type="button" onClick={() => stepGallery(-1)} aria-label="Previous photo" className="absolute left-3 top-1/2 z-10 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white backdrop-blur transition hover:bg-black/80"><ChevronLeft size={21} /></button>
              <button type="button" onClick={() => stepGallery(1)} aria-label="Next photo" className="absolute right-3 top-1/2 z-10 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white backdrop-blur transition hover:bg-black/80"><ChevronRight size={21} /></button>
              <span className="absolute bottom-4 left-4 rounded-full bg-black/60 px-3 py-1.5 text-xs text-white/85 backdrop-blur">{activeIndex + 1} / {media.length}</span>
            </>}
          </div>
          {media.length > 1 && <div className="mx-auto flex max-w-[1440px] gap-2 overflow-x-auto px-3 py-2.5 sm:px-5 lg:px-8">
            {media.map((item, index) => {
              const isActive = index === activeIndex;
              return <button key={item.id} type="button" onClick={() => setViewerIndex(index)} className={"relative h-14 w-20 shrink-0 overflow-hidden rounded-md transition sm:h-16 sm:w-24 " + (isActive ? "ring-2 ring-[#c9a227] ring-offset-1 ring-offset-[#080808]" : "opacity-55 hover:opacity-100")} aria-label={"View media " + (index + 1)} aria-current={isActive}>
                <HomeMediaImage media={item} alt={`Property media ${index + 1}`} thumbnailFirst />
                {['VIDEO', 'video'].includes(item.type) && <span className="absolute inset-0 flex items-center justify-center bg-black/40"><Play size={15} className="text-white" fill="currentColor" /></span>}
              </button>;
            })}
          </div>}
        </section>

        <ImageViewer src={lightboxOpen && activeMedia && !isHomeVideo(activeMedia) ? activePhoto || null : null} alt={listing.title} onClose={() => setLightboxOpen(false)} />

        <div className="mx-auto grid w-full max-w-[1440px] grid-cols-1 gap-0 lg:grid-cols-[minmax(0,1fr)_340px] lg:px-8">
          <div className="min-w-0 px-4 sm:px-6 lg:px-8">
            <section className="border-b border-white/[.08] py-5 sm:py-7">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[.2em] text-[#c9a227]">{typeLabel}{listing.furnished ? ' · Furnished' : ''}</p>
                  <h1 className="text-2xl font-semibold leading-tight tracking-tight text-white sm:text-3xl lg:text-4xl">{listing.title}</h1>
                  <p className="mt-2 flex items-start gap-1.5 text-sm leading-5 text-white/55"><MapPin size={15} className="mt-0.5 shrink-0" />{locationLine(listing)}</p>
                </div>
                <div className="shrink-0 text-right"><p className="text-xl font-bold tabular-nums text-[#e4c65d] sm:text-2xl">{rent}</p><p className="mt-1 text-xs text-white/45">{periodSuffix}</p></div>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-white/[.06] pt-4 text-sm text-white/65">
                <span className="inline-flex items-center gap-2"><Bed size={17} className="text-[#c9a227]" /><strong className="font-semibold text-white">{listing.bedrooms ?? '—'}</strong> bedrooms</span>
                <span className="inline-flex items-center gap-2"><Bath size={17} className="text-[#c9a227]" /><strong className="font-semibold text-white">{listing.bathrooms ?? '—'}</strong> bathrooms</span>
                <span className="inline-flex items-center gap-2"><Building2 size={16} className="text-[#c9a227]" />{listing.furnished ? 'Furnished' : 'Unfurnished'}</span>
                <span className="inline-flex items-center gap-2"><CalendarDays size={16} className="text-[#c9a227]" />{PERIOD_NAME[listing.rentPeriod || 'MONTHLY'] || 'Monthly'} rent</span>
              </div>
            </section>

            <section className="border-b border-white/[.08] py-5 sm:py-7"><h2 className="text-base font-semibold text-white sm:text-lg">About this home</h2><p className="mt-3 whitespace-pre-line text-sm leading-7 text-white/65">{listing.description || 'The owner has not added a description yet.'}</p></section>

            {amenities.length > 0 && <section className="border-b border-white/[.08] py-5 sm:py-7">
              <h2 className="text-base font-semibold text-white sm:text-lg">Features & amenities</h2>
              <ul className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3">{amenities.map((amenity) => <li key={amenity} className="flex min-w-0 items-center gap-2 text-sm text-white/65"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#c9a227]" />{amenityLabel(amenity)}</li>)}</ul>
            </section>}

            {(typeof listing.depositAmount === 'number' || fees.length > 0 || listing.moveInInfo) && <section className="border-b border-white/[.08] py-5 sm:py-7">
              <h2 className="text-base font-semibold text-white sm:text-lg">Costs & move-in</h2>
              <ul className="mt-3 divide-y divide-white/[.06]">
                {typeof listing.depositAmount === 'number' && listing.depositAmount > 0 && <li className="flex items-center justify-between gap-3 py-3 text-sm"><span className="flex items-center gap-2 text-white/55"><Wallet size={15} /> Security deposit</span><span className="font-semibold text-white">{formatHomePrice(listing.depositAmount, listing.currency || 'NGN')}</span></li>}
                {fees.map((fee, index) => <li key={(fee.label || 'fee') + '-' + index} className="flex items-center justify-between gap-3 py-3 text-sm"><span className="text-white/55">{fee.label || 'Additional fee'}</span><span className="font-semibold text-white">{typeof fee.amount === 'number' ? formatHomePrice(fee.amount, fee.currency || listing.currency || 'NGN') : '—'}</span></li>)}
              </ul>
              {listing.moveInInfo && <p className="mt-3 flex items-start gap-2 text-sm leading-6 text-white/55"><CalendarDays size={15} className="mt-1 shrink-0 text-[#c9a227]" /><span>{listing.moveInInfo}</span></p>}
            </section>}
            <section className="py-5 text-xs text-white/35 sm:py-6"><div className="flex flex-wrap gap-x-5 gap-y-2">{listing.publishedAt && <span className="inline-flex items-center gap-1.5"><CalendarDays size={13} /> Listed {formatDate(listing.publishedAt)}</span>}<span>Reference {String(listing.id).slice(0, 10).toUpperCase()}</span></div></section>
          </div>

          <aside className="min-w-0 border-t border-white/[.08] bg-white/[.015] px-4 sm:px-6 lg:sticky lg:top-0 lg:self-start lg:border-l lg:border-t-0 lg:px-6 lg:py-7">
            <section className="py-5 lg:sticky lg:top-[4.5rem]">
              <h2 className="text-xs font-semibold uppercase tracking-[.16em] text-white/40">Property contact</h2>
              <div className="mt-4 flex items-center gap-3">
                <button type="button" onClick={() => owner?.username && router.push('/profile/' + owner.username)} disabled={!owner?.username} className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-white/[.06] disabled:cursor-default" aria-label={owner?.username ? "View " + ownerName + "'s profile" : 'Property owner'}>
                  <Avatar src={owner?.avatar} alt={ownerName} size="lg" />
                </button>
                <div className="min-w-0"><div className="flex items-center gap-1.5"><p className="truncate text-sm font-semibold text-white">{ownerName}</p>{verif.type !== 'NONE' && <VerificationBadge type={verif.type} verified size="sm" showTooltip />}</div><p className="mt-1 text-xs text-white/45">{verif.label}</p></div>
              </div>
              {verif.type === 'NONE' && <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-white/45"><Shield size={14} className="mt-0.5 shrink-0 text-[#c9a227]" /><span>This owner has not completed VANTA verification. View the property before sending money and keep communications on VANTA where possible.</span></p>}

              <div className="mt-5 space-y-2.5 border-t border-white/[.08] pt-5">
                {isOwner ? <><p className="text-sm leading-6 text-white/55">This is your listing. Manage it or review enquiries from your dashboard.</p><Button variant="gold" fullWidth onClick={() => router.push('/homes/manage')}>Manage this listing</Button></> : <>
                  {canContact && <Button variant="gold" fullWidth icon={<MessageCircle size={17} />} loading={contacting} onClick={() => (message.trim() ? void handleContact(message.trim()) : setShowComposer(true))}>Message on VANTA</Button>}
                  {contactOptions?.whatsappUrl && <a href={contactOptions.whatsappUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-emerald-400/25 px-4 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/[.08]"><WhatsAppGlyph size={17} /> Chat on WhatsApp</a>}
                  {contactOptions?.phoneUrl && <a href={contactOptions.phoneUrl} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-white/[.1] px-4 text-sm font-semibold text-white/75 transition hover:bg-white/[.04]"><Phone size={16} /> {contactOptions.phone || 'Call owner'}</a>}
                  {!canContact && !contactOptions?.whatsappUrl && !contactOptions?.phoneUrl && <p className="text-sm text-white/50">This owner is not accepting enquiries right now.</p>}
                  <p className="pt-2 text-xs leading-5 text-white/35">Never send a deposit before viewing the property. VANTA does not process rental payments.</p>
                </>}
              </div>

              {showComposer && !isOwner && <div className="mt-5 border-t border-white/[.08] pt-4">
                <label htmlFor="home-enquiry" className="mb-2 block text-xs font-medium text-white/55">Your message</label>
                <textarea id="home-enquiry" value={message} onChange={(event) => setMessage(event.target.value)} rows={3} placeholder="Hi, is this home still available? I'd like to arrange a viewing." className="w-full resize-none rounded-lg border border-white/[.1] bg-white/[.03] px-3 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-[#c9a227]/60" />
                <div className="mt-3 flex flex-wrap items-center gap-2"><Button size="sm" variant="gold" loading={contacting} disabled={message.trim().length === 0} onClick={() => void handleContact(message.trim())}>Send & open chat</Button><Button size="sm" variant="ghost" onClick={() => { setShowComposer(false); setMessage(''); }}>Cancel</Button></div>
              </div>}
            </section>
          </aside>
        </div>
      </div>

      {!isOwner && <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[.08] bg-[#080808]/95 px-3 py-3 backdrop-blur-xl lg:hidden"><div className="mx-auto flex max-w-3xl items-center gap-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-[#e4c65d]">{rent}<span className="ml-1 text-xs font-normal text-white/45">{periodSuffix}</span></p><p className="truncate text-[11px] text-white/45">{listing.title}</p></div>{canContact && <Button variant="gold" icon={<MessageCircle size={16} />} loading={contacting} onClick={() => (message.trim() ? void handleContact(message.trim()) : setShowComposer(true))}>Message owner</Button>}</div></div>}
    
      </div>
    </main>
  );
}

