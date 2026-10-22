'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  fetchAdminHomes,
  reviewAdminHomeListing,
  fetchAdminHomeVerifications,
  decideHomeVerification,
  fetchAdminHomeReports,
  resolveHomeReport,
  fetchAdminHomeAuditLogs,
} from '@/lib/services';
import { useAuth } from '@/context/AuthContext';
import ConsolePanel from '@/components/console/Panel';
import { ConsoleEmptyState, ConsoleLoading } from '@/components/console/States';
import { RefreshCw, Search, Home, ShieldCheck, Flag, ScrollText, Check, X } from 'lucide-react';

type Tab = 'listings' | 'verifications' | 'reports' | 'audit';

const tabs: { id: Tab; label: string; icon: React.ComponentType<any> }[] = [
  { id: 'listings', label: 'Listings', icon: Home },
  { id: 'verifications', label: 'Verification', icon: ShieldCheck },
  { id: 'reports', label: 'Reports', icon: Flag },
  { id: 'audit', label: 'Audit history', icon: ScrollText },
];

const dateLabel = (value?: string) => value ? new Date(value).toLocaleDateString() : '—';
const statusClass = (status?: string) => {
  if (status === 'PUBLISHED' || status === 'VERIFIED' || status === 'RESOLVED') return 'text-emerald-300 bg-emerald-400/10 border-emerald-400/20';
  if (status === 'PENDING_REVIEW' || status === 'PENDING' || status === 'REVIEWING') return 'text-amber-300 bg-amber-400/10 border-amber-400/20';
  if (status === 'REJECTED' || status === 'DISMISSED') return 'text-red-300 bg-red-400/10 border-red-400/20';
  return 'text-console-text-2 bg-white/[0.04] border-console-border';
};

