'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  FileText,
  Heart,
  Loader2,
  ShieldCheck,
  Trash2,
  UploadCloud,
  User,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import { apiUpload } from '@/lib/apiClient';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import {
  createFundraiserDraft,
  getFundraiserCategories,
  getMyFundraiser,
  listMyEvidence,
  submitFundraiserForReview,
  updateFundraiserDraft,
} from '@/lib/fundraiserApi';
import { uploadMedia } from '@/lib/uploadService';
import { canCreateFundraiser } from '@/lib/canCreateFundraiser';
import type { Fundraiser, FundraiserCategory, FundraiserDraftSubmission, FundraiserEvidenceMeta } from '@/types/fundraiser';

const STEPS = [
  { id: 1, label: 'Basic info', icon: FileText },
  { id: 2, label: 'Your story', icon: FileText },
  { id: 3, label: 'Evidence', icon: ShieldCheck },
  { id: 4, label: 'Beneficiary', icon: User },
  { id: 5, label: 'Review', icon: Check },
];

const RAISING_FOR_OPTIONS = [
  { id: 'SELF', label: 'Myself' },
  { id: 'FAMILY_MEMBER', label: 'A family member' },
  { id: 'FRIEND', label: 'A friend' },
  { id: 'COMMUNITY', label: 'My community' },
  { id: 'OTHER', label: 'Someone else' },
];

const PAYOUT_OPTIONS = [
  { id: 'WALLET_BALANCE', label: 'VANTA Wallet balance', description: 'Funds settle into the VANTA Wallet and can be withdrawn through Balance.' },
  { id: 'BANK_TRANSFER', label: 'Bank transfer', description: 'Direct to a bank account (reviewed during verification).' },
  { id: 'USDT', label: 'USDT (BEP-20)', description: 'Direct to a USDT wallet address.' },
];

const EVIDENCE_MAX = 50 * 1024 * 1024; // 50MB — matches backend
const EVIDENCE_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif',
  'video/mp4', 'video/webm', 'video/quicktime',
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain',
];

const COUNTRIES = [
  'Afghanistan', 'Argentina', 'Australia', 'Bangladesh', 'Brazil', 'Canada', 'Colombia', 'Egypt', 'Ethiopia',
  'France', 'Germany', 'Ghana', 'India', 'Indonesia', 'Ireland', 'Italy', 'Japan', 'Kenya', 'Malaysia', 'Mexico',
  'Morocco', 'Netherlands', 'New Zealand', 'Nigeria', 'Pakistan', 'Philippines', 'Poland', 'Portugal', 'Romania',
  'Saudi Arabia', 'South Africa', 'South Korea', 'Spain', 'Sri Lanka', 'Sweden', 'Switzerland', 'Thailand',
  'Turkey', 'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States', 'Vietnam',
];

interface CoverDraft {
  type: 'IMAGE' | 'VIDEO';
  url: string;
  thumbnailUrl?: string;
}

