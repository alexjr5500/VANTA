"use client";

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { Shield, Smartphone, Laptop, Globe, Clock, CheckCircle, XCircle, AlertCircle, RefreshCw, ChevronRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/apiClient';

// ============================================================================
// CREATOR SECURITY — real active sessions + security logs from the existing
// settings backend. 2FA state comes from the authenticated user session.
// ============================================================================

interface Session {
  id: string;
  device?: string | null;
  platform?: string | null;
  browser?: string | null;
  ip?: string | null;
  location?: string | null;
  lastActiveAt?: string | null;
  isCurrent?: boolean;
}

export default function SecurityPage() {
  const { token, user } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [sessionRes, logsRes] = await Promise.all([
        apiGet<{ sessions: Session[] }>('/api/settings/sessions', token, { skipCache: true }).catch(() => ({ sessions: [] })),
        apiGet<{ logs: any[] }>('/api/settings/security-logs', token, { skipCache: true }).catch(() => ({ logs: [] })),
      ]);
      setSessions(Array.isArray(sessionRes?.sessions) ? sessionRes.sessions : []);
      setLogs(Array.isArray(logsRes?.logs) ? logsRes.logs : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load security data.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="w-full space-y-3">
        <div className="skeleton h-28 rounded-3xl" />
        {[1, 2].map((i) => <div key={i} className="skeleton h-44 rounded-2xl" />)}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex w-full flex-col items-center py-14 text-center">
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-red-500/20 bg-red-500/10">
          <AlertCircle size={22} className="text-red-400" />
        </div>
        <h2 className="text-base font-semibold text-white/80">Couldn&apos;t load security</h2>
        <p className="mt-1 mb-5 max-w-sm text-sm text-white/40">{error}</p>
        <button onClick={() => void fetchData()} className="btn-primary text-sm"><RefreshCw size={14} className="mr-1.5 inline" /> Try again</button>
      </div>
    );
  }

return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full space-y-5 pb-8">
      {/* 2FA status card */}
      <section className="flex items-center justify-between gap-3 rounded-3xl border border-white/[0.06] bg-white/[0.02] p-5">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[var(--active-soft)] text-[var(--active)]"><Shield size={20} /></span>
          <div>
            <p className="text-sm font-bold text-white">Two-Factor Authentication</p>
            <p className="mt-0.5 text-xs text-white/45">Add an extra layer of security to your account.</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {user?.twoFactorEnabled ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400"><CheckCircle size={13} /> Enabled</span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-white/40"><XCircle size={13} /> Disabled</span>
          )}
          <Link href="/settings/security" className="inline-flex items-center gap-1 rounded-xl border border-white/[0.08] px-3 py-2 text-xs text-white/70 hover:bg-white/[0.04] hover:text-white">
            Manage <ChevronRight size={12} />
          </Link>
        </div>
      </section>

      {/* Active sessions */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.02] p-5">
        <div className="mb-3 flex items-center gap-2">
          <Globe size={15} className="text-white/40" />
          <h3 className="text-sm font-bold text-white">Active sessions</h3>
          <span className="ml-auto rounded-full border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 text-[10px] text-white/40">{sessions.length}</span>
        </div>
        {sessions.length > 0 ? (
          <div className="space-y-2">
            {sessions.slice(0, 6).map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.02] px-3.5 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-white/50">
                    {String(s.device || '').toLowerCase().includes('phone') ? <Smartphone size={15} /> : <Laptop size={15} />}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white/85">{s.device || s.browser || 'Device'}</p>
                    <p className="truncate text-[10px] text-white/35">{[s.location, s.ip].filter(Boolean).join(' · ') || 'Unknown location'}{s.lastActiveAt ? ` · ${new Date(s.lastActiveAt).toLocaleString()}` : ''}</p>
                  </div>
                </div>
                {s.isCurrent && <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-semibold uppercase text-emerald-400">Current</span>}
              </div>
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-white/40">No active sessions found.</p>
        )}
      </section>

      {/* Security logs */}
      {logs.length > 0 && (
        <section className="rounded-3xl border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="mb-3 flex items-center gap-2">
            <Clock size={15} className="text-white/40" />
            <h3 className="text-sm font-bold text-white">Recent security activity</h3>
          </div>
          <div className="space-y-1.5">
            {logs.slice(0, 8).map((log: any) => (
              <div key={log.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.02] px-3.5 py-2.5">
                <p className="min-w-0 truncate text-sm text-white/75">{log.action || log.event || 'Security event'}</p>
                <span className="shrink-0 text-[10px] text-white/35">{new Date(log.createdAt || log.timestamp).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </motion.div>
  );
}
