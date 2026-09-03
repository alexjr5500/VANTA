'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, CalendarDays, Flag, Heart, Loader2, MapPin, ShieldCheck, Users } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { getPublicFundraiser, getPublicFundraiserUpdates, reportFundraiser } from '@/lib/fundraiserApi';
import FundraiserHero from '@/components/give/FundraiserHero';
import DonateSheet from '@/components/give/DonateSheet';
import ShareSheet from '@/components/give/ShareSheet';
import VantaVerifiedBadge from '@/components/give/VantaVerifiedBadge';
import Avatar from '@/components/ui/Avatar';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import type { Fundraiser, FundraiserSupporter, FundraiserUpdate } from '@/types/fundraiser';
import { useFundraiserStats } from '@/components/give/useFundraiserStats';

export default function FundraiserPage() {
  const params = useParams();
  const router = useRouter();
  const { token } = useAuth();
  const slug = String(params?.slug || '');

  const [fundraiser, setFundraiser] = useState<Fundraiser | null>(null);
  const [supporters, setSupporters] = useState<FundraiserSupporter[]>([]);
  const [updates, setUpdates] = useState<FundraiserUpdate[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [deadlinePassed, setDeadlinePassed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [donateOpen, setDonateOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportDetails, setReportDetails] = useState('');
  const [reportError, setReportError] = useState('');
  const [reportSending, setReportSending] = useState(false);

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError('');
    try {
      const result = await getPublicFundraiser(slug, token || undefined);
      setFundraiser(result.fundraiser);
      setSupporters(result.supporters || []);
      setIsOwner(Boolean(result.isOwner));
      setDeadlinePassed(Boolean(result.deadlinePassed));
    } catch (reason: any) {
      setError(reason?.statusCode === 404 ? 'not-found' : reason?.message || 'This fundraiser could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [slug, token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!slug) return;
    getPublicFundraiserUpdates(slug, token || undefined)
      .then(setUpdates)
      .catch(() => setUpdates([]));
  }, [slug, token, retry]);
const handleReport = async () => {
    if (!fundraiser || !token) {
      router.push(`/login?next=${encodeURIComponent(`/give/${fundraiser?.slug || slug}`)}`);
      return;
    }
    if (reportReason.trim().length < 3) {
      setReportError('Please provide a reason for reporting this fundraiser.');
      return;
    }
    setReportSending(true);
    setReportError('');
    try {
      await reportFundraiser(fundraiser.id, { reason: reportReason, details: reportDetails || undefined }, token);
      setReportOpen(false);
      setReportReason('');
      setReportDetails('');
    } catch (reason: any) {
      setReportError(reason?.message || 'Your report could not be submitted. Please try again.');
    } finally {
      setReportSending(false);
    }
  };

  if (loading && !fundraiser) {
    return (
      <div className="page-container">
        <div className="aspect-[16/9] w-full animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.03]" />
        <div className="mt-6 h-8 w-2/3 animate-pulse rounded-lg bg-white/[0.04]" />
        <div className="mt-3 h-4 w-full animate-pulse rounded bg-white/[0.03]" />
        <div className="mt-3 h-4 w-1/2 animate-pulse rounded bg-white/[0.03]" />
      </div>
    );
  }

  if (error === 'not-found' || (!fundraiser && error)) {
    return (
      <div className="page-container flex min-h-[60vh] flex-col items-center justify-center text-center">
        <div className="grid h-16 w-16 place-items-center rounded-2xl border border-white/[0.07] bg-white/[0.03]">
          <Heart size={26} className="text-white/30" />
        </div>
        <h1 className="mt-5 text-lg font-semibold text-white">Fundraiser not available</h1>
        <p className="mt-1 max-w-sm text-sm text-white/40">
          This fundraiser may have been suspended, reached its final state, or never existed.
        </p>
        <div className="mt-6 flex gap-3">
          <Button variant="secondary" onClick={() => router.push('/give')}>
            <ArrowLeft size={15} />
            Back to VANTA Give
          </Button>
          <Button variant="ghost" onClick={() => setRetry((v) => v + 1)}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!fundraiser) return null;

  const canDonate = !isOwner && !deadlinePassed && fundraiser.status === 'PUBLISHED';
return (
    <div className="page-container">
      <button
        type="button"
        onClick={() => router.push('/give')}
        className="mb-5 flex items-center gap-1.5 text-xs text-white/40 transition hover:text-white"
      >
        <ArrowLeft size={14} />
        Back to VANTA Give
      </button>

      {/* Hero */}
      <FundraiserHero
        fundraiser={fundraiser}
        onDonate={() => {
          if (!token) {
            router.push(`/login?next=${encodeURIComponent(`/give/${fundraiser.slug}`)}`);
            return;
          }
          setDonateOpen(true);
        }}
        onShare={() => setShareOpen(true)}
        disabled={!canDonate}
        disabledLabel={
          isOwner
            ? 'You are viewing your own fundraiser.'
            : deadlinePassed
              ? 'This fundraiser has passed its deadline.'
              : fundraiser.status !== 'PUBLISHED'
                ? 'This fundraiser is not currently accepting donations.'
                : undefined
        }
      />

      <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_340px]">
        {/* Main column */}
        <div className="min-w-0 space-y-10">
          {/* Transparency strip */}
          <section>
            <p className="text-label text-white/35">Transparency</p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <TransparencyStat label="Goal" value={`${fundraiser.targetAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${fundraiser.currency}`} />
              <TransparencyStat label="Status" value={statusLabel(fundraiser.status)} />
              <TransparencyStat
                label="Deadline"
                value={fundraiser.deadline ? new Date(fundraiser.deadline).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
              />
              <TransparencyStat label="Verification" value={fundraiser.verified ? 'VANTA Verified' : 'Pending'} accent={fundraiser.verified} />
            </div>
          </section>
{/* Story */}
          <section className="space-y-4">
            <h2 className="text-h3 text-white">Story</h2>
            <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-white/70">{fundraiser.story}</div>
            {fundraiser.fundsNeededFor && (
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-white/35">Why the money is needed</p>
                <p className="mt-2 text-sm leading-relaxed text-white/65">{fundraiser.fundsNeededFor}</p>
              </div>
            )}
            {fundraiser.fundsUsage && (
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-white/35">What the funds will be used for</p>
                <p className="mt-2 text-sm leading-relaxed text-white/65">{fundraiser.fundsUsage}</p>
              </div>
            )}
            {fundraiser.whoBenefits && (
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-white/35">Who will benefit</p>
                <p className="mt-2 text-sm leading-relaxed text-white/65">{fundraiser.whoBenefits}</p>
              </div>
            )}
          </section>

          {/* Beneficiary */}
          {fundraiser.beneficiaryName && (
            <section className="space-y-4">
              <h2 className="text-h3 text-white">About the beneficiary</h2>
              <div className="flex items-start gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-[var(--gold-border)] bg-[var(--gold-bg)] text-lg">
                  💛
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">{fundraiser.beneficiaryName}</p>
                  {fundraiser.beneficiaryRelationship && (
                    <p className="text-xs text-white/40">Relationship: {relationshipLabel(fundraiser.beneficiaryRelationship)}</p>
                  )}
                  {fundraiser.beneficiarySummary && (
                    <p className="mt-2 text-sm leading-relaxed text-white/65">{fundraiser.beneficiarySummary}</p>
                  )}
                </div>
              </div>
            </section>
          )}
{/* Updates */}
          {updates.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-h3 text-white">Updates</h2>
              <div className="space-y-4">
                {updates.map((update) => (
                  <article key={update.id} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
                    <p className="text-label text-[var(--vanta-gold-bright)]">
                      UPDATE · {new Date(update.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                    </p>
                    {update.title && <h3 className="mt-2 text-sm font-semibold text-white">{update.title}</h3>}
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/65">{update.body}</p>
                    {update.media && update.media.length > 0 && (
                      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {update.media.map((mediaItem, i) => (
                          <div key={i} className="relative aspect-video overflow-hidden rounded-xl bg-[#080808]">
                            {mediaItem.type === 'VIDEO' ? (
                              <video src={resolveMediaUrl(mediaItem.url)} poster={resolveMediaUrl(mediaItem.thumbnailUrl) || undefined} controls playsInline preload="metadata" className="h-full w-full object-cover" />
                            ) : (
                              <Image src={resolveMediaUrl(mediaItem.url)} alt={`Update media ${i + 1}`} fill sizes="(max-width: 640px) 50vw, 200px" className="object-cover" />
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}

          {/* Supporters */}
          {supporters.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-h3 text-white">Supporters</h2>
                <span className="flex items-center gap-1.5 text-xs text-white/40">
                  <Users size={13} />
                  {fundraiser.supporterCount} total
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {supporters.map((supporter) => (
                  <div key={supporter.id} className="flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.02] py-1 pl-1 pr-3">
                    <Avatar src={supporter.donor?.avatar || null} alt={supporter.donor?.username || 'Supporter'} size="sm" />
                    <div className="leading-none">
                      <p className="text-xs font-medium text-white/80">{supporter.donor?.username || 'Anonymous'}</p>
                      <p className="mt-0.5 text-[10px] text-[var(--vanta-gold-bright)]">
                        {supporter.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })} {supporter.currency}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="flex items-center gap-1.5 text-[11px] text-white/35">
                <ShieldCheck size={12} />
                Some supporters choose to donate anonymously — we always respect their privacy.
              </p>
            </section>
          )}
        </div>
{/* Sidebar */}
        <aside className="space-y-4 self-start lg:sticky lg:top-24">
          <div className="rounded-2xl border border-white/[0.07] bg-[var(--vanta-surface)] p-4">
            <FundraiserHeroCTA fundraiser={fundraiser} canDonate={canDonate} onDonate={() => setDonateOpen(true)} />
          </div>

          <div className="rounded-2xl border border-white/[0.07] bg-[var(--vanta-surface)] p-4">
            <p className="text-label text-white/35">Organized by</p>
            {fundraiser.owner && (
              <Link href={`/profile/${fundraiser.owner.username}`} className="mt-3 flex items-center gap-3">
                <Avatar src={fundraiser.owner.avatar || null} alt={fundraiser.owner.username} size="md" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{fundraiser.owner.fullName || fundraiser.owner.username}</p>
                  <p className="truncate text-xs text-white/40">@{fundraiser.owner.username}</p>
                </div>
              </Link>
            )}
            {fundraiser.location && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-white/40">
                <MapPin size={12} />
                {fundraiser.location}
                {fundraiser.country ? `, ${fundraiser.country}` : ''}
              </p>
            )}
            <div className="mt-3 flex items-center justify-between text-xs text-white/40">
              <span className="flex items-center gap-1.5">
                <CalendarDays size={12} />
                Created {new Date(fundraiser.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
          </div>

          {fundraiser.verified && (
            <div className="flex items-start gap-2.5 rounded-2xl border border-[var(--gold-border)] bg-[var(--gold-bg)] p-3.5 text-xs leading-relaxed text-[var(--vanta-gold-bright)]/80">
              <VantaVerifiedBadge size="sm" />
              <p>
                <span className="font-semibold text-[var(--vanta-gold-bright)]">VANTA Verified</span> — this fundraiser&apos;s information and
                evidence were reviewed through VANTA&apos;s verification process. This does not guarantee the outcome or every
                statement made by the organizer.
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => setReportOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.07] py-2.5 text-xs font-medium text-white/40 transition hover:border-red-500/20 hover:text-red-300"
          >
            <Flag size={13} />
            Report fundraiser
          </button>
        </aside>
      </div>

      {/* Donate / Share / Report */}
      <DonateSheet
        fundraiser={fundraiser}
        open={donateOpen}
        onClose={() => setDonateOpen(false)}
        onDonated={() => void load()}
      />
      <ShareSheet fundraiser={fundraiser} open={shareOpen} onClose={() => setShareOpen(false)} />
<Modal open={reportOpen} onClose={() => setReportOpen(false)} title="Report fundraiser" description="Help us keep VANTA Give safe and trustworthy." size="md">
        <div className="space-y-4">
          <div>
            <p className="form-label">Reason</p>
            <select value={reportReason} onChange={(e) => setReportReason(e.target.value)} className="form-input">
              <option value="">Select a reason…</option>
              <option value="SUSPECTED_FRAUD">Suspected fraud or scam</option>
              <option value="MISLEADING_INFORMATION">Misleading information</option>
              <option value="PRIVACY_VIOLATION">Privacy violation</option>
              <option value="HARASSMENT">Harassment or abuse</option>
              <option value="OTHER">Something else</option>
            </select>
          </div>
          <div>
            <p className="form-label">Details (optional)</p>
            <textarea
              value={reportDetails}
              onChange={(e) => setReportDetails(e.target.value.slice(0, 2000))}
              rows={4}
              placeholder="Tell us anything that will help our team investigate…"
              className="form-textarea"
            />
          </div>
          {reportError && (
            <p className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-300" role="alert">
              <AlertCircle size={14} className="shrink-0" />
              {reportError}
            </p>
          )}
          <Button variant="danger" fullWidth onClick={handleReport} disabled={reportSending}>
            {reportSending ? <Loader2 size={15} className="animate-spin" /> : <Flag size={15} />}
            Submit report
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function TransparencyStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-3.5 py-3">
      <p className="text-[10px] uppercase tracking-[0.08em] text-white/35">{label}</p>
      <p className={cn('mt-1 text-sm font-semibold', accent ? 'text-[var(--vanta-gold-bright)]' : 'text-white/85')}>{value}</p>
    </div>
  );
}

function FundraiserHeroCTA({ fundraiser, canDonate, onDonate }: { fundraiser: Fundraiser; canDonate: boolean; onDonate: () => void }) {
  const { percentFunded, raisedLabel, daysLeft, supportersLabel } = useFundraiserStats(fundraiser);
  return (
    <div className="space-y-2.5">
      <p className="text-h3 text-white">{raisedLabel}</p>
      <p className="text-xs text-white/40">
        of {fundraiser.targetAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} {fundraiser.currency} goal
      </p>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.07]">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, Math.max(2, percentFunded))}%`, background: percentFunded >= 100 ? 'var(--gradient-gold)' : 'var(--gradient-primary)' }}
        />
      </div>
      <p className="text-xs text-white/45">
        {Math.round(percentFunded)}% funded · {supportersLabel} supporters · {daysLeft > 0 ? `${daysLeft} days left` : 'ended'}
      </p>
      <Button variant="gold" fullWidth onClick={onDonate} disabled={!canDonate} className="mt-1">
        <Heart size={15} fill="currentColor" />
        Donate
      </Button>
    </div>
  );
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    DRAFT: 'Draft',
    UNDER_REVIEW: 'Under review',
    MORE_INFORMATION_REQUIRED: 'More info needed',
    APPROVED: 'Approved',
    PUBLISHED: 'Live',
    SUSPENDED: 'Suspended',
    REJECTED: 'Rejected',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
  };
  return labels[status] || status;
}

function relationshipLabel(relationship: string): string {
  const labels: Record<string, string> = {
    SELF: 'Myself',
    FAMILY_MEMBER: 'A family member',
    FRIEND: 'A friend',
    COMMUNITY: 'My community',
    OTHER: 'Other',
  };
  return labels[relationship] || relationship;
}