'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  Loader2,
  Pencil,
  Send,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import {
  cancelFundraiser,
  deleteFundraiser,
  getMyFundraiser,
  getMyFundraiserAudit,
  listMyEvidence,
  postFundraiserUpdate,
  submitFundraiserForReview,
} from '@/lib/fundraiserApi';
import type { Fundraiser, FundraiserAuditLogRow, FundraiserEvidenceMeta, FundraiserUpdate } from '@/types/fundraiser';
import VantaVerifiedBadge from '@/components/give/VantaVerifiedBadge';
import { useFundraiserStats } from '@/components/give/useFundraiserStats';

export default function MyFundraiserPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const { token } = useAuth();
  const id = String(params?.id || '');

  const [fundraiser, setFundraiser] = useState<Fundraiser | null>(null);
  const [evidence, setEvidence] = useState<FundraiserEvidenceMeta[]>([]);
  const [auditLogs, setAuditLogs] = useState<FundraiserAuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateTitle, setUpdateTitle] = useState('');
  const [updateBody, setUpdateBody] = useState('');
  const [updateError, setUpdateError] = useState('');
  const [localUpdates, setLocalUpdates] = useState<FundraiserUpdate[]>([]);

  const load = useCallback(async () => {
    if (!id || !token) return;
    setLoading(true);
    setError('');
    try {
      const [draft, evidenceList, audit] = await Promise.all([
        getMyFundraiser(id, token),
        listMyEvidence(id, token),
        getMyFundraiserAudit(id, token),
      ]);
      setFundraiser(draft);
      setEvidence(evidenceList || []);
      setAuditLogs(audit || []);
    } catch (reason: any) {
      setError(reason?.statusCode === 404 ? 'not-found' : reason?.message || 'This fundraiser could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [id, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSubmit = async () => {
    if (!fundraiser || !token) return;
    setBusy(true);
    try {
      await submitFundraiserForReview(fundraiser.id, token);
      toast.success('Submitted for review');
      setFundraiser({ ...fundraiser, status: 'UNDER_REVIEW' });
    } catch (reason: any) {
      toast.error('Could not submit', reason?.message);
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!fundraiser || !token) return;
    if (!window.confirm('Cancel this fundraiser? It cannot be undone.')) return;
    setBusy(true);
    try {
      const result = await cancelFundraiser(fundraiser.id, token);
      setFundraiser(result.fundraiser);
      toast.success('Fundraiser cancelled');
    } catch (reason: any) {
      toast.error('Could not cancel', reason?.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!fundraiser || !token) return;
    if (!window.confirm('Delete this draft permanently?')) return;
    setBusy(true);
    try {
      await deleteFundraiser(fundraiser.id, token);
      toast.success('Draft deleted');
      router.push('/give/my');
    } catch (reason: any) {
      toast.error('Could not delete', reason?.message);
    } finally {
      setBusy(false);
    }
  };

  const handlePostUpdate = async () => {
    if (!fundraiser || !token) return;
    if (updateBody.trim().length < 5) {
      setUpdateError('Please write a little more before posting.');
      return;
    }
    setBusy(true);
    setUpdateError('');
    try {
      const created = await postFundraiserUpdate(fundraiser.id, { title: updateTitle || undefined, body: updateBody, media: [] }, token);
      setLocalUpdates((prev) => [created, ...prev]);
      setUpdateOpen(false);
      setUpdateTitle('');
      setUpdateBody('');
      toast.success('Update published');
      void load();
    } catch (reason: any) {
      setUpdateError(reason?.message || 'Could not post the update.');
    } finally {
      setBusy(false);
    }
  };

  const { raisedLabel, targetLabel, percentFunded, daysLeft } = useFundraiserStats(
    fundraiser || { targetAmount: 0, raisedAmount: 0, supporterCount: 0, currency: 'USD', deadline: null }
  );

  if (loading && !fundraiser) {
    return (
      <div className="page-container-narrow">
        <div className="h-24 animate-pulse rounded-2xl bg-white/[0.04]" />
        <div className="mt-4 h-40 animate-pulse rounded-2xl bg-white/[0.03]" />
      </div>
    );
  }

  if (error === 'not-found' || (!fundraiser && error)) {
    return (
      <div className="page-container-narrow flex min-h-[50vh] flex-col items-center justify-center text-center">
        <div className="grid h-16 w-16 place-items-center rounded-2xl border border-white/[0.07] bg-white/[0.03]">
          <AlertCircle size={26} className="text-white/30" />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-white">Fundraiser not found</h1>
        <Button variant="secondary" className="mt-5" onClick={() => router.push('/give/my')}>
          <ArrowLeft size={15} />
          Back to my fundraisers
        </Button>
      </div>
    );
  }

  if (!fundraiser) return null;

  const editable = ['DRAFT', 'MORE_INFORMATION_REQUIRED', 'REJECTED'].includes(fundraiser.status);
  const isLive = ['PUBLISHED', 'APPROVED', 'COMPLETED'].includes(fundraiser.status);
  const showInfoRequest = fundraiser.status === 'MORE_INFORMATION_REQUIRED' && fundraiser.infoRequestMessage;
  const showRejection = fundraiser.status === 'REJECTED' && fundraiser.rejectionReason;
  const showSuspension = fundraiser.status === 'SUSPENDED' && fundraiser.suspensionReason;

  const submitted = searchParams?.get('submitted') === '1';
return (
    <div className="page-container-narrow">
      <button
        type="button"
        onClick={() => router.push('/give/my')}
        className="mb-5 flex items-center gap-1.5 text-xs text-white/40 transition hover:text-white"
      >
        <ArrowLeft size={14} />
        My fundraisers
      </button>

      {submitted && (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-[var(--gold-border)] bg-[var(--gold-bg)] p-4">
          <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-[var(--vanta-gold-bright)]" />
          <div>
            <p className="text-sm font-semibold text-[var(--vanta-gold-bright)]">Submitted for review</p>
            <p className="mt-0.5 text-xs text-white/55">
              Status is now <span className="font-semibold text-white/80">UNDER REVIEW</span>. Our team reviews every fundraiser for safety and
              accuracy — you&apos;ll be notified as soon as it&apos;s approved.
            </p>
          </div>
        </div>
      )}

      {(showInfoRequest || showRejection || showSuspension) && (
        <div className={cn('mb-5 flex items-start gap-3 rounded-2xl border p-4', showSuspension ? 'border-red-500/20 bg-red-500/10' : 'border-amber-500/20 bg-amber-500/5')}>
          {showSuspension ? <ShieldAlert size={20} className="mt-0.5 shrink-0 text-red-300" /> : <AlertCircle size={20} className="mt-0.5 shrink-0 text-amber-300" />}
          <div>
            <p className="text-sm font-semibold text-white">
              {showSuspension ? 'This fundraiser has been suspended' : showRejection ? 'This fundraiser was not approved' : 'More information needed'}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-white/60">
              {showSuspension ? fundraiser.suspensionReason : showRejection ? fundraiser.rejectionReason : fundraiser.infoRequestMessage}
            </p>
            {(showInfoRequest || showRejection) && (
              <Link href={`/give/start?draft=${fundraiser.id}`} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[var(--vanta-gold)] px-3.5 py-2 text-xs font-semibold text-black transition hover:opacity-90">
                <Pencil size={13} />
                Edit and resubmit
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Header card */}
      <div className="mb-5 overflow-hidden rounded-2xl border border-white/[0.07] bg-[var(--vanta-surface)]">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide', statusStyles(fundraiser.status))}>
                <StatusDot status={fundraiser.status} />
                {fundraiser.status.replaceAll('_', ' ')}
              </span>
              {fundraiser.verified && <VantaVerifiedBadge variant="pill" size="xs" />}
            </div>
            <h1 className="mt-2 text-h3 text-white">{fundraiser.title}</h1>
            <p className="mt-1 text-xs text-white/40">
              {fundraiser.category?.emoji} {fundraiser.category?.name} · {fundraiser.country}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {isLive && (
              <Link href={`/give/${fundraiser.slug}`} className="btn-secondary min-h-10 px-4 text-xs">
                <Eye size={14} />
                View page
              </Link>
            )}
            {editable && (
              <Link href={`/give/start?draft=${fundraiser.id}`} className="btn-outline min-h-10 px-4 text-xs">
                <Pencil size={14} />
                Edit draft
              </Link>
            )}
            {['DRAFT', 'MORE_INFORMATION_REQUIRED', 'REJECTED'].includes(fundraiser.status) && (
              <button type="button" onClick={handleSubmit} disabled={busy} className="btn-gold min-h-10 px-4 text-xs">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Submit for review
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-px border-t border-white/[0.06] bg-white/[0.04] sm:grid-cols-4">
          <StatCell label="Raised" value={raisedLabel} />
          <StatCell label="Goal" value={targetLabel} />
          <StatCell label="Supporters" value={String(fundraiser.supporterCount)} />
          <StatCell label="Days left" value={daysLeft > 0 ? String(daysLeft) : '—'} />
        </div>

        <div className="px-5 py-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.07]">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.min(100, Math.max(2, percentFunded))}%`, background: percentFunded >= 100 ? 'var(--gradient-gold)' : 'var(--gradient-primary)' }}
            />
          </div>
          <p className="mt-1.5 text-xs text-white/40">{Math.round(percentFunded)}% funded</p>
        </div>
      </div>
<div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-5">
          {/* Updates */}
          <section className="rounded-2xl border border-white/[0.07] bg-[var(--vanta-surface)] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Updates</h2>
              {isLive && (
                <button type="button" onClick={() => setUpdateOpen(true)} className="btn-secondary min-h-9 px-3.5 text-xs">
                  <Pencil size={13} />
                  Post update
                </button>
              )}
            </div>

            {!isLive && (
              <p className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3 text-xs text-white/45">
                Updates become available once your fundraiser is live.
              </p>
            )}

            {(localUpdates.length > 0 || (fundraiser.updates && fundraiser.updates.length > 0)) && (
              <div className="space-y-3">
                {(localUpdates.length ? localUpdates : fundraiser.updates || []).map((update) => (
                  <article key={update.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--vanta-gold-bright)]">
                      UPDATE · {new Date(update.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                    </p>
                    {update.title && <p className="mt-1.5 text-sm font-semibold text-white">{update.title}</p>}
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-white/60">{update.body}</p>
                  </article>
                ))}
              </div>
            )}

            {!localUpdates.length && (!fundraiser.updates || fundraiser.updates.length === 0) && (
              <p className="text-sm text-white/35">No updates yet.</p>
            )}
          </section>

          {/* Evidence (private) */}
          <section className="rounded-2xl border border-white/[0.07] bg-[var(--vanta-surface)] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                <ShieldAlert size={15} className="text-[var(--vanta-gold-bright)]" />
                Evidence
              </h2>
              {editable && (
                <Link href={`/give/start?draft=${fundraiser.id}`} className="btn-secondary min-h-9 px-3.5 text-xs">
                  <Pencil size={13} />
                  Manage
                </Link>
              )}
            </div>
            {evidence.length === 0 ? (
              <p className="text-sm text-white/35">No supporting evidence uploaded yet.</p>
            ) : (
              <div className="space-y-2">
                {evidence.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5">
                    <FileText size={15} className="shrink-0 text-[var(--vanta-gold-bright)]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-white/75">{item.originalName}</p>
                      <p className="text-[11px] text-white/35">{(item.size / 1024 / 1024).toFixed(1)}MB · private</p>
                    </div>
                    <span className="rounded-full border border-[var(--gold-border)] bg-[var(--gold-bg)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--vanta-gold-bright)]">
                      Private
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Cancellation */}
          {['PUBLISHED', 'APPROVED'].includes(fundraiser.status) && (
            <section className="rounded-2xl border border-red-500/15 bg-red-500/[0.02] p-5">
              <h2 className="text-sm font-semibold text-white">Danger zone</h2>
              <p className="mt-1 text-xs text-white/40">
                Cancelling removes your fundraiser from public view and stops new donations. Previously received donations remain handled
                through your VANTA Wallet.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={handleCancel} disabled={busy} className="btn-destructive min-h-9 text-xs">
                  <Trash2 size={13} />
                  Cancel fundraiser
                </button>
              </div>
            </section>
          )}

          {editable && (
            <section className="rounded-2xl border border-white/[0.07] bg-[var(--vanta-surface)] p-5">
              <h2 className="text-sm font-semibold text-white">Delete draft</h2>
              <p className="mt-1 text-xs text-white/40">Remove this draft permanently. This cannot be undone.</p>
              <button type="button" onClick={handleDelete} disabled={busy} className="btn-destructive mt-3 min-h-9 text-xs">
                <Trash2 size={13} />
                Delete draft
              </button>
            </section>
          )}
        </div>
{/* Sidebar */}
        <aside className="space-y-5">
          <div className="rounded-2xl border border-white/[0.07] bg-[var(--vanta-surface)] p-5">
            <h2 className="text-sm font-semibold text-white">Key information</h2>
            <dl className="mt-3 space-y-2.5 text-sm">
              <KeyInfo label="Deadline" value={fundraiser.deadline ? new Date(fundraiser.deadline).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'} />
              <KeyInfo label="Beneficiary" value={fundraiser.beneficiaryName || '—'} />
              <KeyInfo label="Payout method" value={payoutLabel(fundraiser.payoutMethod)} />
              <KeyInfo label="Submitted" value={fundraiser.submittedAt ? new Date(fundraiser.submittedAt).toLocaleDateString() : 'Not yet'} />
            </dl>
          </div>

          <div className="rounded-2xl border border-white/[0.07] bg-[var(--vanta-surface)] p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Clock size={15} className="text-white/50" />
              Activity
            </h2>
            {auditLogs.length === 0 ? (
              <p className="mt-3 text-xs text-white/35">No activity recorded yet.</p>
            ) : (
              <ol className="relative mt-4 space-y-4 border-l border-white/[0.08] pl-4">
                {[...auditLogs].reverse().map((log) => (
                  <li key={log.id} className="relative">
                    <span className={cn('absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-[var(--vanta-surface)]', auditDot(log.action))} />
                    <p className="text-xs font-semibold text-white/75">{auditLabel(log.action)}</p>
                    <p className="mt-0.5 text-[11px] text-white/35">{new Date(log.createdAt).toLocaleString()}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </aside>
      </div>

      {/* Post update modal */}
      <Modal open={updateOpen} onClose={() => setUpdateOpen(false)} title="Post an update" description="Keep supporters informed." size="md">
        <div className="space-y-4">
          <div>
            <p className="form-label">Title (optional)</p>
            <input value={updateTitle} onChange={(e) => setUpdateTitle(e.target.value)} maxLength={140} placeholder="e.g. Surgery completed successfully" className="form-input" />
          </div>
          <div>
            <p className="form-label">Update</p>
            <textarea value={updateBody} onChange={(e) => setUpdateBody(e.target.value)} rows={5} placeholder="Share progress or a thank-you to supporters…" className="form-textarea" />
          </div>
          {updateError && (
            <p className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-300" role="alert">
              <AlertCircle size={14} className="shrink-0" />
              {updateError}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setUpdateOpen(false)}>
              Cancel
            </Button>
            <Button variant="gold" onClick={handlePostUpdate} disabled={busy}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              Publish update
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--vanta-surface)] px-5 py-3">
      <p className="text-[10px] uppercase tracking-[0.08em] text-white/35">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-white">{value}</p>
    </div>
  );
}

function KeyInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs text-white/40">{label}</dt>
      <dd className="min-w-0 truncate text-xs font-semibold text-white/80">{value}</dd>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'h-1.5 w-1.5 rounded-full',
        status === 'PUBLISHED' ? 'bg-emerald-400' : status === 'UNDER_REVIEW' ? 'bg-amber-400' : status === 'SUSPENDED' || status === 'REJECTED' ? 'bg-red-400' : 'bg-white/40'
      )}
    />
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

function auditDot(action: string): string {
  if (['SUBMITTED', 'APPROVED', 'PUBLISHED', 'VERIFIED'].includes(action)) return 'bg-amber-400';
  if (['CANCELLED', 'REJECTED', 'SUSPENDED'].includes(action)) return 'bg-red-400';
  return 'bg-white/30';
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