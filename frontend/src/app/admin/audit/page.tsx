"use client";

import { useState, useMemo, useEffect, Fragment } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ScrollText, Search, Filter, Download, Shield, ChevronDown,
  ChevronRight, Clock, Globe, Monitor, Eye, EyeOff
} from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import Button from '@/components/ui/Button';
import { getAuditLogs } from '@/lib/adminApi';
import type { AuditLog } from '@/types/admin';

export default function AuditPage() {
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) return;
        const data = await getAuditLogs(token);
        setLogs(data);
      } catch (err) {
        console.error('Failed to fetch audit logs:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const filtered = useMemo(() => {
    return logs.filter(log => {
      if (actionFilter !== 'all' && log.action !== actionFilter) return false;
      if (search && !log.adminName.toLowerCase().includes(search.toLowerCase()) && !log.action.toLowerCase().includes(search.toLowerCase()) && !log.resource.includes(search)) return false;
      return true;
    });
  }, [search, actionFilter, logs]);

  const actions = [...new Set(logs.map(l => l.action))];

  return (
    <div className="space-y-6">
      <div className="flex flex-col   justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ScrollText size={14} className="text-[#d6a83f]" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold">Audit</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Audit Logs</h1>
          <p className="text-sm text-gray-400 mt-1">Immutable record of all administrative actions. Logs cannot be modified or deleted.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" icon={<Download size={14} />}>Export Logs</Button>
          <button onClick={() => setShowJson(!showJson)} className={`p-2 rounded-xl transition-colors ${showJson ? 'bg-[#151517]0/20 text-[#f2c75c]' : 'bg-white/5 text-gray-500'}`}>
            {showJson ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
        </div>
      </div>

      {/* Immutable Notice */}
      <div className="glass rounded-[20px] p-4 border border-yellow-500/20 bg-yellow-500/5">
        <div className="flex items-center gap-3">
          <Shield size={18} className="text-yellow-400 shrink-0" />
          <div>
            <p className="text-sm font-medium text-yellow-300">Immutable Audit Trail</p>
            <p className="text-xs text-gray-400 mt-0.5">All admin actions are permanently logged. Audit logs are cryptographically sealed and cannot be modified, deleted, or tampered with.</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <GlassCard>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-white/5 rounded-2xl px-3 py-1.5 border border-white/[0.06] flex-1 min-w-[200px]">
            <Search size={14} className="text-gray-500" />
            <input type="text" placeholder="Search logs..." value={search} onChange={e => setSearch(e.target.value)}
              className="bg-transparent border-none outline-none text-sm text-white placeholder-gray-500 w-full" />
          </div>
          <select value={actionFilter} onChange={e => setActionFilter(e.target.value)}
            className="glass rounded-2xl px-3 py-1.5 text-sm text-white border border-white/[0.06] outline-none bg-transparent">
            <option value="all">All Actions</option>
            {actions.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
          </select>
          <span className="text-xs text-gray-500">{filtered.length} entries</span>
        </div>
      </GlassCard>

      {/* Logs Table */}
      <GlassCard>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-[11px] uppercase tracking-wider border-b border-white/[0.06]">
                <th className="text-left py-3 px-2 font-medium">Timestamp</th>
                <th className="text-left py-3 px-2 font-medium">Admin</th>
                <th className="text-left py-3 px-2 font-medium">Action</th>
                <th className="text-left py-3 px-2 font-medium">Resource</th>
                <th className="text-left py-3 px-2 font-medium">ID</th>
                <th className="text-left py-3 px-2 font-medium hidden ">IP</th>
                <th className="text-left py-3 px-2 font-medium hidden ">Device</th>
                <th className="text-center py-3 px-2 font-medium">Changes</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((log, i) => (
                <Fragment key={log.id}>
                  <motion.tr
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                    className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors cursor-pointer"
                    onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                  >
                    <td className="py-3 px-2 text-gray-400 text-xs whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</td>
                    <td className="py-3 px-2 text-white font-medium">{log.adminName}</td>
                    <td className="py-3 px-2">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#151517]0/15 text-[#f2c75c] font-medium">{log.action.replace(/_/g, ' ')}</span>
                    </td>
                    <td className="py-3 px-2 text-gray-300 capitalize">{log.resource}</td>
                    <td className="py-3 px-2 text-gray-500 text-xs font-mono">{log.resourceId}</td>
                    <td className="py-3 px-2 text-gray-500 text-xs hidden ">{log.ip}</td>
                    <td className="py-3 px-2 text-gray-500 text-xs hidden ">{log.device}</td>
                    <td className="py-3 px-2 text-center">
                      {expandedId === log.id ? <ChevronDown size={14} className="text-[#d6a83f] mx-auto" /> : <ChevronRight size={14} className="text-gray-500 mx-auto" />}
                    </td>
                  </motion.tr>
                  {expandedId === log.id && (
                    <tr key={`${log.id}-detail`}>
                      <td colSpan={8} className="py-4 px-6 bg-white/[0.01]">
                        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
                          <div className="grid grid-cols-1  gap-4">
                            <div>
                              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Previous Value</p>
                              <pre className="text-xs text-gray-400 bg-black/30 rounded-xl p-3 overflow-x-auto">
                                {JSON.stringify(log.previousValue, null, 2) || 'N/A'}
                              </pre>
                            </div>
                            <div>
                              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">New Value</p>
                              <pre className="text-xs text-green-400 bg-black/30 rounded-xl p-3 overflow-x-auto">
                                {JSON.stringify(log.newValue, null, 2) || 'N/A'}
                              </pre>
                            </div>
                          </div>
                          {showJson && (
                            <div className="mt-4">
                              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Full Log Entry</p>
                              <pre className="text-xs text-gray-400 bg-black/30 rounded-xl p-3 overflow-x-auto">{JSON.stringify(log, null, 2)}</pre>
                            </div>
                          )}
                        </motion.div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  );
}