export default function StartFundraiserPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const { token, user, isLoading: authLoading } = useAuth();
  const fundraiserAllowed = canCreateFundraiser(user);

  const [step, setStep] = useState(1);
  const [categories, setCategories] = useState<FundraiserCategory[]>([]);
  const [fundraiserId, setFundraiserId] = useState<string | null>(null);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [declarationChecked, setDeclarationChecked] = useState(false);

  // Step 1 — Basic information
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [raisingFor, setRaisingFor] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [deadline, setDeadline] = useState('');
  const [cover, setCover] = useState<CoverDraft | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);

  // Step 2 — Story
  const [summary, setSummary] = useState('');
  const [story, setStory] = useState('');
  const [fundsNeededFor, setFundsNeededFor] = useState('');
  const [fundsUsage, setFundsUsage] = useState('');
  const [whoBenefits, setWhoBenefits] = useState('');

  // Step 3 — Evidence
  const [evidence, setEvidence] = useState<FundraiserEvidenceMeta[]>([]);
  const [evidenceUploading, setEvidenceUploading] = useState(false);
  const evidenceInputRef = useRef<HTMLInputElement>(null);

  // Step 4 — Beneficiary & payout
  const [beneficiaryName, setBeneficiaryName] = useState('');
  const [beneficiaryRelationship, setBeneficiaryRelationship] = useState('');
  const [beneficiarySummary, setBeneficiarySummary] = useState('');
  const [payoutMethod, setPayoutMethod] = useState('WALLET_BALANCE');
  const [organizerNotes, setOrganizerNotes] = useState('');

  useEffect(() => {
    getFundraiserCategories().then(setCategories).catch(() => setCategories([]));
  }, []);

  const draftId = searchParams?.get('draft');

  useEffect(() => {
    if (!draftId || !token) return;
    setLoadingDraft(true);
    Promise.all([getMyFundraiser(draftId, token), listMyEvidence(draftId, token)])
      .then(([draft, evidenceList]) => {
        setFundraiserId(draft.id);
        setTitle(draft.title || '');
        setCategoryId(draft.categoryId || '');
        setRaisingFor(draft.raisingFor || '');
        setCountry(draft.country || '');
        setCity(draft.location || '');
        setTargetAmount(draft.targetAmount ? String(draft.targetAmount) : '');
        setDeadline(draft.deadline ? new Date(draft.deadline).toISOString().split('T')[0] : '');
        setSummary(draft.summary || '');
        setStory(draft.story || '');
        setFundsNeededFor(draft.fundsNeededFor || '');
        setFundsUsage(draft.fundsUsage || '');
        setWhoBenefits(draft.whoBenefits || '');
        setBeneficiaryName(draft.beneficiaryName || '');
        setBeneficiaryRelationship(draft.beneficiaryRelationship || '');
        setBeneficiarySummary(draft.beneficiarySummary || '');
        setPayoutMethod(draft.payoutMethod || 'WALLET_BALANCE');
        setOrganizerNotes(draft.organizerNotes || '');
        setEvidence(evidenceList || []);
        if (draft.coverMediaUrl) {
          setCover({ type: draft.coverMediaType || 'IMAGE', url: draft.coverMediaUrl, thumbnailUrl: draft.coverMediaThumbnailUrl || undefined });
        }
      })
      .catch((reason: any) => toast.error('Could not load your draft', reason?.message))
      .finally(() => setLoadingDraft(false));
  }, [draftId, token, toast]);
