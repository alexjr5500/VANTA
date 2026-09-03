'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  BadgeCheck,
  Ban,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  Flag,
  Heart,
  Loader2,
  MessageSquareWarning,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  X,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import {
  adminApproveFundraiser,
  adminCompleteFundraiser,
  adminGetFundraiser,
  adminListFundraiserReports,
  adminListFundraisers,
  adminRejectFundraiser,
  adminRequestFundraiserInfo,
  adminResolveFundraiserReport,
  adminSetFundraiserVerified,
  adminSuspendFundraiser,
  adminToggleFundraiserFeatured,
  adminUnsuspendFundraiser,
} from '@/lib/fundraiserApi';
import VantaVerifiedBadge from '@/components/give/VantaVerifiedBadge';
import type { AdminFundraiserDetail, FundraiserListItem, FundraiserReport } from '@/types/fundraiser';
import { evidenceFileUrl } from '@/lib/fundraiserApi';

const TABS = [
  { id: 'UNDER_REVIEW', label: 'Pending' },
  { id: 'PUBLISHED', label: 'Live' },
  { id: 'APPROVED', label: 'Approved' },
  { id: 'REJECTED', label: 'Rejected' },
  { id: 'SUSPENDED', label: 'Suspended' },
  { id: 'COMPLETED', label: 'Completed' },
  { id: 'ALL', label: 'All' },
] as const;

type TabId = (typeof TABS)[number]['id'];

type ActionModalKind = 'request-info' | 'reject' | 'suspend' | null;

