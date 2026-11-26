'use client';

import BookmarkIcon from '@/components/ui/BookmarkIcon';

import React, { useState } from 'react';
import Link from 'next/link';
import { useToast } from '@/components/ui/Toast';
import { toggleSaveHome } from '@/lib/services';
import HomeMediaImage from './HomeMediaImage';
import { isHomeVideo } from '@/lib/homeMedia';
import { useAuth } from '@/context/AuthContext';
import { MapPin, Bed, Bath, Home, Play } from 'lucide-react';

export interface PropertyCardProps { listing: any; }

const PERIOD_LABEL: Record<string, string> = { WEEKLY: '/week', MONTHLY: '/month', YEARLY: '/year' };
const CURRENCY_SYMBOL: Record<string, string> = {
  NGN: '₦', USD: '$', GBP: '£', EUR: '€', CAD: 'C$', AUD: 'A$',
  GHS: '₵', KES: 'KSh', ZAR: 'R', INR: '₹', JPY: '¥', CNY: '¥',
};
const formatHomePrice = (value: number, currency = 'NGN') => {
  const symbol = CURRENCY_SYMBOL[currency.toUpperCase()] || currency.toUpperCase() + ' ';
  return symbol + new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(Number(value) || 0);
};

const TYPE_LABEL: Record<string, string> = {
  APARTMENT: 'Apartment', STUDIO: 'Studio', FLAT: 'Flat',
  DETACHED_HOUSE: 'Detached house', SEMI_DETACHED_HOUSE: 'Semi-detached house',
  DUPLEX: 'Duplex', ROOM_SHARED: 'Shared room', OTHER: 'Other',
};

export default function PropertyCard({ listing }: PropertyCardProps) {
  const { user, token } = useAuth();
  const { showToast } = useToast();
  const [saved, setSaved] = useState<boolean>(Boolean(listing.isSaved));
  const [saving, setSaving] = useState(false);
  const cover = Array.isArray(listing.media) ? [...listing.media].sort((a, b) => Number(Boolean(b.isCover)) - Number(Boolean(a.isCover)) || (a.order ?? 0) - (b.order ?? 0))[0] : null;
  const price = formatHomePrice(listing.rentAmount, listing.currency || 'NGN');
  const period = PERIOD_LABEL[listing.rentPeriod || 'MONTHLY'] || '/month';
  const type = TYPE_LABEL[listing.propertyType || 'OTHER'] || 'Other';

  const handleSave = async () => {
    if (!user) {
      showToast({ type: 'error', title: 'Login required', message: 'Please log in to save properties.' });
      return;
    }
    if (saving) return;
    const previous = saved;
    setSaved(!previous);
    setSaving(true);
    try {
      const result = await toggleSaveHome(listing.id, token);
      setSaved(Boolean(result?.saved));
      showToast({ type: 'success', title: result?.saved ? 'Saved to your homes' : 'Removed from saved homes' });
    } catch (e: any) {
      setSaved(previous);
      showToast({ type: 'error', title: 'Could not update saved homes', message: e?.message || 'Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  if (listing.loading) return <div className="animate-pulse"><div className="aspect-[4/3] rounded-xl bg-white/[.06]" /><div className="mt-3 h-4 w-2/3 rounded bg-white/[.06]" /><div className="mt-2 h-4 w-1/3 rounded bg-white/[.06]" /></div>;

  return (
    <article className="group flex min-w-0 flex-col">
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-[#151a21] ring-1 ring-white/[.07]">
        <Link href={'/homes/' + listing.id} className="absolute inset-0 block" aria-label={'View ' + listing.title}>
          <HomeMediaImage key={cover?.id || listing.id} media={cover} alt={listing.title || 'Property photo'} thumbnailFirst className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]" />
          {isHomeVideo(cover) && <span className="absolute inset-0 flex items-center justify-center bg-black/25"><Play size={28} className="text-white" /></span>}
        </Link>
        <span className="absolute bottom-3 left-3 max-w-[calc(100%-4rem)] truncate rounded-full bg-black/65 px-3 py-1.5 text-[10px] font-semibold tracking-wide text-white backdrop-blur-sm">{type}</span>
        <button type="button" onClick={() => void handleSave()} disabled={saving} className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full border border-white/15 bg-black/55 text-white shadow-lg backdrop-blur-md transition hover:bg-black/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c9a227] disabled:opacity-60" aria-label={saved ? 'Remove from saved homes' : 'Save this property'} aria-pressed={saved}>
          <BookmarkIcon size={17} saved={saved} />
        </button>
      </div>
      <div className="flex min-w-0 flex-1 flex-col px-0 pb-2 pt-3">
        <Link href={'/homes/' + listing.id} className="block min-w-0 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#c9a227]">
          <h3 className="line-clamp-2 min-h-[2.9em] break-words text-[13px] font-semibold leading-[1.45] text-white transition group-hover:text-[#e4c65d] sm:text-sm">{listing.title}</h3>
        </Link>
        <p className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-white/50 sm:text-xs"><MapPin size={13} className="shrink-0" /><span className="line-clamp-2 break-words">{[listing.area, listing.city].filter(Boolean).join(', ') || 'Location not specified'}</span></p>
        <div className="mt-2.5 flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1">
          <p className="max-w-full break-words text-sm font-bold leading-5 tabular-nums text-[#e4c65d] sm:text-base">{price}</p>
          <p className="shrink-0 text-[11px] text-white/40">{period}</p>
        </div>
        <div className="mt-auto flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 pt-2 text-[10px] text-white/50 sm:text-[11px]">
          <span className="inline-flex items-center gap-1.5"><Bed size={14} className="shrink-0" /> {listing.bedrooms ?? '—'} beds</span>
          <span className="inline-flex items-center gap-1.5"><Bath size={14} className="shrink-0" /> {listing.bathrooms ?? '—'} baths</span>
          {listing.furnished && <span>Furnished</span>}
          <Link href={'/homes/' + listing.id} className="ml-auto inline-flex min-h-7 items-center text-[11px] font-semibold text-white/75 transition hover:text-[#e4c65d]">View <span className="ml-1" aria-hidden="true">→</span></Link>
        </div>
      </div>
    </article>
  );
}