function Status({ value }: { value?: string }) {
  return <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold tracking-wide ${statusClass(value)}`}>{value || 'UNKNOWN'}</span>;
}

export default function AdminHomesPage() {
  const { token } = useAuth();
  const [tab, setTab] = useState<Tab>('listings');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('PENDING_REVIEW');
  const [listings, setListings] = useState<any[]>([]);
  const [verifications, setVerifications] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    const results = await Promise.allSettled([
      fetchAdminHomes({ limit: 50, search: search.trim() || undefined, status: status === 'ALL' ? undefined : status }, token),
      fetchAdminHomeVerifications({ limit: 50 }, token),
      fetchAdminHomeReports({ limit: 50 }, token),
      fetchAdminHomeAuditLogs({ limit: 50 }, token),
    ]);
    const failures: string[] = [];
    const [listingResult, verificationResult, reportResult, auditResult] = results;
    if (listingResult.status === 'fulfilled') setListings(Array.isArray(listingResult.value?.data) ? listingResult.value.data : []);
    else failures.push('listings');
    if (verificationResult.status === 'fulfilled') setVerifications(Array.isArray(verificationResult.value?.data) ? verificationResult.value.data : []);
    else failures.push('verification requests');
    if (reportResult.status === 'fulfilled') setReports(Array.isArray(reportResult.value?.data) ? reportResult.value.data : []);
    else failures.push('reports');
    if (auditResult.status === 'fulfilled') setAudit(Array.isArray(auditResult.value?.data) ? auditResult.value.data : []);
    else failures.push('audit history');
    if (failures.length) setError(`Could not load ${failures.join(', ')}. Check admin permissions or retry.`);
    setLoading(false);
  }, [token, search, status]);

  useEffect(() => { void load(); }, [load]);

  const act = async (id: string, action: () => Promise<any>) => {
    setBusyId(id);
    setError('');
    try {
      await action();
      await load();
    } catch (e: any) {
      setError(e?.message || 'The moderation action failed. Please retry.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="min-h-dvh bg-console-bg px-4 py-5 text-console-text sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-console-gold">VANTA Admin · Marketplace</p>
            <h1 className="mt-1 text-2xl font-semibold">Homes management</h1>
            <p className="mt-1 text-sm text-console-text-3">Review property listings, landlord and agent verification, reports, and moderation history.</p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="vc-focus inline-flex min-h-10 items-center gap-2 rounded-[var(--vc-radius)] border border-console-border-strong px-3 text-sm font-medium hover:bg-white/[0.04] disabled:opacity-50">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </header>

        <div className="flex flex-wrap gap-2 border-b border-console-border pb-3" role="tablist" aria-label="Homes administration sections">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`vc-focus inline-flex min-h-10 items-center gap-2 rounded-[var(--vc-radius)] px-3 text-sm ${tab === id ? 'bg-console-gold text-console-gold-fg font-semibold' : 'border border-console-border text-console-text-2 hover:bg-white/[0.04]'}`}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>

        {error && <div role="alert" className="rounded-lg border border-red-400/20 bg-red-400/5 p-3 text-sm text-red-300">{error}</div>}

        {tab === 'listings' && (
          <ConsolePanel title="Property listings" description="Only authorized admins can approve or reject pending listings." actions={<span className="text-xs text-console-text-3">{listings.length} shown</span>}>
            <div className="mb-4 flex flex-col gap-2 sm:flex-row">
              <label className="relative min-w-0 flex-1">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-console-text-3" />
                <input aria-label="Search listings" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, owner, location or ID" className="vc-focus min-h-10 w-full rounded-[var(--vc-radius)] border border-console-border bg-white/[0.03] pl-9 pr-3 text-sm text-console-text placeholder:text-console-text-3" />
              </label>
              <select aria-label="Filter listing status" value={status} onChange={(e) => setStatus(e.target.value)} className="vc-focus min-h-10 rounded-[var(--vc-radius)] border border-console-border bg-console-bg px-3 text-sm">
                <option value="PENDING_REVIEW">Pending review</option><option value="PUBLISHED">Published</option><option value="REJECTED">Rejected</option><option value="PAUSED">Paused</option><option value="RENTED">Rented</option><option value="ARCHIVED">Archived</option><option value="ALL">All statuses</option>
              </select>
            </div>
            {loading ? <ConsoleLoading label="Loading listings…" /> : listings.length === 0 ? <ConsoleEmptyState title="No listings found" description="Try another status or search term." /> : (
              <div className="divide-y divide-console-border">
                {listings.map((listing) => (
                  <article key={listing.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">{listing.title || 'Untitled listing'}</h3><Status value={listing.availabilityStatus} /></div>
                      <p className="mt-1 text-xs text-console-text-3">{[listing.city, listing.area, listing.country].filter(Boolean).join(', ') || 'Location not provided'} · {listing.propertyType || 'Property'} · {listing.currency || 'NGN'} {Number(listing.rentAmount || 0).toLocaleString()} / {String(listing.rentPeriod || '').toLowerCase()}</p>
                      <p className="mt-1 text-xs text-console-text-3">Owner: @{listing.owner?.username || 'unknown'} · ID: {listing.id} · Submitted: {dateLabel(listing.updatedAt)}</p>
                      {listing.description && <p className="mt-2 max-w-3xl whitespace-pre-wrap text-sm text-console-text-2">{String(listing.description).slice(0, 320)}{String(listing.description).length > 320 ? '…' : ''}</p>}
                    </div>
                    {listing.availabilityStatus === 'PENDING_REVIEW' && (
                      <div className="flex shrink-0 gap-2">
                        <button type="button" disabled={!!busyId} onClick={() => void act(listing.id, () => reviewAdminHomeListing(listing.id, { decision: 'APPROVE', reason: 'Approved in Homes admin review.' }, token))} className="vc-focus inline-flex min-h-9 items-center gap-1 rounded-[var(--vc-radius)] bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-300 disabled:opacity-50"><Check size={14} /> Approve</button>
                        <button type="button" disabled={!!busyId} onClick={() => void act(listing.id, () => reviewAdminHomeListing(listing.id, { decision: 'REJECT', reason: 'Rejected in Homes admin review.' }, token))} className="vc-focus inline-flex min-h-9 items-center gap-1 rounded-[var(--vc-radius)] bg-red-500/10 px-3 text-xs font-semibold text-red-300 disabled:opacity-50"><X size={14} /> Reject</button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </ConsolePanel>
        )}

        {tab === 'verifications' && (
          <ConsolePanel title="Landlord and agent verification" description="Private identity and authorization documents are not displayed in this list. Open them only through an authorized review workflow.">
            {loading ? <ConsoleLoading label="Loading verification requests…" /> : verifications.length === 0 ? <ConsoleEmptyState title="No verification requests" description="Submitted landlord and agent requests will appear here." /> : (
              <div className="divide-y divide-console-border">
                {verifications.map((item) => (
                  <article key={item.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                    <div><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">@{item.user?.username || 'unknown user'}</h3><Status value={item.status} /></div><p className="mt-1 text-xs text-console-text-3">{item.type || 'Applicant'} · Submitted {dateLabel(item.createdAt)} · {item.user?.fullName || item.user?.email || item.userId}</p><p className="mt-1 text-xs text-console-text-3">Request ID: {item.id}</p></div>
                    {item.status === 'PENDING_REVIEW' && <div className="flex gap-2"><button type="button" disabled={!!busyId} onClick={() => void act(item.id, () => decideHomeVerification(item.id, { decision: 'APPROVE', reason: 'Approved in Homes admin review.' }, token))} className="vc-focus min-h-9 rounded-[var(--vc-radius)] bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-300 disabled:opacity-50">Approve</button><button type="button" disabled={!!busyId} onClick={() => void act(item.id, () => decideHomeVerification(item.id, { decision: 'REJECT', reason: 'Rejected in Homes admin review.' }, token))} className="vc-focus min-h-9 rounded-[var(--vc-radius)] bg-red-500/10 px-3 text-xs font-semibold text-red-300 disabled:opacity-50">Reject</button></div>}
                  </article>
                ))}
              </div>
            )}
          </ConsolePanel>
        )}

        {tab === 'reports' && (
          <ConsolePanel title="Property reports" description="Review user reports and record a resolution in the audit log.">
            {loading ? <ConsoleLoading label="Loading reports…" /> : reports.length === 0 ? <ConsoleEmptyState title="No reports" description="New reports about property listings will appear here." /> : (
              <div className="divide-y divide-console-border">
                {reports.map((report) => (
                  <article key={report.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
                    <div><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">{report.type || 'Property report'}</h3><Status value={report.status} /></div><p className="mt-1 text-sm text-console-text-2">{report.reason || report.description || 'No additional details supplied.'}</p><p className="mt-1 text-xs text-console-text-3">Listing: {report.listing?.title || report.listingId} · Reporter: @{report.reporter?.username || 'unknown'} · {dateLabel(report.createdAt)}</p><p className="mt-1 text-xs text-console-text-3">Report ID: {report.id}</p></div>
                    {(report.status === 'PENDING' || report.status === 'REVIEWING') && <div className="flex shrink-0 gap-2"><button type="button" disabled={!!busyId} onClick={() => void act(report.id, () => resolveHomeReport(report.id, { decision: 'RESOLVED', notes: 'Resolved in Homes admin review.' }, token))} className="vc-focus min-h-9 rounded-[var(--vc-radius)] bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-300 disabled:opacity-50">Resolve</button><button type="button" disabled={!!busyId} onClick={() => void act(report.id, () => resolveHomeReport(report.id, { decision: 'DISMISSED', notes: 'Dismissed in Homes admin review.' }, token))} className="vc-focus min-h-9 rounded-[var(--vc-radius)] border border-console-border px-3 text-xs font-semibold text-console-text-2 disabled:opacity-50">Dismiss</button></div>}
                  </article>
                ))}
              </div>
            )}
          </ConsolePanel>
        )}

        {tab === 'audit' && (
          <ConsolePanel title="Homes audit history" description="Recent administrative and marketplace events recorded by the backend.">
            {loading ? <ConsoleLoading label="Loading audit history…" /> : audit.length === 0 ? <ConsoleEmptyState title="No audit entries" description="Homes audit events will appear here as actions are recorded." /> : (
              <div className="divide-y divide-console-border">
                {audit.map((entry) => <article key={entry.id} className="py-3 first:pt-0 last:pb-0"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{entry.action || 'Homes event'}</p><span className="text-xs text-console-text-3">{dateLabel(entry.createdAt)}</span></div><p className="mt-1 text-xs text-console-text-3">Actor: @{entry.actor?.username || entry.actorId || 'system'} · Listing: {entry.listing?.title || entry.listingId || '—'} · Event ID: {entry.id}</p></article>)}
              </div>
            )}
          </ConsolePanel>
        )}
      </div>
    </div>
  );
}