const toSubmission = useCallback((): FundraiserDraftSubmission => ({
    title,
    categoryId,
    raisingFor,
    country,
    location: city,
    targetAmount: targetAmount ? Number(targetAmount) : undefined,
    deadline: deadline ? new Date(deadline + 'T23:59:59').toISOString() : undefined,
    coverMediaType: cover?.type,
    coverMediaUrl: cover?.url,
    coverMediaThumbnailUrl: cover?.thumbnailUrl,
    summary,
    story,
    fundsNeededFor,
    fundsUsage,
    whoBenefits,
    beneficiaryName,
    beneficiaryRelationship,
    beneficiarySummary,
    payoutMethod,
    organizerNotes,
  }), [title, categoryId, raisingFor, country, city, targetAmount, deadline, cover, summary, story, fundsNeededFor, fundsUsage, whoBenefits, beneficiaryName, beneficiaryRelationship, beneficiarySummary, payoutMethod, organizerNotes]);

  const saveDraft = async (): Promise<Fundraiser | null> => {
    if (!token) return null;
    const submission = toSubmission();
    if (fundraiserId) {
      const updated = await updateFundraiserDraft(fundraiserId, submission, token);
      setFundraiserId(updated.id);
      return updated;
    }
    const created = await createFundraiserDraft(submission, token);
    setFundraiserId(created.id);
    return created;
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    setError('');
    try {
      await saveDraft();
      toast.success('Draft saved');
    } catch (reason: any) {
      setError(reason?.message || 'Could not save your draft.');
    } finally {
      setSaving(false);
    }
  };

  const validateStep = (target: number): string => {
    if (target === 1) {
      if (!title || title.trim().length < 3) return 'Please give your fundraiser a title (at least 3 characters).';
      if (!categoryId) return 'Please choose a category.';
      if (!raisingFor) return 'Please tell us who you are raising money for.';
      if (!country) return 'Please select a country.';
      const amount = Number(targetAmount);
      if (!amount || amount <= 0) return 'Please enter a target amount greater than zero.';
      const parsedDeadline = deadline ? new Date(deadline + 'T23:59:59') : null;
      if (!parsedDeadline || Number.isNaN(parsedDeadline.getTime())) return 'Please set a fundraising deadline.';
      if (parsedDeadline.getTime() <= Date.now()) return 'The deadline must be in the future.';
    }
    if (target === 2) {
      if (!summary || summary.trim().length < 10) return 'A short summary of at least 10 characters is required.';
      if (!story || story.trim().length < 20) return 'Please tell your story (at least 20 characters).';
    }
    if (target === 4) {
      if (!beneficiaryName || beneficiaryName.trim().length < 2) return 'Please enter the beneficiary name.';
      if (evidence.length === 0 && !beneficiarySummary) return 'Please add supporting evidence or a beneficiary summary.';
    }
    return '';
  };

  const goNext = () => {
    const validation = validateStep(step + 1);
    if (validation) {
      setError(validation);
      return;
    }
    setError('');
    setStep((s) => Math.min(5, s + 1));
  };

  const goBack = () => {
    setError('');
    setStep((s) => Math.max(1, s - 1));
  };

  const handleCoverChange = async (files: FileList | null) => {
    if (!files?.[0] || !token) return;
    const file = files[0];
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isVideo && !isImage) {
      setError('The cover must be an image or a video.');
      return;
    }
    setCoverUploading(true);
    setError('');
    try {
      const result = await uploadMedia(file, token, { fieldName: 'file', path: '/api/upload', category: 'fundraiser-cover' });
      if (result.error || !result.url) throw new Error(result.error || 'Cover upload failed.');
      setCover({ type: isVideo ? 'VIDEO' : 'IMAGE', url: result.url, thumbnailUrl: result.url });
      toast.success('Cover uploaded');
    } catch (reason: any) {
      setError(reason?.message || 'Cover upload failed. Please try a smaller file.');
    } finally {
      setCoverUploading(false);
      if (coverInputRef.current) coverInputRef.current.value = '';
    }
  };

  const ensureDraftForEvidence = async (): Promise<string> => {
    const draft = await saveDraft();
    if (!draft) throw new Error('Please sign in to upload evidence.');
    return draft.id;
  };

  const handleEvidenceChange = async (files: FileList | null) => {
    if (!files?.length) return;
    if (!token) {
      router.push(`/login?next=${encodeURIComponent('/give/start')}`);
      return;
    }
    setEvidenceUploading(true);
    setError('');
    try {
      const targetId = await ensureDraftForEvidence();
      const accepted: FundraiserEvidenceMeta[] = [];
      for (const file of Array.from(files)) {
        if (!EVIDENCE_TYPES.includes(file.type)) {
          setError(`${file.name} is not a supported evidence file type.`);
          continue;
        }
        if (file.size > EVIDENCE_MAX) {
          setError(`${file.name} exceeds the 50MB evidence size limit.`);
          continue;
        }
        const formData = new FormData();
        formData.append('file', file);
        const result = await apiUpload<FundraiserEvidenceMeta>(`/api/fundraisers/${targetId}/evidence`, formData, token);
        if (result?.id) {
          accepted.push(result);
        } else {
          setError((result as any)?.error || `Could not upload ${file.name}.`);
        }
      }
      if (accepted.length) {
        setEvidence((prev) => [...accepted, ...prev]);
        toast.success(`${accepted.length} evidence file${accepted.length === 1 ? '' : 's'} uploaded securely`);
      }
    } catch (reason: any) {
      setError(reason?.message || 'Evidence upload failed. Please try again.');
    } finally {
      setEvidenceUploading(false);
      if (evidenceInputRef.current) evidenceInputRef.current.value = '';
    }
  };

  const handleSubmit = async () => {
    if (!token) {
      router.push(`/login?next=${encodeURIComponent('/give/start')}`);
      return;
    }
    const validation = validateStep(5);
    if (validation) {
      setError(validation);
      setStep(2);
      return;
    }
    if (!declarationChecked) {
      setError('Please confirm the declaration before submitting.');
      return;
    }
    if (!fundraiserId) {
      setError('Please save your draft before submitting.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const result = await submitFundraiserForReview(fundraiserId, token);
      toast.success('Submitted for review');
      router.push(`/give/my/${result.fundraiser.id}?submitted=1`);
    } catch (reason: any) {
      setError(reason?.message || 'Submission failed. Please check the required fields.');
    } finally {
      setSubmitting(false);
    }
  };

  const StepOne = () => (
    <div className="space-y-5">
      <div>
        <p className="form-label">Fundraiser title</p>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Help Amina get emergency surgery" className="form-input" />
        <p className="mt-1 text-xs text-white/30">{title.length}/120</p>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <p className="form-label">Category</p>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="form-input">
            <option value="">Select a category…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <p className="form-label">Who are you raising money for?</p>
          <select value={raisingFor} onChange={(e) => setRaisingFor(e.target.value)} className="form-input">
            <option value="">Select…</option>
            {RAISING_FOR_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <p className="form-label">Country</p>
          <select value={country} onChange={(e) => setCountry(e.target.value)} className="form-input">
            <option value="">Select country…</option>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <p className="form-label">Location (city / region)</p>
          <input value={city} onChange={(e) => setCity(e.target.value)} maxLength={120} placeholder="Lagos, Nigeria" className="form-input" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <p className="form-label">Target amount (USD)</p>
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-white/30">$</span>
            <input value={targetAmount} onChange={(e) => setTargetAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="5,000" className="form-input pl-7" />
          </div>
        </div>
        <div>
          <p className="form-label">Fundraising deadline</p>
          <input type="date" value={deadline} min={new Date(Date.now() + 86400000).toISOString().split('T')[0]} onChange={(e) => setDeadline(e.target.value)} className="form-input" />
        </div>
      </div>

      {/* Cover */}
      <div>
        <p className="form-label">Cover photo or video</p>
        {cover ? (
          <div className="relative aspect-[16/9] w-full overflow-hidden rounded-xl border border-white/[0.08] bg-[#080808]">
            {cover.type === 'VIDEO' ? (
              <video src={resolveMediaUrl(cover.url)} poster={resolveMediaUrl(cover.thumbnailUrl)} muted playsInline preload="metadata" className="h-full w-full object-cover" />
            ) : (
              <Image src={resolveMediaUrl(cover.url)} alt="Fundraiser cover" fill sizes="(max-width: 768px) 100vw, 640px" className="object-cover" />
            )}
            <button
              type="button"
              onClick={() => setCover(null)}
              className="absolute right-2.5 top-2.5 grid h-8 w-8 place-items-center rounded-full bg-black/70 text-white backdrop-blur transition hover:bg-red-500/70"
              aria-label="Remove cover"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => coverInputRef.current?.click()}
            disabled={coverUploading}
            className="flex aspect-[16/9] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/[0.15] bg-white/[0.02] text-white/40 transition hover:border-white/30 hover:text-white/70"
          >
            {coverUploading ? <Loader2 size={20} className="animate-spin" /> : <UploadCloud size={20} />}
            <span className="text-xs">{coverUploading ? 'Uploading…' : 'Upload a photo or video'}</span>
          </button>
        )}
        <input ref={coverInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={(e) => handleCoverChange(e.target.files)} />
      </div>
    </div>
  );
const StepTwo = () => (
    <div className="space-y-5">
      <div>
        <p className="form-label">Short summary</p>
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={400} rows={2} placeholder="One or two sentences people see before opening your story…" className="form-textarea" />
        <p className="mt-1 text-xs text-white/30">{summary.length}/400</p>
      </div>

      <div>
        <p className="form-label">Full fundraiser story</p>
        <textarea value={story} onChange={(e) => setStory(e.target.value)} rows={8} placeholder="Tell your story in your own words. What happened, why does it matter, and how will this support help?" className="form-textarea" />
        <p className="mt-1 text-xs text-white/30">{story.length.toLocaleString()} characters</p>
      </div>

      <div>
        <p className="form-label">Why is the money needed?</p>
        <textarea value={fundsNeededFor} onChange={(e) => setFundsNeededFor(e.target.value)} maxLength={2000} rows={3} placeholder="Explain the genuine need behind this fundraiser…" className="form-textarea" />
      </div>

      <div>
        <p className="form-label">What will the funds be used for?</p>
        <textarea value={fundsUsage} onChange={(e) => setFundsUsage(e.target.value)} maxLength={2000} rows={3} placeholder="Be as specific as possible so donors know exactly where their support goes…" className="form-textarea" />
      </div>

      <div>
        <p className="form-label">Who will benefit?</p>
        <textarea value={whoBenefits} onChange={(e) => setWhoBenefits(e.target.value)} maxLength={2000} rows={2} placeholder="The people or community that will directly benefit…" className="form-textarea" />
      </div>
    </div>
  );
const StepThree = () => (
    <div className="space-y-5">
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-white">
          <ShieldCheck size={15} className="text-[var(--vanta-gold-bright)]" />
          Supporting evidence — private &amp; secure
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-white/45">
          Medical reports, hospital bills, invoices, and other relevant documents help our review team verify your fundraiser.
          These files are stored privately and are <span className="font-semibold text-white/70">never shown on your public page</span> —
          only VANTA review staff can access them.
        </p>
      </div>

      <div>
        <p className="form-label">Upload evidence</p>
        <button
          type="button"
          onClick={() => evidenceInputRef.current?.click()}
          disabled={evidenceUploading}
          className="flex min-h-[120px] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/[0.15] bg-white/[0.02] text-white/40 transition hover:border-white/30 hover:text-white/70"
        >
          {evidenceUploading ? <Loader2 size={22} className="animate-spin" /> : <UploadCloud size={22} />}
          <span className="text-xs">{evidenceUploading ? 'Uploading privately…' : 'Choose files (images, videos, PDFs — up to 50MB each)'}</span>
        </button>
        <input ref={evidenceInputRef} type="file" accept="image/*,video/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" multiple className="hidden" onChange={(e) => handleEvidenceChange(e.target.files)} />
      </div>

      {evidence.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-white/35">{evidence.length} file{evidence.length === 1 ? '' : 's'} stored securely</p>
          {evidence.map((item) => (
            <div key={item.id} className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.04]">
                <FileText size={15} className="text-[var(--vanta-gold-bright)]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">{item.originalName}</p>
                <p className="text-[11px] text-white/40">
                  {item.fileType} · {(item.size / 1024 / 1024).toFixed(1)}MB · {new Date(item.createdAt).toLocaleDateString()}
                </p>
              </div>
              <span className="rounded-full border border-[var(--gold-border)] bg-[var(--gold-bg)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--vanta-gold-bright)]">
                Private
              </span>
            </div>
          ))}
        </div>
      )}

      {evidence.length === 0 && (
        <p className="rounded-xl border border-amber-500/15 bg-amber-500/5 px-3.5 py-2.5 text-xs text-amber-200/70">
          Evidence is optional in the draft, but a beneficiary summary in the next step is required so reviewers understand who the funds help.
        </p>
      )}
    </div>
  );
const StepFour = () => (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <p className="form-label">Who receives the funds?</p>
          <input value={beneficiaryName} onChange={(e) => setBeneficiaryName(e.target.value)} maxLength={120} placeholder="Full name of the beneficiary" className="form-input" />
        </div>
        <div>
          <p className="form-label">Relationship to you</p>
          <select value={beneficiaryRelationship} onChange={(e) => setBeneficiaryRelationship(e.target.value)} className="form-input">
            <option value="">Select…</option>
            {RAISING_FOR_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <p className="form-label">About the beneficiary</p>
        <textarea value={beneficiarySummary} onChange={(e) => setBeneficiarySummary(e.target.value)} maxLength={1200} rows={3} placeholder="Non-sensitive details shown on your public page — age, situation, background…" className="form-textarea" />
        <p className="mt-1 text-xs text-white/30">{beneficiarySummary.length}/1200</p>
      </div>

      <div>
        <p className="form-label">How should funds be received?</p>
        <div className="space-y-2">
          {PAYOUT_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setPayoutMethod(option.id)}
              className={cn(
                'flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition',
                payoutMethod === option.id ? 'border-[var(--gold-border-strong)] bg-[var(--gold-bg)]' : 'border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.04]'
              )}
            >
              <div className={cn('mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border', payoutMethod === option.id ? 'border-[var(--vanta-gold)]' : 'border-white/25')}>
                {payoutMethod === option.id && <span className="h-2 w-2 rounded-full bg-[var(--vanta-gold)]" />}
              </div>
              <div>
                <p className={cn('text-sm font-semibold', payoutMethod === option.id ? 'text-[var(--vanta-gold-bright)]' : 'text-white/80')}>
                  {option.label}
                </p>
                <p className="mt-0.5 text-xs text-white/40">{option.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="form-label">Intended use of funds / payout notes (private)</p>
        <textarea value={organizerNotes} onChange={(e) => setOrganizerNotes(e.target.value)} maxLength={2000} rows={3} placeholder="For example: transfer steps, account details outline, or how you plan to disburse the funds…" className="form-textarea" />
        <p className="mt-1 text-xs text-white/30">Only VANTA review staff see these notes.</p>
      </div>
    </div>
  );
const StepFive = () => (
    <div className="space-y-5">
      {fundraiserId && (
        <div className="rounded-xl border border-[var(--gold-border)] bg-[var(--gold-bg)] px-4 py-3 text-sm text-[var(--vanta-gold-bright)]">
          You can edit this draft anytime before submitting.
        </div>
      )}

      <div className="space-y-4">
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
          <p className="text-label text-white/35">Preview</p>
          <div className="mt-2 flex items-start gap-3">
            <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-[#080808]">
              {cover ? (
                cover.type === 'VIDEO' ? (
                  <video src={resolveMediaUrl(cover.url)} poster={resolveMediaUrl(cover.thumbnailUrl)} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                ) : (
                  <Image src={resolveMediaUrl(cover.url)} alt="" fill sizes="96px" className="object-cover" />
                )
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-xl">{categories.find((c) => c.id === categoryId)?.emoji || '❤️'}</div>
              )}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-white">{title}</p>
              <p className="text-xs text-white/40">{categories.find((c) => c.id === categoryId)?.name}</p>
              <p className="mt-1 text-xs text-white/40">
                Goal: {targetAmount} USD · Deadline: {deadline ? new Date(deadline).toLocaleDateString() : '—'}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <PreviewBlock label="Story" value={summary || '—'} />
          <PreviewBlock label="Beneficiary" value={beneficiaryName || '—'} />
          <PreviewBlock label="Funds used for" value={fundsUsage || '—'} />
          <PreviewBlock label="Supporting evidence" value={evidence.length ? `${evidence.length} file${evidence.length === 1 ? '' : 's'} uploaded (private)` : 'None yet'} />
          <PreviewBlock label="Who benefits" value={whoBenefits || '—'} />
          <PreviewBlock label="Payout method" value={PAYOUT_OPTIONS.find((o) => o.id === payoutMethod)?.label || '—'} />
        </div>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
        <button
          type="button"
          role="checkbox"
          aria-checked={declarationChecked}
          onClick={() => setDeclarationChecked((v) => !v)}
          className={cn('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition', declarationChecked ? 'border-[var(--vanta-gold)] bg-[var(--vanta-gold)] text-black' : 'border-white/25')}
        >
          {declarationChecked && <Check size={13} strokeWidth={3} />}
        </button>
        <p className="text-xs leading-relaxed text-white/50">
          I affirm that the information provided in this fundraiser is <span className="font-semibold text-white/80">accurate and truthful</span>.
          I understand that this fundraiser will be reviewed by VANTA before going live, that the funds will be managed through the
          VANTA Wallet, and that providing false information may result in rejection, suspension, or account action.
        </p>
      </label>
    </div>
  );

  const PreviewBlock = ({ label, value }: { label: string; value: string }) => (
    <div className="rounded-xl border border-white/[0.05] bg-white/[0.015] px-3.5 py-3">
      <p className="text-[10px] uppercase tracking-[0.08em] text-white/35">{label}</p>
      <p className="mt-1 line-clamp-3 text-sm text-white/70">{value}</p>
    </div>
  );
  // Only VERIFIED users may create/start fundraisers (backend enforces this too).
  if (!authLoading && !fundraiserAllowed) {
    return (
      <div className="page-container-narrow">
        <div className="mx-auto max-w-md rounded-2xl border border-white/[0.07] bg-[var(--vanta-surface)] p-6 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-[var(--gold-border)] bg-[var(--gold-bg)]">
            <ShieldCheck size={24} className="text-[var(--vanta-gold-bright)]" />
          </div>
          <h1 className="mt-4 text-lg font-semibold text-white">Verification required</h1>
          <p className="mt-2 text-sm leading-relaxed text-white/55">
            Verification required to create a fundraiser. Only verified users can start a fundraiser — complete
            verification in your profile settings to get started.
          </p>
          <button
            type="button"
            onClick={() => router.push('/profile/settings')}
            className="btn-gold mt-6 min-h-11 w-full"
          >
            Go to Verification
          </button>
        </div>
      </div>
    );
  }

return (
    <div className="page-container-narrow">
      {/* Header */}
      <header className="mb-8 flex items-center justify-between">
        <button type="button" onClick={() => router.push(draftId ? '/give/my' : '/give')} className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] text-white/45 transition hover:text-white" aria-label="Back">
          <ArrowLeft size={17} />
        </button>
        <div className="text-center">
          <p className="text-label text-[var(--vanta-gold-bright)]">VANTA Give</p>
          <h1 className="mt-0.5 text-h3 text-white">Start a fundraiser</h1>
        </div>
        <button
          type="button"
          onClick={handleSaveDraft}
          disabled={saving || !title.trim()}
          className="flex h-10 items-center gap-1.5 rounded-xl border border-white/[0.1] px-4 text-xs font-semibold text-white/70 transition hover:bg-white/[0.05] hover:text-white disabled:opacity-40"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {fundraiserId ? 'Save draft' : 'Save'}
        </button>
      </header>

      {/* Step indicator */}
      <div className="mb-8">
        <div className="mb-3 flex items-center justify-between text-[11px] font-medium text-white/40">
          <span>
            Step {step} of 5 — {STEPS[step - 1].label}
          </span>
          <span>{Math.round(((step - 1) / 4) * 100)}%</span>
        </div>
        <div className="flex gap-1.5">
          {STEPS.map((item) => {
            const Icon = item.icon;
            const active = step === item.id;
            const done = step > item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setStep(item.id)}
                className={cn(
                  'flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border text-[11px] font-medium transition',
                  done && 'border-[var(--gold-border)] bg-[var(--gold-bg)] text-[var(--vanta-gold-bright)]',
                  active && 'border-white/25 bg-white/[0.06] text-white',
                  !active && !done && 'border-white/[0.07] bg-white/[0.02] text-white/35 hover:text-white/60'
                )}
              >
                {done ? <Check size={13} strokeWidth={3} /> : <Icon size={13} />}
                <span className="hidden sm:inline">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <p className="mb-5 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-300" role="alert">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      {loadingDraft ? (
        <div className="space-y-4 py-10">
          <div className="h-10 animate-pulse rounded-xl bg-white/[0.04]" />
          <div className="h-24 animate-pulse rounded-xl bg-white/[0.03]" />
          <div className="h-24 animate-pulse rounded-xl bg-white/[0.03]" />
        </div>
      ) : (
        <div className="rounded-2xl border border-white/[0.07] bg-[var(--vanta-surface)] p-5 sm:p-6">
          {step === 1 && <StepOne />}
          {step === 2 && <StepTwo />}
          {step === 3 && <StepThree />}
          {step === 4 && <StepFour />}
          {step === 5 && <StepFive />}
        </div>
      )}

      {/* Footer actions */}
      {!loadingDraft && (
        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 1}
            className={cn('flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-medium text-white/50 transition hover:text-white', step === 1 && 'invisible')}
          >
            <ChevronLeft size={15} />
            Back
          </button>
          {step < 5 ? (
            <button type="button" onClick={goNext} className="btn-gold min-h-11 px-6">
              Continue
              <ArrowRight size={15} />
            </button>
          ) : (
            <button type="button" onClick={handleSubmit} disabled={submitting} className="btn-gold min-h-11 px-6">
              {submitting ? <Loader2 size={15} className="animate-spin" /> : <Heart size={15} fill="currentColor" />}
              Submit for Review
            </button>
          )}
        </div>
      )}
    </div>
  );
}