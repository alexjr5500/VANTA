'use client';

import { useState, useCallback, useEffect, Fragment } from 'react';
import {
  ScrollText, Search, Shield, ChevronDown, ChevronRight,
  Clock, RefreshCw, AlertTriangle, ChevronLeft,
} from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import Button from '@/components/ui/Button';
import { getAuditLogs, type AuditLog } from '@/lib/adminApi';

export default function AuditPage() {
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('vanta_token') || localStorage.getItem('token');
      if (!token) return;
      const data = await getAuditLogs(token, {
        action: actionFilter === 'all' ? undefined : actionFilter,
        page,
        limit: 40,
      });
      setLogs(data.logs || []);
      setTotal(data.total || 0);
      setPages(Math.max(1, Math.ceil((data.total || 0) / 40)));
    } catch (err: any) {
      setError(err?.message || 'Failed to load audit logs.');
    } finally {
      setLoading(false);
    }
  }, [actionFilter, page]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const actions = [...new Set(logs.map((l) => l.action))];

  const filtered = useFilteredLogs(logs, search);

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ScrollText size={14} className="text-[#d9a83f]" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold">Audit</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Audit Logs</h1>
          <p className="text-sm text-gray-400 mt-1">Append-only record of security-sensitive and administrative actions.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-[11px] text-gray-500 bg-white/5 px-3 py-1.5 rounded-full">
            <Clock size={12} /> {total.toLocaleString()} entries
          </span>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => void fetchData()}>Refresh</Button>
        </div>
      </div>

      {/* Notice */}
      <div className="glass rounded-2xl p-4 border border-yellow-500/20 bg-yellow-500/5">
        <div className="flex items-center gap-3">
          <Shield size={18} className="text-yellow-400 shrink-0" />
          <p className="text-xs text-gray-300">Administrative actions are recorded in the security log. Entries are append-only and include the acting admin, action, target, timestamp and metadata.</p>
        </div>
      </div>

      {/* Filters */}
      <GlassCard>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-white/5 rounded-xl px-3 py-2 border border-white/[0.06] flex-1 min-w-[200px]">
            <Search size={14} className="text-gray-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search actions or admins..."
              className="w-full bg-transparent border-none outline-none text-sm text-white placeholder-gray-500"
            />
          </div>
          <select value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(1); }} className="glass rounded-xl px-3 py-2 text-sm text-white border border-white/[0.06] outline-none">
            <option value="all">All actions</option>
            {actions.map((a) => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
      </GlassCard>
{/* Table */}
      <GlassCard>
        {loading ? (
          <div className="space-y-2 p-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 rounded-xl bg-white/5 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="py-10 text-center">
            <AlertTriangle size={32} className="mx-auto mb-3 text-red-400" />
            <p className="text-sm text-gray-400">{error}</p>
            <Button variant="primary" size="sm" className="mt-3" onClick={() => void fetchData()}>Retry</Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-gray-500 text-[11px] uppercase tracking-wider border-b border-white/[0.06]">
                  <th className="text-left py-3 px-2 font-medium">Timestamp</th>
                  <th className="text-left py-3 px-2 font-medium">Admin</th>
                  <th className="text-left py-3 px-2 font-medium">Action</th>
                  <th className="text-left py-3 px-2 font-medium">Resource</th>
                  <th className="text-left py-3 px-2 font-medium hidden md:table-cell">ID</th>
                  <th className="text-left py-3 px-2 font-medium hidden lg:table-cell">IP</th>
                  <th className="text-center py-3 px-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} className="py-12 text-center">
                    <ScrollText size={34} className="mx-auto mb-3 text-white/15" />
                    <p className="text-sm text-white/50">No audit log entries match your filters.</p>
                  </td></tr>
                ) : (
                  filtered.map((log) => (
                    <Fragment key={log.id}>
                      <tr className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors cursor-pointer" onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}>
                        <td className="py-3 px-2 text-gray-400 text-xs whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</td>
                        <td className="py-3 px-2 text-white font-medium text-xs">{log.adminName}</td>
                        <td className="py-3 px-2">
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#d9a83f]/15 text-[#d9a83f] font-medium">{log.action.replace(/_/g, ' ')}</span>
                        </td>
                        <td className="py-3 px-2 text-gray-300 text-xs capitalize">{log.resource}</td>
                        <td className="py-3 px-2 text-gray-500 text-xs font-mono hidden md:table-cell">{log.resourceId ? (log.resourceId.length > 14 ? log.resourceId.slice(0, 14) + '…' : log.resourceId) : '—'}</td>
                        <td className="py-3 px-2 text-gray-500 text-xs hidden lg:table-cell">{log.ip || '—'}</td>
                        <td className="py-3 px-2 text-center">
                          {expandedId === log.id ? <ChevronDown size={14} className="text-[#d9a83f] mx-auto" /> : <ChevronRight size={14} className="text-gray-500 mx-auto" />}
                        </td>
                      </tr>
                      {expandedId === log.id && (
                        <tr>
                          <td colSpan={7} className="py-4 px-6 bg-white/[0.01]">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Metadata</p>
                                <pre className="text-xs text-gray-400 bg-black/30 rounded-xl p-3 overflow-x-auto whitespace-pre-wrap">
                                  {log.metadata ? JSON.stringify(log.metadata, null, 2) : 'N/A'}
                                </pre>
                              </div>
                              <div className="space-y-3">
                                <div>
                                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Device</p>
                                  <p className="text-xs text-gray-400 break-all">{log.device || 'N/A'}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Entry ID</p>
                                  <p className="text-xs text-gray-500 font-mono break-all">{log.id}</p>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* Pagination */}
      {pages > 1 && !loading && !error && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="ghost" size="sm" disabled={page <= 1} icon={<ChevronLeft size={14} />} onClick={() => setPage(page - 1)}>Prev</Button>
          <span className="text-xs text-gray-400 px-2">{page} / {pages}</span>
          <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}

function useFilteredLogs(logs: AuditLog[], search: string) {
  if (!search) return logs;
  const q = search.toLowerCase();
  return logs.filter((l) =>
    (l.adminName || '').toLowerCase().includes(q) ||
    (l.action || '').toLowerCase().includes(q) ||
    (l.resource || '').toLowerCase().includes(q)
  );
}