export default function AdminFundraisersPage() {
  const toast = useToast();
  const { token } = useAuth();

  const [tab, setTab] = useState<TabId>('UNDER_REVIEW');
  const [items, setItems] = useState<FundraiserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminFundraiserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [actionModal, setActionModal] = useState<ActionModalKind>(null);
  const [actionText, setActionText] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  const [reports, setReports] = useState<FundraiserReport[]>([]);
  const [showReports, setShowReports] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const result = await adminListFundraisers({ status: tab === 'ALL' ? undefined : tab, search: query || undefined }, token);
      setItems(result.items || []);
    } catch (reason: any) {
      setError(reason?.message || 'Fundraisers could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [tab, query, token]);

  useEffect(() => {
    void load();
  }, [load, retry]);

  useEffect(() => {
    if (!token) return;
    adminListFundraiserReports(token).then(setReports).catch(() => setReports([]));
  }, [token]);

  const openDetail = async (id: string) => {
    if (!token) return;
    setDetailId(id);
    setDetailLoading(true);
    setDetail(null);
    try {
      const data = await adminGetFundraiser(id, token);
      setDetail(data);
    } catch (reason: any) {
      toast.error('Could not load fundraiser', reason?.message);
      setDetailId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshDetail = async () => {
    if (!detailId || !token) return;
    const data = await adminGetFundraiser(detailId, token);
    setDetail(data);
    void load();
  };

  const runAction = async (action: () => Promise<any>, successMessage: string) => {
    if (!token) return;
    setActionBusy(true);
    try {
      await action();
      toast.success(successMessage);
      setActionModal(null);
      setActionText('');
      await refreshDetail();
      void load();
    } catch (reason: any) {
      toast.error('Action failed', reason?.message);
    } finally {
      setActionBusy(false);
    }
  };

  const openActionModal = (kind: ActionModalKind) => {
    setActionModal(kind);
    setActionText('');
  };

  const confirmAction = () => {
    if (!detailId || !token || actionText.trim().length < 5) return;
    if (actionModal === 'request-info') runAction(() => adminRequestFundraiserInfo(detailId, actionText.trim(), token), 'More information requested');
    if (actionModal === 'reject') runAction(() => adminRejectFundraiser(detailId, actionText.trim(), token), 'Fundraiser rejected');
    if (actionModal === 'suspend') runAction(() => adminSuspendFundraiser(detailId, actionText.trim(), token), 'Fundraiser suspended');
  };
return (
    <div className="min-h-screen">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-label text-[var(--vanta-gold-bright)]">Admin</p>
          <h1 className="mt-1 text-h1 text-white">Fundraisers</h1>
          <p className="mt-1 text-secondary text-white/45">Review applications, moderate live campaigns, and manage verification.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowReports(true)} className="relative flex h-10 items-center gap-1.5 rounded-xl border border-white/[0.08] px-3.5 text-xs font-medium text-white/60 transition hover:text-white">
            <Flag size={14} />
            Reports
            {reports.some((r) => r.status === 'OPEN') && (
              <span className="grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                {reports.filter((r) => r.status === 'OPEN').length}
              </span>
            )}
          </button>
          <button type="button" onClick={() => setRetry((v) => v + 1)} className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] text-white/45 transition hover:text-white" aria-label="Refresh">
            <RefreshCw size={15} />
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-white/[0.06] scrollbar-hide" role="tablist" aria-label="Fundraiser status">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={cn(
              'relative shrink-0 px-4 py-2.5 text-sm font-medium transition',
              tab === item.id ? 'text-white after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-[var(--vanta-gold)]' : 'text-white/40 hover:text-white/70'
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="relative mb-5 max-w-md">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search fundraisers or organizers…" className="form-input pl-10" />
      </div>

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-white/[0.03]" />
          ))}
        </div>
      )}
      {!loading && error && (
        <div className="flex flex-col items-center py-16 text-center">
          <AlertCircle size={32} className="text-red-400/60" />
          <p className="mt-3 text-sm text-white/60">{error}</p>
          <button type="button" onClick={() => setRetry((v) => v + 1)} className="btn-secondary mt-4">
            Try again
          </button>
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <div className="flex flex-col items-center py-16 text-center">
          <Heart size={32} className="text-white/20" />
          <p className="mt-3 text-sm text-white/45">No {tab === 'ALL' ? 'fundraisers' : `${tab.toLowerCase()} fundraisers`}.</p>
        </div>
      )}
{!loading && items.length > 0 && (
        <div className="space-y-3">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => openDetail(item.id)}
              className="flex w-full items-center gap-4 rounded-2xl border border-white/[0.07] bg-[var(--vanta-surface)] p-4 text-left transition hover:border-white/[0.14] hover:bg-[var(--vanta-elevated)]"
            >
              <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-[#080808]">
                {item.coverMediaUrl ? (
                  item.coverMediaType === 'VIDEO' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <video src={resolveMediaUrl(item.coverMediaUrl)} poster={resolveMediaUrl(item.coverMediaThumbnailUrl) || undefined} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={resolveMediaUrl(item.coverMediaUrl)} alt="" className="h-full w-full object-cover" />
                  )
                ) : (
                  <div className="grid h-full w-full place-items-center text-xl">{item.category?.emoji || '❤️'}</div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-white">{item.title}</p>
                  {item.verified && <VantaVerifiedBadge size="xs" />}
                  {item.isFeatured && <Star size={12} className="fill-[var(--vanta-gold)] text-[var(--vanta-gold)]" />}
                </div>
                <p className="mt-0.5 text-xs text-white/40">
                  @{item.owner?.username} · {item.category?.name} · {item.targetAmount.toLocaleString()} {item.currency}
                </p>
                <p className="mt-1 text-[11px] text-white/35">
                  {item.raisedAmount.toLocaleString()} raised · {item.supporterCount} supporters
                  {item.deadline ? ` · deadline ${new Date(item.deadline).toLocaleDateString()}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide', statusStyles(item.status))}>
                  {item.status.replaceAll('_', ' ')}
                </span>
                <Eye size={15} className="text-white/25" />
              </div>
            </button>
          ))}
        </div>
      )}
{/* Detail modal */}
      <Modal open={detailId !== null} onClose={() => setDetailId(null)} size="xl" title={detail?.fundraiser.title || 'Fundraiser'} description="Review application details">
        {detailLoading || !detail ? (
          <div className="flex min-h-[240px] items-center justify-center">
            <Loader2 size={24} className="animate-spin text-[var(--vanta-gold-bright)]" />
          </div>
        ) : (
          <Detail
            fundraiser={detail.fundraiser}
            auditLogs={detail.auditLogs}
            previousFundraisers={detail.previousFundraisers}
            token={token}
            onRunAction={runAction}
            onOpenActionModal={openActionModal}
          />
        )}
      </Modal>

      {/* Action modal */}
      <Modal open={actionModal !== null} onClose={() => { setActionModal(null); setActionText(''); }} size="md" title={actionModal === 'request-info' ? 'Request more information' : actionModal === 'reject' ? 'Reject fundraiser' : 'Suspend fundraiser'}>
        <div className="space-y-4">
          <p className="text-sm text-white/50">
            {actionModal === 'request-info' && 'Explain what information is missing. The organizer will be notified and can resubmit.'}
            {actionModal === 'reject' && 'Provide a reason for rejecting this fundraiser. The organizer will be notified.'}
            {actionModal === 'suspend' && 'Provide a reason. The fundraiser will be removed from public visibility immediately.'}
          </p>
          <textarea value={actionText} onChange={(e) => setActionText(e.target.value)} rows={4} placeholder={actionModal === 'reject' ? 'Reason for rejection…' : 'Message to the organizer…'} className="form-textarea" autoFocus />
          <Button variant={actionModal === 'suspend' ? 'danger' : 'gold'} fullWidth disabled={actionText.trim().length < 5 || actionBusy} onClick={confirmAction}>
            {actionBusy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            Confirm
          </Button>
        </div>
      </Modal>

      {/* Reports modal */}
      <Modal open={showReports} onClose={() => setShowReports(false)} title="Fundraiser reports" size="lg">
        <div className="space-y-3">
          {reports.length === 0 && <p className="py-10 text-center text-sm text-white/40">No reports yet.</p>}
          {reports.map((report) => (
            <div key={report.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-white">{report.fundraiser?.title}</p>
                <span className={cn('rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase', report.status === 'OPEN' ? 'border-red-500/25 bg-red-500/10 text-red-300' : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300')}>
                  {report.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-white/50">Reported by @{report.reporter?.username} · {new Date(report.createdAt).toLocaleString()}</p>
              <p className="mt-2 text-sm text-white/70">
                <span className="font-semibold text-white/85">{report.reason}</span>
                {report.details ? ` — ${report.details}` : ''}
              </p>
              {report.status === 'OPEN' && (
                <div className="mt-3 flex gap-2">
                  <button type="button" className="btn-secondary min-h-8 px-3 text-xs" onClick={() => runAction(() => adminResolveFundraiserReport(report.id, { status: 'INVESTIGATING' }, token!), 'Report under investigation')}>
                    Investigate
                  </button>
                  <button type="button" className="btn-destructive min-h-8 px-3 text-xs" onClick={() => runAction(() => adminResolveFundraiserReport(report.id, { status: 'DISMISSED' }, token!), 'Report dismissed')}>
                    Dismiss
                  </button>
                  <button type="button" className="btn-gold min-h-8 px-3 text-xs" onClick={() => runAction(() => adminResolveFundraiserReport(report.id, { status: 'RESOLVED' }, token!), 'Report resolved')}>
                    Resolve
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
function Detail({
  fundraiser: f,
  auditLogs,
  previousFundraisers,
  token,
  onRunAction,
  onOpenActionModal,
}: AdminFundraiserDetail & {
  token: string | null;
  onRunAction: (_action: () => Promise<any>, _message: string) => void;
  onOpenActionModal: (_kind: ActionModalKind) => void;
}) {
  const owner = f.owner;
  const isUnderReview = f.status === 'UNDER_REVIEW';
  const isSuspended = f.status === 'SUSPENDED';
  const isEditableReview = isUnderReview || f.status === 'MORE_INFORMATION_REQUIRED';
  const isLivePublished = f.status === 'PUBLISHED' || f.status === 'APPROVED';
  const adminToken = token || '';

  return (
    <div className="space-y-6">
      {!f.verified && f.status === 'PUBLISHED' && (
        <p className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3.5 py-2.5 text-xs text-amber-200/80">
          <ShieldCheck size={14} />
          This live fundraiser is not yet VANTA Verified.
        </p>
      )}

      {f.infoRequestMessage && <Notice tone="amber" title="Info request sent" body={f.infoRequestMessage} />}
      {f.rejectionReason && <Notice tone="red" title="Rejection reason" body={f.rejectionReason} />}
      {f.suspensionReason && <Notice tone="red" title="Suspension reason" body={f.suspensionReason} />}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {(isUnderReview || f.status === 'MORE_INFORMATION_REQUIRED' || f.status === 'APPROVED') && (
          <Button variant="gold" size="sm" onClick={() => onRunAction(() => adminApproveFundraiser(f.id, { publish: true }, adminToken), 'Fundraiser approved and published')}>
            <CheckCircle2 size={14} />
            Approve &amp; publish
          </Button>
        )}
        {isSuspended && (
          <Button variant="secondary" size="sm" onClick={() => onRunAction(() => adminUnsuspendFundraiser(f.id, adminToken), 'Fundraiser restored')}>
            <Check size={14} />
            Restore
          </Button>
        )}
        {isEditableReview && (
          <>
            <Button variant="secondary" size="sm" onClick={() => onOpenActionModal('request-info')}>
              <MessageSquareWarning size={14} />
              Request more info
            </Button>
            <Button variant="danger" size="sm" onClick={() => onOpenActionModal('reject')}>
              <X size={14} />
              Reject
            </Button>
          </>
        )}
        {isLivePublished && (
          <Button variant="danger" size="sm" onClick={() => onOpenActionModal('suspend')}>
            <Ban size={14} />
            Suspend
          </Button>
        )}
        {isLivePublished && (
          <Button variant="secondary" size="sm" onClick={() => onRunAction(() => adminCompleteFundraiser(f.id, adminToken), 'Fundraiser completed')}>
            <Check size={14} />
            Mark completed
          </Button>
        )}
        <Button
          variant={f.verified ? 'ghost' : 'secondary'}
          size="sm"
          onClick={() => onRunAction(() => adminSetFundraiserVerified(f.id, !f.verified, adminToken), f.verified ? 'Verification removed' : 'Fundraiser marked VANTA Verified')}
        >
          <BadgeCheck size={14} />
          {f.verified ? 'Remove Verified' : 'Mark Verified'}
        </Button>
        <Button
          variant={f.isFeatured ? 'ghost' : 'secondary'}
          size="sm"
          onClick={() => onRunAction(() => adminToggleFundraiserFeatured(f.id, !f.isFeatured, adminToken), f.isFeatured ? 'Removed from featured' : 'Marked as featured')}
        >
          <Star size={14} className={f.isFeatured ? 'fill-[var(--vanta-gold)] text-[var(--vanta-gold)]' : ''} />
          {f.isFeatured ? 'Unfeature' : 'Feature'}
        </Button>
      </div>

      {/* Overview grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <InfoCard label="Status" value={f.status.replaceAll('_', ' ')} />
        <InfoCard label="Goal" value={`${f.targetAmount.toLocaleString()} ${f.currency}`} />
        <InfoCard label="Raised" value={`${f.raisedAmount.toLocaleString()} ${f.currency}`} />
        <InfoCard label="Supporters" value={String(f.supporterCount)} />
        <InfoCard label="Category" value={f.category?.name || '—'} />
        <InfoCard label="Deadline" value={f.deadline ? new Date(f.deadline).toLocaleDateString() : '—'} />
        <InfoCard label="Submitted" value={f.submittedAt ? new Date(f.submittedAt).toLocaleDateString() : '—'} />
        <InfoCard label="Payout" value={payoutLabel(f.payoutMethod)} />
      </div>
{/* Applicant */}
      {owner && (
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
          <p className="text-label text-white/35">Applicant</p>
          <div className="mt-3 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={owner.avatar || ''} alt="" className="h-11 w-11 rounded-full border border-white/[0.08] bg-white/[0.05] object-cover" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">{owner.fullName || owner.username}</p>
              <p className="text-xs text-white/40">@{owner.username} · {owner.email || 'no email'} · role {owner.role || 'USER'}</p>
              <p className="mt-0.5 text-[11px] text-white/35">
                {owner.country && <span className="mr-2">{owner.country}</span>}
                {owner.status || 'ACTIVE'}
                {owner.verified ? ' · verified account' : ''}
              </p>
            </div>
          </div>

          {previousFundraisers.length > 0 && (
            <div className="mt-3 border-t border-white/[0.06] pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/35">Previous fundraisers</p>
              <div className="mt-2 space-y-1.5">
                {previousFundraisers.map((prev) => (
                  <div key={prev.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-white/60">{prev.title}</span>
                    <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase', statusStyles(prev.status))}>{prev.status.replaceAll('_', ' ')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Story */}
      {f.story && (
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
          <p className="text-label text-white/35">Story</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/65">{f.story}</p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {f.fundsNeededFor && <MiniBlock label="Why needed" value={f.fundsNeededFor} />}
            {f.fundsUsage && <MiniBlock label="Funds use" value={f.fundsUsage} />}
            {f.whoBenefits && <MiniBlock label="Who benefits" value={f.whoBenefits} />}
            {f.organizerNotes && <MiniBlock label="Private organizer notes" value={f.organizerNotes} />}
          </div>
        </div>
      )}

      {/* Beneficiary */}
      {(f.beneficiaryName || f.beneficiarySummary) && (
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
          <p className="text-label text-white/35">Beneficiary</p>
          <p className="mt-2 text-sm font-semibold text-white">{f.beneficiaryName}</p>
          <p className="text-xs text-white/40">Relationship: {f.beneficiaryRelationship || '—'}</p>
          {f.beneficiarySummary && <p className="mt-2 text-sm leading-relaxed text-white/65">{f.beneficiarySummary}</p>}
        </div>
      )}

      {/* Evidence */}
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
        <p className="flex items-center gap-2 text-label text-white/35">
          <FileText size={12} />
          Evidence ({f.evidence?.length || 0})
        </p>
        {!f.evidence?.length ? (
          <p className="mt-2 text-xs text-white/40">No evidence uploaded.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {f.evidence.map((item) => (
              <div key={item.id} className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                <FileText size={14} className="shrink-0 text-[var(--vanta-gold-bright)]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-white/75">{item.originalName}</p>
                  <p className="text-[11px] text-white/35">{item.fileType} · {(item.size / 1024 / 1024).toFixed(1)}MB</p>
                </div>
                <a href={`${evidenceFileUrl(f.id, item.id)}`} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--vanta-gold)] px-3 py-1.5 text-[11px] font-semibold text-black">
                  <Eye size={12} />
                  View
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
{/* Donations */}
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
        <p className="text-label text-white/35">Recent donations</p>
        {!f.donations?.length ? (
          <p className="mt-2 text-xs text-white/40">No donations yet.</p>
        ) : (
          <div className="mt-3 max-h-56 space-y-1.5 overflow-y-auto">
            {f.donations.slice(0, 20).map((donation) => (
              <div key={donation.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-white/60">
                  {donation.anonymous ? 'Anonymous' : donation.donor ? `@${donation.donor.username}` : 'Deleted user'}
                  {donation.message ? ` — "${donation.message.slice(0, 60)}"` : ''}
                </span>
                <span className="shrink-0 font-semibold text-[var(--vanta-gold-bright)]">
                  {donation.amount.toLocaleString()} {donation.currency}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reports for this fundraiser */}
      {f.reports.length > 0 && (
        <div className="rounded-xl border border-red-500/15 bg-red-500/[0.02] p-4">
          <p className="flex items-center gap-2 text-label text-red-300/80">
            <Flag size={12} />
            Reports ({f.reports.length})
          </p>
          <div className="mt-3 space-y-2">
            {f.reports.map((report) => (
              <div key={report.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs">
                <p className="font-semibold text-white/75">
                  {report.reason} <span className="font-normal text-white/35">by @{report.reporter?.username}</span>
                </p>
                {report.details && <p className="mt-1 text-white/50">{report.details}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
{/* Audit trail */}
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
        <p className="flex items-center gap-2 text-label text-white/35">
          <Clock size={12} />
          Audit trail ({auditLogs.length})
        </p>
        <ol className="mt-3 space-y-2.5">
          {auditLogs.map((log) => (
            <li key={log.id} className="flex items-start gap-2.5 text-xs">
              <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', log.action.includes('REJECT') || log.action.includes('SUSPEND') || log.action.includes('CANCEL') ? 'bg-red-400' : 'bg-amber-400')} />
              <div>
                <p className="text-white/70">
                  <span className="font-semibold">{auditLabel(log.action)}</span>
                  <span className="text-white/35"> · {new Date(log.createdAt).toLocaleString()}</span>
                </p>
                {log.toStatus && <p className="text-white/40">{log.fromStatus || '—'} → {log.toStatus}</p>}
                {log.metadata && typeof log.metadata === 'object' && (log.metadata as any).reason && (
                  <p className="mt-0.5 text-white/40">{(log.metadata as any).reason}</p>
                )}
                {log.metadata && typeof log.metadata === 'object' && (log.metadata as any).message && (
                  <p className="mt-0.5 text-white/40">{(log.metadata as any).message}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Notice({ tone, title, body }: { tone: 'amber' | 'red'; title: string; body: string }) {
  return (
    <div className={cn('flex items-start gap-2.5 rounded-xl border p-3.5', tone === 'red' ? 'border-red-500/20 bg-red-500/5' : 'border-amber-500/20 bg-amber-500/5')}>
      {tone === 'red' ? <AlertCircle size={15} className="mt-0.5 shrink-0 text-red-300" /> : <MessageSquareWarning size={15} className="mt-0.5 shrink-0 text-amber-300" />}
      <div>
        <p className="text-xs font-semibold text-white/85">{title}</p>
        <p className="mt-0.5 text-xs text-white/55">{body}</p>
      </div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
      <p className="text-[10px] uppercase tracking-[0.08em] text-white/35">{label}</p>
      <p className="mt-1 text-sm font-semibold text-white/85">{value}</p>
    </div>
  );
}

function MiniBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-[0.08em] text-white/35">{label}</p>
      <p className="mt-1 text-xs leading-relaxed text-white/60">{value}</p>
    </div>
  );
}

function statusStyles(status: string): string {
  switch (status) {
    case 'PUBLISHED':
    case 'COMPLETED':
    case 'APPROVED':
      return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300';
    case 'UNDER_REVIEW':
    case 'MORE_INFORMATION_REQUIRED':
      return 'border-amber-500/25 bg-amber-500/10 text-amber-300';
    case 'SUSPENDED':
    case 'REJECTED':
      return 'border-red-500/25 bg-red-500/10 text-red-300';
    default:
      return 'border-white/[0.1] bg-white/[0.04] text-white/50';
  }
}

function payoutLabel(method: string | null): string {
  const labels: Record<string, string> = {
    WALLET_BALANCE: 'VANTA Wallet balance',
    BANK_TRANSFER: 'Bank transfer',
    USDT: 'USDT (BEP-20)',
  };
  return method ? labels[method] || method : '—';
}

function auditLabel(action: string): string {
  const labels: Record<string, string> = {
    SUBMITTED: 'Submitted for review',
    APPROVED: 'Approved',
    PUBLISHED: 'Published',
    REQUEST_MORE_INFO: 'More information requested',
    REJECTED: 'Rejected',
    SUSPENDED: 'Suspended',
    UNSUSPENDED: 'Restored',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
    EVIDENCE_UPLOADED: 'Evidence uploaded',
    UPDATE_POSTED: 'Update posted',
    SHARED: 'Campaign shared',
    FEATURED: 'Featured',
    UNFEATURED: 'Unfeatured',
    VERIFIED: 'VANTA Verified',
    UNVERIFIED: 'Verification removed',
    REPORTED: 'Reported',
  };
  return labels[action] || action.replaceAll('_', ' ');
}