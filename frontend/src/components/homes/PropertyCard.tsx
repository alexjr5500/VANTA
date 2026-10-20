'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatDate } from '@/lib/utils';
import { useI18n } from '@/lib/i18n/context';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Skeleton from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { toggleSaveHome } from '@/lib/services';
import { useAuth } from '@/context/AuthContext';
import { MapPin, Bed, Bath, Home, Play, Save } from 'lucide-react';

export interface PropertyCardProps {
  listing: any;
}

const PERIOD_LABEL: Record<string, string> = { WEEKLY: '/week', MONTHLY: '/month', YEARLY: '/year' };
const TYPE_LABEL: Record<string, string> = {
  APARTMENT: 'Apartment', STUDIO: 'Studio', FLAT: 'Flat',
  DETACHED_HOUSE: 'Detached House', SEMI_DETACHED_HOUSE: 'Semi-Detached House',
  DUPLEX: 'Duplex', ROOM_SHARED: 'Shared Room', OTHER: 'Other',
};

export default function PropertyCard({ listing }: PropertyCardProps) {
  const { locale } = useI18n();
  const { user, token } = useAuth();
  const { showToast } = useToast();
  const router = useRouter();
  const [saved, setSaved] = useState<boolean>(Boolean(listing.isSaved));

  const cover = listing.media?.[0];
  const { formatCurrency } = useI18n();
  const price = formatCurrency(listing.rentAmount, listing.currency || 'NGN');
  const period = PERIOD_LABEL[listing.rentPeriod || 'MONTHLY'] || '/month';
  const type = TYPE_LABEL[listing.propertyType || 'OTHER'] || 'Other';
  const isVerified = listing.ownerVerificationStatus === 'VERIFIED';

  const handleSave = async () => {
    if (!user) { showToast({ type: 'error', title: 'Login required', message: 'Please log in to save properties.' }); return; }
    const previous = saved;
    setSaved(!previous);
    try {
      const result = await toggleSaveHome(listing.id, token);
      setSaved(Boolean(result?.saved));
      showToast({ type: 'success', title: result?.saved ? 'Saved' : 'Removed from saved' });
    } catch (e: any) {
      setSaved(previous);
      showToast({ type: 'error', title: 'Error', message: e?.message || 'Could not save property' });
    }
  };

  if (listing.loading) {
    return (<Card variant="glass" padding="none" className="max-w-md"><Skeleton variant="card" className="h-64" /></Card>);
  }

  return (
    <Card variant="hover" padding="none" className="max-w-md overflow-hidden">
      <div className="relative h-64 overflow-hidden">
        {cover ? (
          <div className="h-full w-full relative">
            <img src={cover.uploadedFile?.url || cover.url} alt={listing.title} className="h-full w-full object-cover" loading="lazy" />
            {cover.type === 'VIDEO' && (<div className="absolute inset-0 flex items-center justify-center bg-black/40"><Play size={24} className="text-white" /></div>)}
          </div>
        ) : (
          <div className="h-full w-full bg-white/[0.05] flex items-center justify-center"><Home size={32} className="text-white/20" /></div>
        )}
        <div className="absolute top-3 left-3 z-10 flex gap-2">
          <span className={`px-2 py-0.5 rounded text-xs font-bold border ${listing.availabilityStatus === 'PUBLISHED' ? 'text-emerald-400 border-emerald-400/40' : 'text-white/50 border-white/[0.1]'}`}>{listing.availabilityStatus === 'PUBLISHED' ? 'Available' : 'Unavailable'}</span>
          {isVerified && (<span className="bg-[#c9a227]/20 text-[#c9a227] text-xs font-bold px-2 py-1 rounded border border-[#c9a227]/40">Verified Owner</span>)}
        </div>
        <button onClick={(e) => { e.stopPropagation(); handleSave(); }} className="absolute top-3 right-3 z-10 p-2 bg-white/[0.1] backdrop-blur rounded-full hover:bg-white/[0.2] transition" aria-label={saved ? 'Unsave property' : 'Save property'}>
          {saved ? (<Save size={18} className="text-[#c9a227]" />) : (<Save size={18} className="text-white" />)}
        </button>
      </div>
      <div className="p-4">
        <Link href={`/homes/${listing.id}`} className="block">
          <h3 className="font-semibold text-white leading-tight mb-1">{listing.title}</h3>
          <p className="text-sm text-white/50 mb-3">{listing.area || listing.city} {listing.area && listing.city ? '·' : ''} {listing.city}</p>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1 text-[#c9a227] font-bold text-lg">{price}</div>
            <span className="text-xs text-white/40">{period}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-white/60 mb-3">
            <span className="flex items-center gap-1"><Bed size={14} /> {listing.bedrooms}</span>
            <span className="flex items-center gap-1"><Bath size={14} /> {listing.bathrooms}</span>
            <span className="flex items-center gap-1"><Home size={14} /> {type}</span>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-xs text-white/40 flex-1"><MapPin size={12} className="mr-1" /> {listing.area || listing.city}</p>
            <span className="text-xs text-white/40">{formatDate(listing.createdAt || listing.updatedAt)}</span>
          </div>
        </Link>
        <div className="mt-3 pt-3 border-t border-white/[0.06] flex items-center justify-between">
          <Button size="sm" variant="ghost" onClick={() => router.push(`/homes/${listing.id}`)}>View details</Button>
          <Button size="sm" variant="goldGhost" onClick={() => router.push(`/homes/${listing.id}`)}>Contact</Button>
        </div>
      </div>
    </Card>
  );
}