'use client';

import { homeLocationLine } from '@/lib/homeLocation';

import React, { useEffect, useRef, useState } from 'react';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  fetchHome, createHomeListing, updateHomeListing, submitHomeListingForReview,
  uploadHomePhotos, deleteHomeMedia, fetchHomePropertyTypes, fetchHomeRentPeriods,
} from '@/lib/services';
import Skeleton from '@/components/ui/Skeleton';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import HomeMediaImage from '@/components/homes/HomeMediaImage';
import { ArrowLeft, Home as HomeIcon, ImagePlus, Trash2, Check, ChevronLeft, ChevronRight, MapPin, ShieldCheck, UploadCloud } from 'lucide-react';

const MAX_PHOTOS = 10;

function HomePhotoImage({ photo, alt = '' }: { photo: any; alt?: string }) {
  return <HomeMediaImage media={photo?.isLocalPreview ? {url: photo.previewUrl} : photo ? {...photo, url: photo.url || photo.mediaUrl} : null} alt={alt} thumbnailFirst />;
}

const DEFAULT_TYPES = ['APARTMENT', 'STUDIO', 'FLAT', 'DETACHED_HOUSE', 'SEMI_DETACHED_HOUSE', 'DUPLEX', 'ROOM_SHARED', 'OTHER'];
const DEFAULT_PERIODS = ['WEEKLY', 'MONTHLY', 'YEARLY'];

const TYPE_LABEL: Record<string, string> = {
  APARTMENT: 'Apartment', STUDIO: 'Studio', FLAT: 'Flat',
  DETACHED_HOUSE: 'Detached House', SEMI_DETACHED_HOUSE: 'Semi-Detached House',
  DUPLEX: 'Duplex', ROOM_SHARED: 'Shared Room', OTHER: 'Other',
};

const PERIOD_LABEL: Record<string, string> = { WEEKLY: 'Weekly', MONTHLY: 'Monthly', YEARLY: 'Yearly' };

const AMENITIES = [
  'WATER', 'ELECTRICITY', 'WIFI', 'AIR_CONDITIONING', 'PARKING', 'SECURITY',
  'GATED_ESTATE', 'BALCONY', 'GARDEN', 'SWIMMING_POOL', 'GYM', 'PETS_ALLOWED',
  'KITCHEN', 'WASHER', 'GENERATOR', 'BOREHOLE', 'CCTV',
];

const AMENITY_LABEL: Record<string, string> = {
  WATER: 'Running water', ELECTRICITY: '24/7 electricity', WIFI: 'Wi-Fi',
  AIR_CONDITIONING: 'Air conditioning', PARKING: 'Parking', SECURITY: 'Security',
  GATED_ESTATE: 'Gated estate', BALCONY: 'Balcony', GARDEN: 'Garden',
  SWIMMING_POOL: 'Swimming pool', GYM: 'Gym', PETS_ALLOWED: 'Pets allowed',
  KITCHEN: 'Kitchen', WASHER: 'Washing machine', GENERATOR: 'Generator',
  BOREHOLE: 'Borehole', CCTV: 'CCTV',
};

interface FormState {
  title: string;
  description: string;
  propertyType: string;
  rentPeriod: string;
  rentAmount: string;
  currency: string;
  country: string;
  state: string;
  city: string;
  area: string;
  bedrooms: string;
  bathrooms: string;
  furnished: boolean;
  depositAmount: string;
  moveInInfo: string;
  amenities: string[];
  contactVantaMessaging: boolean;
  contactWhatsApp: string;
  contactWhatsAppPublished: boolean;
  contactPhone: string;
  contactPhonePublished: boolean;
}

const EMPTY_FORM: FormState = {
  title: '', description: '', propertyType: 'APARTMENT', rentPeriod: 'MONTHLY',
  rentAmount: '', currency: 'NGN', country: '', state: '', city: '', area: '',
  bedrooms: '1', bathrooms: '1', furnished: false, depositAmount: '', moveInInfo: '',
  amenities: [], contactVantaMessaging: true, contactWhatsApp: '',
  contactWhatsAppPublished: false, contactPhone: '', contactPhonePublished: false,
};

