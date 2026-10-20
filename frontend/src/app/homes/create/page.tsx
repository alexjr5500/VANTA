'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  fetchHome, createHomeListing, updateHomeListing, submitHomeListingForReview,
  uploadHomePhotos, deleteHomeMedia, fetchHomePropertyTypes, fetchHomeRentPeriods,
} from '@/lib/services';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Skeleton from '@/components/ui/Skeleton';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { ArrowLeft, ImagePlus, Trash2, Check } from 'lucide-react';

const MAX_PHOTOS = 10;

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

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
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
    if (authLoading || !token || !editId) return;
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
    if (form.rentAmount.trim() === '' || Number.isNaN(rent) || rent < 0) return 'Enter a valid rent amount.';
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
      if (isEdit && editId) {
        await updateHomeListing(editId, payload(), token);
        showToast({ type: 'success', title: 'Listing updated' });
        return editId;
      }
      const created = await createHomeListing(payload(), token);
      if (!created?.id) throw new Error('The server did not return a listing id.');
      showToast({ type: 'success', title: 'Draft saved', message: 'Add photos, then submit it for review.' });
      // Carry the new id into the URL so refreshes keep working.
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
    if (!files || files.length === 0) return;
    if (!token) return;
    // Photos can only attach to a persisted listing, so create the draft first.
    const targetId = editId || (await save());
    if (!targetId) return;

    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) {
      showToast({ type: 'error', title: 'Photo limit reached', message: `You can upload up to ${MAX_PHOTOS} photos.` });
      return;
    }
    const selected = Array.from(files).slice(0, remaining);

    const body = new FormData();
    selected.forEach((file) => body.append('photos', file));

    setUploading(true);
    try {
      await uploadHomePhotos(targetId, body, token);
      const fresh = await fetchHome(targetId, token);
      setPhotos(Array.isArray(fresh?.media) ? fresh.media : []);
      showToast({ type: 'success', title: `${selected.length} photo${selected.length === 1 ? '' : 's'} added` });
    } catch (e: any) {
      showToast({ type: 'error', title: 'Upload failed', message: e?.message || 'Please try again.' });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removePhoto = async (mediaId: string) => {
    if (!token || !editId) return;
    const previous = photos;
    setPhotos((prev) => prev.filter((p) => p.id !== mediaId));
    try {
      await deleteHomeMedia(editId, mediaId, token);
      showToast({ type: 'success', title: 'Photo removed' });
    } catch (e: any) {
      setPhotos(previous);
      showToast({ type: 'error', title: 'Could not remove photo', message: e?.message || 'Please try again.' });
    }
  };

  // Save (creating the draft if needed) then send the listing to moderators.
  const handleSubmitForReview = async () => {
    if (!token) return;
    if (photos.length === 0) {
      showToast({ type: 'error', title: 'Add at least one photo', message: 'Listings need a photo before review.' });
      return;
    }
    const targetId = editId || (await save());
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
      <div className="min-h-[var(--vanta-vh,100dvh)] bg-[var(--background)]">
        <div className="max-w-3xl mx-auto px-4 py-6">
          <Skeleton className="mb-6 h-4 w-24" />
          <Skeleton className="mb-4 h-8 w-64" />
          <Skeleton className="mb-3 h-64 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[var(--vanta-vh,100dvh)] bg-[var(--background)] text-[var(--foreground)]">
      <div className="max-w-3xl mx-auto px-4 py-6 pb-32">
        <button
          onClick={() => router.push(isEdit ? '/homes/manage' : '/homes')}
          className="mb-4 inline-flex items-center gap-2 text-sm text-white/60 transition-colors hover:text-white"
        >
          <ArrowLeft size={16} /> {isEdit ? 'Manage listings' : 'All homes'}
        </button>

        <div className="mb-6">
          <span className="text-sm font-bold uppercase tracking-wider text-[#c9a227]">VANTA Homes</span>
          <h1 className="text-2xl font-bold text-white">{isEdit ? 'Edit listing' : 'List your property'}</h1>
          <p className="mt-1 text-sm text-white/50">
            {isEdit
              ? 'Update the details below. Changes go live after a quick review.'
              : 'Fill in the details, add photos, then submit for a short review.'}
          </p>
        </div>

        {existingStatus === 'PENDING_REVIEW' && (
          <div className="mb-5 rounded-[var(--radius-xl)] border border-amber-400/30 bg-amber-500/[0.07] px-3.5 py-2.5 text-sm text-amber-300">
            This listing is being reviewed. You can keep editing it in the meantime.
          </div>
        )}
        {existingStatus === 'REJECTED' && (
          <div className="mb-5 rounded-[var(--radius-xl)] border border-red-400/30 bg-red-500/[0.07] px-3.5 py-2.5 text-sm text-red-300">
            This listing was rejected. Make the changes described by the moderator, then submit it again.
          </div>
        )}

        {loadingExisting ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Basics ---------------------------------------------------- */}
            <Card variant="glass" padding="lg">
              <h2 className="mb-4 text-lg font-semibold text-white">The basics</h2>
              <div className="space-y-4">
                <Input
                  label="Listing title"
                  value={form.title}
                  onChange={(e) => set('title', e.target.value)}
                  placeholder="Bright 2-bedroom apartment in Lekki"
                  maxLength={120}
                />

                <div className="space-y-1.5">
                  <label htmlFor="home-desc" className="form-label">Description</label>
                  <textarea
                    id="home-desc"
                    value={form.description}
                    onChange={(e) => set('description', e.target.value)}
                    rows={5}
                    maxLength={3000}
                    placeholder="Describe the home, the neighbourhood and anything a tenant should know."
                    className="form-input resize-none leading-relaxed"
                  />
                  <p className="text-xs text-white/30">{form.description.trim().length}/3000</p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label htmlFor="home-type" className="form-label">Property type</label>
                    <select
                      id="home-type"
                      value={form.propertyType}
                      onChange={(e) => set('propertyType', e.target.value)}
                      className="form-input"
                    >
                      {propertyTypes.map((type) => (
                        <option key={type} value={type}>{TYPE_LABEL[type] || type}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="home-period" className="form-label">Rent period</label>
                    <select
                      id="home-period"
                      value={form.rentPeriod}
                      onChange={(e) => set('rentPeriod', e.target.value)}
                      className="form-input"
                    >
                      {rentPeriods.map((period) => (
                        <option key={period} value={period}>{PERIOD_LABEL[period] || period}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Input
                    label="Rent amount"
                    type="number"
                    min={0}
                    value={form.rentAmount}
                    onChange={(e) => set('rentAmount', e.target.value)}
                    placeholder="250000"
                  />
                  <Input
                    label="Currency"
                    value={form.currency}
                    onChange={(e) => set('currency', e.target.value.toUpperCase())}
                    placeholder="NGN"
                    maxLength={3}
                  />
                  <Input
                    label="Security deposit"
                    type="number"
                    min={0}
                    value={form.depositAmount}
                    onChange={(e) => set('depositAmount', e.target.value)}
                    placeholder="Optional"
                    helperText="Leave blank if none"
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Input
                    label="Bedrooms"
                    type="number"
                    min={0}
                    value={form.bedrooms}
                    onChange={(e) => set('bedrooms', e.target.value)}
                  />
                  <Input
                    label="Bathrooms"
                    type="number"
                    min={0}
                    value={form.bathrooms}
                    onChange={(e) => set('bathrooms', e.target.value)}
                  />
                  <div className="space-y-1.5">
                    <label htmlFor="home-furnished" className="form-label">Furnishing</label>
                    <button
                      id="home-furnished"
                      type="button"
                      onClick={() => set('furnished', !form.furnished)}
                      className={`flex h-[42px] w-full items-center justify-between rounded-[var(--radius-lg)] border px-3.5 text-sm transition ${
                        form.furnished
                          ? 'border-[#c9a227]/50 bg-[#c9a227]/10 text-[#e6c65a]'
                          : 'border-white/[0.08] bg-white/[0.04] text-white/60'
                      }`}
                      aria-pressed={form.furnished}
                    >
                      {form.furnished ? 'Furnished' : 'Unfurnished'}
                      <span className={`grid h-4 w-4 place-items-center rounded border ${
                        form.furnished ? 'border-[#c9a227] bg-[#c9a227]' : 'border-white/25'
                      }`}>
                        {form.furnished && <Check size={11} className="text-black" />}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </Card>

            {/* Location -------------------------------------------------- */}
            <Card variant="glass" padding="lg">
              <h2 className="mb-4 text-lg font-semibold text-white">Where it is</h2>
              <p className="mb-4 text-xs leading-relaxed text-white/40">
                Only the area is shown publicly. Add the street address so our team can verify the listing — it is
                never displayed to tenants.
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label="Country"
                  value={form.country}
                  onChange={(e) => set('country', e.target.value)}
                  placeholder="Nigeria"
                />
                <Input
                  label="State / region"
                  value={form.state}
                  onChange={(e) => set('state', e.target.value)}
                  placeholder="Lagos"
                />
                <Input
                  label="City"
                  value={form.city}
                  onChange={(e) => set('city', e.target.value)}
                  placeholder="Lagos"
                />
                <Input
                  label="Area / neighbourhood"
                  value={form.area}
                  onChange={(e) => set('area', e.target.value)}
                  placeholder="Lekki Phase 1"
                />
              </div>
            </Card>

            {/* Amenities -------------------------------------------------- */}
            <Card variant="glass" padding="lg">
              <h2 className="mb-1 text-lg font-semibold text-white">Amenities</h2>
              <p className="mb-4 text-xs text-white/40">Pick everything this home offers.</p>
              <div className="flex flex-wrap gap-2">
                {AMENITIES.map((amenity) => {
                  const active = form.amenities.includes(amenity);
                  return (
                    <button
                      key={amenity}
                      type="button"
                      onClick={() => toggleAmenity(amenity)}
                      aria-pressed={active}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                        active
                          ? 'border-[#c9a227]/50 bg-[#c9a227]/12 text-[#e6c65a]'
                          : 'border-white/[0.08] bg-white/[0.03] text-white/55 hover:border-white/[0.16] hover:text-white/80'
                      }`}
                    >
                      {active && <Check size={12} />}
                      {AMENITY_LABEL[amenity]}
                    </button>
                  );
                })}
              </div>
            </Card>

            {/* Photos ---------------------------------------------------- */}
            <Card variant="glass" padding="lg">
              <h2 className="mb-1 text-lg font-semibold text-white">Photos</h2>
              <p className="mb-4 text-xs text-white/40">
                Up to {MAX_PHOTOS} photos. At least one is required before submitting.{' '}
                {photos.length}/{MAX_PHOTOS} added.
              </p>

              {photos.length > 0 && (
                <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {photos.map((photo) => {
                    const src = photo?.uploadedFile?.url || photo?.thumbnailUrl || null;
                    return (
                      <div
                        key={photo.id}
                        className="group relative aspect-square overflow-hidden rounded-[var(--radius-lg)] bg-white/[0.05]"
                      >
                        {src ? (
                          <img src={src} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-white/20">
                            <ImagePlus size={20} />
                          </span>
                        )}
                        {photo?.isCover && (
                          <span className="absolute left-1.5 top-1.5 rounded-[var(--radius-md)] bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-[#e6c65a]">
                            Cover
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => void removePhoto(photo.id)}
                          className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1.5 text-white/80 opacity-0 transition hover:bg-red-500/80 hover:text-white group-hover:opacity-100"
                          aria-label="Remove photo"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => void handlePhotos(e.target.files)}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || photos.length >= MAX_PHOTOS}
                className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-white/[0.14] bg-white/[0.02] px-4 py-6 text-sm text-white/55 transition hover:border-[#c9a227]/50 hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ImagePlus size={18} />
                {uploading ? 'Uploading...' : photos.length >= MAX_PHOTOS ? 'Photo limit reached' : 'Add photos'}
              </button>
            </Card>

            {/* Contact preferences ---------------------------------------- */}
            <Card variant="glass" padding="lg">
              <h2 className="mb-1 text-lg font-semibold text-white">How tenants reach you</h2>
              <p className="mb-4 text-xs text-white/40">
                VANTA messaging is always on. WhatsApp and phone stay private unless you publish them.
              </p>
              <div className="space-y-4">
                <Input
                  label="WhatsApp number"
                  value={form.contactWhatsApp}
                  onChange={(e) => set('contactWhatsApp', e.target.value)}
                  placeholder="+234 801 234 5678"
                />
                <label className="flex items-center gap-2.5 text-sm text-white/65">
                  <input
                    type="checkbox"
                    checked={form.contactWhatsAppPublished}
                    onChange={(e) => set('contactWhatsAppPublished', e.target.checked)}
                    className="h-4 w-4 accent-[#c9a227]"
                  />
                  Show my WhatsApp on the listing
                </label>

                <Input
                  label="Phone number"
                  value={form.contactPhone}
                  onChange={(e) => set('contactPhone', e.target.value)}
                  placeholder="+234 801 234 5678"
                />
                <label className="flex items-center gap-2.5 text-sm text-white/65">
                  <input
                    type="checkbox"
                    checked={form.contactPhonePublished}
                    onChange={(e) => set('contactPhonePublished', e.target.checked)}
                    className="h-4 w-4 accent-[#c9a227]"
                  />
                  Show my phone number on the listing
                </label>

                <Input
                  label="Move-in note"
                  value={form.moveInInfo}
                  onChange={(e) => set('moveInInfo', e.target.value)}
                  placeholder="e.g. Available from 1 March, 12-month lease"
                />
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* Sticky action bar ---------------------------------------------- */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.06] bg-[var(--background)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 px-4 py-3">
          {formError && <p className="w-full text-xs text-red-400">{formError}</p>}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" onClick={() => router.push(isEdit ? '/homes/manage' : '/homes')}>
              Cancel
            </Button>
            <Button variant="outline" loading={saving} onClick={() => void handleSave()}>
              Save draft
            </Button>
            <Button
              variant="gold"
              loading={saving || uploading}
              disabled={photos.length === 0}
              onClick={() => void handleSubmitForReview()}
            >
              Submit for review
            </Button>
          </div>
        </div>
      </div>
    </div>
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