// `amenities` is stored on the server as a JSON string, so accept either shape.
function safeArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string');
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

// `useSearchParams` needs a Suspense boundary in Next.js, so the real screen
// lives in this content component and the default export wraps it.
function CreateHomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams?.get('edit') || null;
  const { user, token, isLoading: authLoading } = useAuth();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const createdDraftRef = useRef<string | null>(null);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [step, setStep] = useState(0);
  const [propertyTypes, setPropertyTypes] = useState<string[]>(DEFAULT_TYPES);
  const [rentPeriods, setRentPeriods] = useState<string[]>(DEFAULT_PERIODS);
  const [photos, setPhotos] = useState<any[]>([]);
  const [existingStatus, setExistingStatus] = useState<string | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isEdit = Boolean(editId);

  // Reference lists are public and cacheable.
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([fetchHomePropertyTypes(), fetchHomeRentPeriods()]).then(([types, periods]) => {
      if (cancelled) return;
      if (types.status === 'fulfilled' && Array.isArray(types.value?.propertyTypes) && types.value.propertyTypes.length) {
        setPropertyTypes(types.value.propertyTypes);
      }
      if (periods.status === 'fulfilled' && Array.isArray(periods.value?.rentPeriods) && periods.value.rentPeriods.length) {
        setRentPeriods(periods.value.rentPeriods);
      }
    });
    return () => { cancelled = true; };
  }, []);

  // Load the existing listing when editing.
  useEffect(() => {
    if (authLoading || !token || !editId || createdDraftRef.current === editId) return;
    let cancelled = false;
    setLoadingExisting(true);
    fetchHome(editId, token)
      .then((data) => {
        if (cancelled || !data) return;
        setForm({
          title: data.title || '',
          description: data.description || '',
          propertyType: data.propertyType || 'APARTMENT',
          rentPeriod: data.rentPeriod || 'MONTHLY',
          rentAmount: data.rentAmount != null ? String(data.rentAmount) : '',
          currency: data.currency || 'NGN',
          country: data.country || '',
          state: data.state || '',
          city: data.city || '',
          area: data.area || '',
          bedrooms: data.bedrooms != null ? String(data.bedrooms) : '1',
          bathrooms: data.bathrooms != null ? String(data.bathrooms) : '1',
          furnished: Boolean(data.furnished),
          depositAmount: data.depositAmount != null ? String(data.depositAmount) : '',
          moveInInfo: data.moveInInfo || '',
          amenities: safeArray(data.amenities),
          contactVantaMessaging: data.contactVantaMessaging !== false,
          contactWhatsApp: data.contactWhatsApp || '',
          contactWhatsAppPublished: Boolean(data.contactWhatsAppPublished),
          contactPhone: data.contactPhone || '',
          contactPhonePublished: Boolean(data.contactPhonePublished),
        });
        setExistingStatus(data.availabilityStatus || null);
        setPhotos(Array.isArray(data.media) ? data.media : []);
      })
      .catch((e: any) => {
        if (!cancelled) showToast({ type: 'error', title: 'Could not load listing', message: e?.message || 'Please try again.' });
      })
      .finally(() => { if (!cancelled) setLoadingExisting(false); });
    return () => { cancelled = true; };
  }, [authLoading, token, editId, showToast]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const toggleAmenity = (key: string) => {
    setForm((prev) => ({
      ...prev,
      amenities: prev.amenities.includes(key)
        ? prev.amenities.filter((a) => a !== key)
        : [...prev.amenities, key],
    }));
  };

  // Client-side validation mirroring the backend rules in homes.service.ts.
  const validate = (): string | null => {
    if (form.title.trim().length < 3) return 'Add a title of at least 3 characters.';
    if (form.description.trim().length < 10) return 'Describe the home in at least 10 characters.';
    const rent = Number(form.rentAmount);
    if (form.rentAmount.trim() === '' || !Number.isFinite(rent) || rent < 0) return 'Enter a valid rent amount.';
    if (!form.country.trim()) return 'Country is required.';
    if (!form.city.trim()) return 'City is required.';
    const bedrooms = Number(form.bedrooms);
    const bathrooms = Number(form.bathrooms);
    if (Number.isNaN(bedrooms) || bedrooms < 0) return 'Enter a valid number of bedrooms.';
    if (Number.isNaN(bathrooms) || bathrooms < 0) return 'Enter a valid number of bathrooms.';
    return null;
  };

  const payload = () => ({
    title: form.title.trim(),
    description: form.description.trim(),
    propertyType: form.propertyType,
    rentPeriod: form.rentPeriod,
    rentAmount: Number(form.rentAmount),
    currency: form.currency.trim() || 'NGN',
    country: form.country.trim(),
    state: form.state.trim() || null,
    city: form.city.trim(),
    area: form.area.trim() || null,
    bedrooms: Number(form.bedrooms),
    bathrooms: Number(form.bathrooms),
    furnished: form.furnished,
    amenities: form.amenities.length ? form.amenities : null,
    depositAmount: form.depositAmount.trim() ? Number(form.depositAmount) : null,
    moveInInfo: form.moveInInfo.trim() || null,
    contactVantaMessaging: form.contactVantaMessaging,
    contactWhatsApp: form.contactWhatsApp.trim() || null,
    contactWhatsAppPublished: form.contactWhatsAppPublished,
    contactPhone: form.contactPhone.trim() || null,
    contactPhonePublished: form.contactPhonePublished,
  });

  // Creates the listing, or updates it when editing. Returns the listing id.
  const save = async (): Promise<string | null> => {
    const problem = validate();
    if (problem) { setFormError(problem); return null; }
    if (!token) return null;
    setFormError(null);
    setSaving(true);
    try {
      const currentId = editId || createdDraftRef.current;
      if (currentId) {
        await updateHomeListing(currentId, payload(), token);
        showToast({ type: 'success', title: 'Listing updated' });
        return currentId;
      }
      const created = await createHomeListing(payload(), token);
      if (!created?.id) throw new Error('The server did not return a listing id.');
      showToast({ type: 'success', title: 'Draft saved', message: 'Add photos, then submit it for review.' });
      // Carry the new id into the URL so refreshes keep working.
      createdDraftRef.current = created.id;
      setExistingStatus('DRAFT');
      router.replace(`/homes/create?edit=${created.id}`, undefined);
      return created.id;
    } catch (e: any) {
      setFormError(e?.message || 'Could not save this listing.');
      showToast({ type: 'error', title: 'Save failed', message: e?.message || 'Please try again.' });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => { await save(); };

  const handlePhotos = async (files: FileList | null) => {
    if (!files || files.length === 0 || !token || uploading || saving) return;

    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) {
      showToast({ type: 'error', title: 'Photo limit reached', message: `You can upload up to ${MAX_PHOTOS} photos.` });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const selected = Array.from(files).slice(0, remaining);
    const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
    const invalid = selected.find(file => !allowedTypes.has(file.type) || file.size > 15 * 1024 * 1024);
    if (invalid) {
      showToast({ type: 'error', title: 'Unsupported photo', message: 'Choose JPG, PNG or WebP images under 15 MB each.' });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    // Render local object URLs immediately; retain each original File for upload.
    const previews = selected.map((file, index) => ({
      id: `local-${Date.now()}-${index}-${file.name}`,
      previewUrl: URL.createObjectURL(file),
      localFile: file,
      isLocalPreview: true,
    }));
    setPhotos(previous => [...previous, ...previews]);

    setUploading(true);
    try {
      // Photos can only attach to a persisted listing, so create the draft after
      // previews are already visible. Temporary blob URLs are never sent to API.
      const targetId = editId || createdDraftRef.current || (await save());
      if (!targetId) {
        setPhotos(previous => previous.filter(photo => !previews.some(preview => preview.id === photo.id)));
        return;
      }

      const body = new FormData();
      selected.forEach(file => body.append('photos', file));
      await uploadHomePhotos(targetId, body, token);
      const fresh = await fetchHome(targetId, token);
      setPhotos(Array.isArray(fresh?.media) ? fresh.media : []);
      showToast({ type: 'success', title: `${selected.length} photo${selected.length === 1 ? '' : 's'} added` });
    } catch (e: any) {
      // Remove temporary previews on failure; the original files can be selected again.
      showToast({ type: 'error', title: 'Upload failed — retry photos', message: e?.message || 'Your selected photos were not saved. Select them again to retry.' });
      setPhotos(previous => previous.filter(photo => !previews.some(preview => preview.id === photo.id)));
    } finally {
      previews.forEach(preview => URL.revokeObjectURL(preview.previewUrl));
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removePhoto = async (mediaId: string) => {
    const targetId = editId || createdDraftRef.current;
    if (!token || !targetId || uploading || saving) return;
    const previous = photos;
    setPhotos((prev) => prev.filter((p) => p.id !== mediaId));
    try {
      await deleteHomeMedia(targetId, mediaId, token);
      showToast({ type: 'success', title: 'Photo removed' });
    } catch (e: any) {
      setPhotos(previous);
      showToast({ type: 'error', title: 'Could not remove photo', message: e?.message || 'Please try again.' });
    }
  };

  // Save (creating the draft if needed) then send the listing to moderators.
  const handleSubmitForReview = async () => {
    if (!token || saving || uploading) return;
    if (!photos.some(photo => !photo.isLocalPreview)) {
      showToast({ type: 'error', title: 'Add at least one photo', message: 'Listings need a photo before review.' });
      return;
    }
    const targetId = await save();
    if (!targetId) return;
    setSaving(true);
    try {
      await submitHomeListingForReview(targetId, token);
      showToast({ type: 'success', title: 'Submitted for review', message: 'We will publish it once it is approved.' });
      router.replace('/homes/manage');
    } catch (e: any) {
      showToast({ type: 'error', title: 'Could not submit', message: e?.message || 'Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || (!user && !loadingExisting)) {
    return (
      <div className="relative left-1/2 min-h-[var(--vanta-vh,100dvh)] w-screen max-w-none -translate-x-1/2 overflow-x-clip bg-[var(--background)]">
        <div className="max-w-3xl mx-auto px-4 py-6">
          <Skeleton className="mb-6 h-4 w-24" />
          <Skeleton className="mb-4 h-8 w-64" />
          <Skeleton className="mb-3 h-64 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  const steps = [
    { title: 'Property details', subtitle: 'Tell people what you are listing', icon: HomeIcon },
    { title: 'Location & price', subtitle: 'Help the right people find it', icon: MapPin },
    { title: 'Photos & features', subtitle: 'Show off the property', icon: ImagePlus },
    { title: 'Contact & review', subtitle: 'Choose how people reach you', icon: ShieldCheck },
  ];
  const fieldClass = 'mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[#c9a227]/70 focus:ring-2 focus:ring-[#c9a227]/10';
  const labelClass = 'block text-xs font-semibold text-[var(--text-secondary)]';
  const setField = (key: keyof FormState, value: any) => setForm(prev => ({ ...prev, [key]: value }));
  const advance = () => {
    setFormError(null);
    if (step === 0 && (form.title.trim().length < 3 || form.description.trim().length < 10)) {
      setFormError('Add a clear title and a description of at least 10 characters.');
      return;
    }
    if (step === 1 && (!form.country.trim() || !form.city.trim() || !form.rentAmount.trim() || !Number.isFinite(Number(form.rentAmount)) || Number(form.rentAmount) < 0)) {
      setFormError('Add a valid price, country and city before continuing.');
      return;
    }
    setStep(value => Math.min(3, value + 1));
  };

  return (
    <main className="relative left-1/2 h-[var(--vanta-vh,100dvh)] min-h-0 w-screen max-w-none -translate-x-1/2 overflow-x-clip bg-[var(--background)] text-[var(--text-primary)] flex flex-col overflow-hidden">
      <header className="relative z-50 h-14 shrink-0 border-b border-white/[.06] bg-[var(--header-surface)] px-4">
        <div className="flex h-full w-full items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={() => router.push(isEdit ? '/homes/manage' : '/homes')} aria-label="Back to Homes" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white/60 transition hover:bg-white/[.06] hover:text-white">
              <ArrowLeft size={17} />
            </button>
            <button type="button" onClick={() => router.push('/homes')} className="flex items-baseline gap-2 text-left">
              <span className="text-sm font-black tracking-[.16em] text-[#d7b548]">VANTA</span>
              <span className="text-sm font-medium text-white/80">Homes</span>
            </button>
          </div>
          <span className="shrink-0 text-sm font-medium text-white/65">+ Property</span>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">


      <div className="mx-auto w-full max-w-[1180px] px-0 pt-3 sm:pt-4">
        <section className="px-4 pb-2 pt-1 sm:px-6">
          <h1 className="text-xl font-semibold tracking-tight">{isEdit ? 'Edit property' : 'List a property'}</h1>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">Listings are reviewed before publication.</p>
        </section>

        {(existingStatus === 'PENDING_REVIEW' || existingStatus === 'REJECTED') && <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${existingStatus === 'REJECTED' ? 'border-red-400/25 bg-red-500/[.07] text-red-300' : 'border-amber-400/25 bg-amber-500/[.07] text-amber-200'}`}>{existingStatus === 'REJECTED' ? 'This listing was rejected. Update the details and submit it again for review.' : 'This listing is under review. Your edits may require another review.'}</div>}

        <div className="mx-auto mt-3 w-full max-w-3xl px-3 sm:px-5">
          <nav aria-label="Listing steps" className="mb-3 grid grid-cols-4 gap-1.5">
            {steps.map((item, index) => <button key={item.title} type="button" disabled={index > step || saving || uploading || loadingExisting} onClick={() => { setFormError(null); setStep(index); }} aria-current={index === step ? 'step' : undefined} aria-label={item.title} className="min-w-0 py-1 text-left disabled:cursor-default">
              <span className={`block h-1.5 rounded-full ${index <= step ? 'bg-[var(--vanta-gold)]' : 'bg-[var(--surface-secondary)]'}`} />
              <span className={`mt-1.5 block truncate text-[10px] font-medium ${index === step ? 'text-[var(--vanta-gold-bright)]' : 'text-[var(--text-secondary)]'}`}>{['Details','Location','Photos','Review'][index]}</span>
            </button>)}
          </nav>

          <section className="min-w-0">
            {loadingExisting ? <div className="space-y-3"><div className="h-24 animate-pulse rounded-2xl bg-white/[.04]"/><div className="h-56 animate-pulse rounded-2xl bg-white/[.04]"/></div> : <>
              <h2 className="mb-3 text-base font-semibold">{steps[step].title}</h2>

              {step === 0 && <div className="space-y-4 border-t border-white/[.08] py-4 sm:py-5">
                <div><label className={labelClass} htmlFor="home-title">Listing title</label><input id="home-title" className={fieldClass} value={form.title} onChange={e => setField('title',e.target.value)} maxLength={120} placeholder="e.g. Spacious 2-bedroom apartment in Lekki"/></div>
                <div><label className={labelClass} htmlFor="home-description">Description</label><textarea id="home-description" className={fieldClass + ' min-h-32 resize-y leading-6'} value={form.description} onChange={e => setField('description',e.target.value)} rows={5} maxLength={3000} placeholder="Describe the property, what makes it special, and what a tenant should know."/><p className="mt-1 text-right text-[11px] text-white/30">{form.description.length}/3000</p></div>
                <div className="grid gap-4 sm:grid-cols-2"><div><label className={labelClass} htmlFor="home-type">Property type</label><select id="home-type" className={fieldClass} value={form.propertyType} onChange={e => setField('propertyType',e.target.value)}>{propertyTypes.map(type=><option key={type} value={type}>{TYPE_LABEL[type] || type.replaceAll('_',' ').toLowerCase()}</option>)}</select></div><div><label className={labelClass} htmlFor="home-period">Payment period</label><select id="home-period" className={fieldClass} value={form.rentPeriod} onChange={e => setField('rentPeriod',e.target.value)}>{rentPeriods.map(period=><option key={period} value={period}>{PERIOD_LABEL[period] || period}</option>)}</select></div></div>
                <div className="grid grid-cols-2 gap-3"><div><label className={labelClass} htmlFor="home-bedrooms">Bedrooms</label><input id="home-bedrooms" className={fieldClass} type="number" min="0" max="100" value={form.bedrooms} onChange={e=>setField('bedrooms',e.target.value)}/></div><div><label className={labelClass} htmlFor="home-bathrooms">Bathrooms</label><input id="home-bathrooms" className={fieldClass} type="number" min="0" max="100" value={form.bathrooms} onChange={e=>setField('bathrooms',e.target.value)}/></div></div>
                <button type="button" onClick={()=>setField('furnished',!form.furnished)} aria-pressed={form.furnished} className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-sm ${form.furnished ? 'border-[#c9a227]/40 bg-[#c9a227]/[.07] text-[#e4c65d]' : 'border-white/10 bg-white/[.02] text-white/60'}`}><span>Furnished property</span><span className={`grid h-5 w-5 place-items-center rounded-md border ${form.furnished ? 'border-[#c9a227] bg-[#c9a227] text-black' : 'border-white/20'}`}>{form.furnished && <Check size={13}/>}</span></button>
              </div>}

              {step === 1 && <div className="space-y-4 border-t border-white/[.08] py-4 sm:py-5">
                <div className="rounded-xl border border-[#c9a227]/15 bg-[#c9a227]/[.04] p-3 text-xs leading-5 text-white/55"><ShieldCheck size={15} className="mr-2 inline text-[#c9a227]"/>Your exact street address is not requested here. The neighbourhood you enter is what people see on the public listing.</div>
                <div className="grid gap-4 sm:grid-cols-2"><div><label className={labelClass} htmlFor="home-country">Country</label><input id="home-country" className={fieldClass} value={form.country} onChange={e=>setField('country',e.target.value)} placeholder="Nigeria"/></div><div><label className={labelClass} htmlFor="home-state">State / region</label><input id="home-state" className={fieldClass} value={form.state} onChange={e=>setField('state',e.target.value)} placeholder="Lagos State"/></div><div><label className={labelClass} htmlFor="home-city">City</label><input id="home-city" className={fieldClass} value={form.city} onChange={e=>setField('city',e.target.value)} placeholder="Lagos"/></div><div><label className={labelClass} htmlFor="home-area">Area / neighbourhood</label><input id="home-area" className={fieldClass} value={form.area} onChange={e=>setField('area',e.target.value)} placeholder="Lekki Phase 1"/></div></div>
                <div className="grid gap-4 sm:grid-cols-2"><div><label className={labelClass} htmlFor="home-price">Price</label><div className="flex gap-2"><select aria-label="Currency" className={fieldClass+' max-w-28'} value={form.currency} onChange={e=>setField('currency',e.target.value)}><option value="NGN">NGN ₦</option><option value="USD">USD $</option><option value="GBP">GBP £</option><option value="EUR">EUR €</option></select><input id="home-price" className={fieldClass+' min-w-0'} type="number" min="0" value={form.rentAmount} onChange={e=>setField('rentAmount',e.target.value)} placeholder="250000"/></div><p className="mt-1 text-[11px] text-white/35">Enter the amount for the selected payment period.</p></div><div><label className={labelClass} htmlFor="home-deposit">Security deposit (optional)</label><input id="home-deposit" className={fieldClass} type="number" min="0" value={form.depositAmount} onChange={e=>setField('depositAmount',e.target.value)} placeholder="No deposit? Leave blank"/></div></div>
                <div><label className={labelClass} htmlFor="home-movein">Move-in details (optional)</label><input id="home-movein" className={fieldClass} value={form.moveInInfo} onChange={e=>setField('moveInInfo',e.target.value)} placeholder="Available immediately, lease terms, etc."/></div>
              </div>}

              {step === 2 && <div className="space-y-4 border-t border-white/[.08] py-4 sm:py-5">
                <div><div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Property photos</h3><p className="mt-1 text-xs text-white/40">Upload clear photos. Your first cover photo makes the first impression.</p></div><span className="shrink-0 rounded-lg bg-white/[.05] px-2.5 py-1.5 text-xs text-white/55">{photos.length}/{MAX_PHOTOS}</span></div>
                  <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={e=>void handlePhotos(e.target.files)} className="sr-only" id="home-photos"/>
                  <button type="button" disabled={uploading || saving || photos.length >= MAX_PHOTOS} onClick={()=>fileInputRef.current?.click()} className="mt-3 flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-[#c9a227]/35 bg-[var(--surface)] px-4 py-6 text-center transition-colors hover:bg-[var(--surface-active)] disabled:opacity-50"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#c9a227]/10 text-[#e4c65d]">{uploading ? <UploadCloud size={22} className="animate-pulse"/> : <ImagePlus size={22}/>}</span><span className="mt-3 text-sm font-semibold">{uploading ? 'Uploading photos…' : 'Tap to choose photos'}</span><span className="mt-1 text-xs text-white/40">JPG, PNG or WebP · up to {MAX_PHOTOS} images</span></button>
                </div>
                {photos.length>0 && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{photos.map(photo=>{return <div key={photo.id} className="group relative aspect-[4/3] overflow-hidden rounded-xl bg-white/[.03]"><HomePhotoImage photo={photo} alt="Selected property photo preview" />{photo.isLocalPreview&&<span className="absolute left-2 top-2 rounded bg-black/75 px-2 py-1 text-[10px] font-semibold text-white">Preview</span>}{photo.isCover&&<span className="absolute left-2 top-2 rounded-full bg-[#c9a227] px-2 py-1 text-[10px] font-bold text-black">COVER</span>}{!photo.isLocalPreview&&<button type="button" disabled={uploading||saving} onClick={()=>void removePhoto(photo.id)} aria-label="Remove photo" className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/75 text-white hover:bg-red-500"><Trash2 size={14}/></button>}</div>})}</div>}
                <div className="rounded-xl border border-white/[.07] bg-black/20 p-3"><p className="text-xs leading-5 text-white/45">Photos help renters understand the space. Only upload images you have permission to share. You can save your draft and finish later.</p></div>
                <div><h3 className="mb-3 text-sm font-semibold">Amenities</h3><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{AMENITIES.map(amenity=>{const active=form.amenities.includes(amenity);return <button key={amenity} type="button" onClick={()=>toggleAmenity(amenity)} aria-pressed={active} className={`flex min-h-11 items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition ${active?'border-[#c9a227]/50 bg-[#c9a227]/[.09] text-[#e4c65d]':'border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]'}`}><span className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${active ? 'border-[#c9a227] bg-[#c9a227] text-black' : 'border-[var(--border-strong)]'}`}>{active && <Check size={12}/>}</span>{AMENITY_LABEL[amenity] || amenity}</button>})}</div></div>
              </div>}

              {step === 3 && <div className="space-y-4 border-t border-white/[.08] py-4 sm:py-5">
                <div><h3 className="text-sm font-semibold">How should people contact you?</h3><p className="mt-1 text-xs leading-5 text-white/40">Keep conversations on VANTA or optionally publish a phone number.</p></div>
                <button type="button" onClick={()=>setField('contactVantaMessaging',!form.contactVantaMessaging)} aria-pressed={form.contactVantaMessaging} className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left ${form.contactVantaMessaging?'border-[#c9a227]/35 bg-[#c9a227]/[.05]':'border-white/10 bg-white/[.02]'}`}><span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border ${form.contactVantaMessaging?'border-[#c9a227] bg-[#c9a227] text-black':'border-white/20'}`}>{form.contactVantaMessaging&&<Check size={13}/>}</span><span><span className="block text-sm font-semibold">VANTA messages</span><span className="mt-1 block text-xs leading-5 text-white/40">Let interested people send an enquiry inside VANTA.</span></span></button>
                <div className="grid gap-4 sm:grid-cols-2"><div><label className={labelClass} htmlFor="home-whatsapp">WhatsApp number (optional)</label><input id="home-whatsapp" className={fieldClass} value={form.contactWhatsApp} onChange={e=>setField('contactWhatsApp',e.target.value)} placeholder="+234…"/><label className="mt-2 flex items-center gap-2 text-xs text-white/50"><input type="checkbox" checked={form.contactWhatsAppPublished} onChange={e=>setField('contactWhatsAppPublished',e.target.checked)} className="accent-[#c9a227]"/>Show WhatsApp on my listing</label></div><div><label className={labelClass} htmlFor="home-phone">Phone number (optional)</label><input id="home-phone" className={fieldClass} value={form.contactPhone} onChange={e=>setField('contactPhone',e.target.value)} placeholder="+234…"/><label className="mt-2 flex items-center gap-2 text-xs text-white/50"><input type="checkbox" checked={form.contactPhonePublished} onChange={e=>setField('contactPhonePublished',e.target.checked)} className="accent-[#c9a227]"/>Show phone on my listing</label></div></div>
                <div className="rounded-xl border border-[#c9a227]/20 bg-[#c9a227]/[.045] p-4"><div className="flex gap-3"><ShieldCheck size={19} className="mt-0.5 shrink-0 text-[#c9a227]"/><div><p className="text-sm font-semibold">Before you submit</p><p className="mt-1 text-xs leading-5 text-white/50">Check the price, location, photos and contact choices. Your listing is saved as a draft first and sent to the VANTA Homes team for review before it appears publicly.</p></div></div></div>
                <div className="rounded-xl border border-white/10 bg-[var(--surface)] p-3"><div className="flex items-start gap-3"><div className="h-20 w-24 shrink-0 overflow-hidden rounded-lg bg-white/[.04]"><HomePhotoImage photo={photos.find(photo => photo.isCover) || photos[0]} alt="Property cover preview" /></div><div className="min-w-0"><p className="truncate text-sm font-semibold">{form.title || 'Your property title'}</p><p className="mt-1 text-xs text-white/45">{homeLocationLine(form, 'Add your location')}</p><p className="mt-2 text-sm font-bold text-[#e4c65d]">{form.rentAmount ? `${form.currency} ${Number(form.rentAmount).toLocaleString()}` : 'Price not set'} <span className="text-[10px] font-normal text-white/40">/ {PERIOD_LABEL[form.rentPeriod]?.toLowerCase() || 'month'}</span></p><p className="mt-1 text-[10px] text-white/40">{form.bedrooms} beds · {form.bathrooms} baths · {form.furnished?'Furnished':'Unfurnished'}</p></div></div></div>
              </div>}

              {formError && <div role="alert" className="mt-4 rounded-xl border border-red-400/25 bg-red-500/[.07] px-4 py-3 text-sm text-red-300">{formError}</div>}

              {step===3 && photos.length===0 && <p className="mt-3 text-right text-[11px] text-amber-200/70">Add at least one property photo in the previous step before submitting.</p>}
            </>}
          </section>
        </div>
      </div>
    
      </div>
      {!loadingExisting && <footer className="shrink-0 border-t border-[var(--border)] bg-[var(--background)] px-3 pt-2 pb-[max(8px,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <button type="button" disabled={step===0 || saving || uploading} onClick={()=>{setFormError(null);setStep(value=>Math.max(0,value-1));}} aria-label="Previous step" className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-[var(--border)] text-[var(--text-secondary)] disabled:opacity-30"><ChevronLeft size={20}/></button>
          <button type="button" disabled={saving||uploading} onClick={()=>void handleSave()} className="min-h-11 shrink-0 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold text-[var(--text-secondary)] disabled:opacity-40">Save draft</button>
          {step<3 ? <button type="button" disabled={saving || uploading} onClick={advance} className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--vanta-gold)] px-2 text-sm font-semibold text-black disabled:opacity-40">Continue<ChevronRight size={15}/></button> : <button type="button" disabled={saving||uploading||photos.length===0} onClick={()=>void handleSubmitForReview()} className="min-h-11 flex-1 rounded-lg bg-[var(--vanta-gold)] px-2 text-xs font-semibold text-black disabled:opacity-40 sm:text-sm">{saving?'Submitting…':'Submit for review'}</button>}
        </div>
      </footer>}
    </main>
  );
}

// ============================================================================
// DEFAULT EXPORT — Suspense boundary is required for useSearchParams in Next.js
// ============================================================================

export default function CreateHomePage() {
  return (
    <Suspense
      fallback={
        <main className="grid min-h-dvh place-items-center">
          <Skeleton variant="circular" width={32} height={32} />
        </main>
      }
    >
      <CreateHomeContent />
    </Suspense>
  );
}
