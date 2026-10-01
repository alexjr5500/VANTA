'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPost } from '@/lib/apiClient';
import {
  ShieldCheck, Crown, Check, X, Clock, Loader2, Search,
  Users, BadgeCheck, Ban, AlertCircle, ChevronRight, Eye,
  Filter, RefreshCw, UserCheck, UserX, DollarSign, Calendar, History
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Button from '@/components/ui/Button';

interface AdminBadge {
  id: string;
  userId: string;
  badgeType: string;
  status: string;
  grantedAt: string;
  expiresAt: string | null;
  user: { id: string; username: string; fullName: string; email: string; avatar: string | null };
}

interface AdminMembership {
  id: string;
  userId: string;
  status: string;
  startDate: string;
  endDate: string;
  plan: { id: string; name: string; price: number; durationMonths: number };
  user: { id: string; username: string; fullName: string; email: string; avatar: string | null };
}

interface AdminRequest {
  id: string;
  userId: string;
  requestType: string;
  status: string;
  createdAt: string;
  user: { id: string; username: string; fullName: string; email: string; avatar: string | null };
}

interface AdminPurchase {
  id: string;
  userId: string;
  planId: string;
  amount: number;
  currency: string;
  network: string | null;
  status: string;
  providerOrderId: string | null;
  providerReference: string | null;
  paymentMode: string | null;
  expiresAt: string;
  confirmedAt: string | null;
  refundedAt: string | null;
  refundReason: string | null;
  createdAt: string;
  user: { id: string; username: string; email: string; fullName: string };
  plan: { id: string; name: string; badgeType: string; durationMonths: number };
}

type Tab = 'requests' | 'badges' | 'memberships' | 'plans' | 'purchases';

export default function AdminVerificationPage() {
  const { user, token } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('requests');
  const [requests, setRequests] = useState<AdminRequest[]>([]);
  const [badges, setBadges] = useState<AdminBadge[]>([]);
  const [memberships, setMemberships] = useState<AdminMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [purchases, setPurchases] = useState<AdminPurchase[]>([]);
  const [plans, setPlans] = useState<any[]>([]);

  useEffect(() => {
    if (token) loadData();
  }, [token, activeTab]);

  const loadData = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      if (activeTab === 'requests') {
        const data = await apiGet<AdminRequest[]>('/api/verification/admin/requests', token);
        setRequests(data);
      } else if (activeTab === 'badges') {
        const data = await apiGet<AdminBadge[]>('/api/verification/admin/badges', token);
        setBadges(data);
      } else if (activeTab === 'memberships') {
        const data = await apiGet<AdminMembership[]>('/api/verification/admin/memberships', token);
        setMemberships(data);
      } else if (activeTab === 'purchases') {
        const data = await apiGet<{ purchases: AdminPurchase[]; total: number }>(
          '/api/verification/admin/purchases?limit=100',
          token
        );
        setPurchases(data.purchases || []);
      } else if (activeTab === 'plans') {
        const data = await apiGet<any[]>('/api/verification/plans', token);
        setPlans(Array.isArray(data) ? data : []);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (action: string, body: any) => {
    if (!token) return;
    setActionLoading(`${action}-${body.userId}`);
    setError(null);
    setSuccess(null);
    try {
      await apiPost(`/api/verification/admin/${action}`, body, token);
      setSuccess('Action completed successfully!');
      loadData();
    } catch (err: any) {
      setError(err.message || 'Action failed');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRefund = async (purchaseId: string) => {
    if (!token) return;
    const reason = prompt('Refund reason:');
    if (!reason) return;
    setActionLoading(`refund-${purchaseId}`);
    setError(null);
    setSuccess(null);
    try {
      await apiPost(`/api/verification/admin/purchases/${purchaseId}/refund`, { reason }, token);
      setSuccess('Purchase refunded. If it sourced an active badge, the badge was revoked.');
      loadData();
    } catch (err: any) {
      setError(err.message || 'Refund failed');
    } finally {
      setActionLoading(null);
    }
  };

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: 'requests', label: 'Verification Requests', icon: UserCheck },
    { id: 'badges', label: 'Badges', icon: ShieldCheck },
    { id: 'memberships', label: 'Memberships', icon: Crown },
    { id: 'purchases', label: 'Purchases', icon: History },
    { id: 'plans', label: 'Plans', icon: DollarSign },
  ];

  const filteredBadges = badges.filter(b =>
    b.user.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    b.user.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredMemberships = memberships.filter(m =>
    m.user.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.user.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between mb-8"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#151517]0 to-[#c8c8cc] flex items-center justify-center shadow-lg">
              <ShieldCheck size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Verification Management</h1>
              <p className="text-sm text-gray-400">Administer badges, memberships, and verification requests</p>
            </div>
          </div>
          <button
            onClick={loadData}
            className="p-2 rounded-xl hover:bg-white/5 text-gray-400 transition-colors"
          >
            <RefreshCw size={18} />
          </button>
        </motion.div>

        {/* Error / Success */}
        {error && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
            <AlertCircle size={14} /> {error}
          </motion.div>
        )}
        {success && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm flex items-center gap-2">
            <Check size={14} /> {success}
          </motion.div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 p-1 rounded-2xl bg-white/[0.03] border border-white/[0.06] overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap',
                activeTab === tab.id
                  ? 'bg-white/10 text-white shadow-sm'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              )}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Search by username or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-2xl pl-9 pr-4 py-2.5 text-sm text-white outline-none transition-colors"
          />
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 size={32} className="text-[#c8c8cc] animate-spin" />
          </div>
        ) : activeTab === 'requests' ? (
          <div className="space-y-3">
            {requests.length === 0 ? (
              <div className="text-center py-16 text-gray-500">
                <UserCheck size={40} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">No pending verification requests</p>
              </div>
            ) : (
              requests.map((req) => (
                <motion.div
                  key={req.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="glass rounded-2xl border border-white/[0.06] p-4"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#151517]0/20 to-[#151517]0/20 flex items-center justify-center">
                        <span className="text-sm font-bold text-white">
                          {req.user.username?.[0]?.toUpperCase() || '?'}
                        </span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">{req.user.username}</p>
                        <p className="text-[10px] text-gray-400">{req.user.email} • {req.requestType}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-[10px] font-medium">
                        Pending
                      </span>
                      <button
                        onClick={() => handleAction('approve', { userId: req.userId })}
                        disabled={actionLoading === `approve-${req.userId}`}
                        className="p-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 transition-colors"
                      >
                        {actionLoading === `approve-${req.userId}` ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                      </button>
                      <button
                        onClick={() => {
                          const reason = prompt('Rejection reason:');
                          if (reason) handleAction('reject', { userId: req.userId, reason });
                        }}
                        disabled={actionLoading === `reject-${req.userId}`}
                        className="p-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors"
                      >
                        {actionLoading === `reject-${req.userId}` ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))
            )}
          </div>
        ) : activeTab === 'badges' ? (
          <div className="grid grid-cols-1  gap-3">
            {filteredBadges.length === 0 ? (
              <div className="col-span-full text-center py-16 text-gray-500">
                <ShieldCheck size={40} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">No badges found</p>
              </div>
            ) : (
              filteredBadges.map((badge) => (
                <motion.div
                  key={badge.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="glass rounded-2xl border border-white/[0.06] p-4"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        'w-8 h-8 rounded-full flex items-center justify-center',
                        badge.badgeType === 'BLUE'
                          ? 'bg-gradient-to-br from-[#151517]0 to-[#68686c]'
                          : 'bg-gradient-to-br from-amber-400 to-yellow-600'
                      )}>
                        {badge.badgeType === 'BLUE' ? <ShieldCheck size={12} className="text-white" /> : <Crown size={12} className="text-white" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">{badge.badgeType} Badge</p>
                        <p className="text-[10px] text-gray-400">{badge.user.username}</p>
                      </div>
                    </div>
                    <span className={cn(
                      'px-2 py-0.5 rounded-full text-[10px] font-medium',
                      badge.status === 'ACTIVE' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                    )}>
                      {badge.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const reason = prompt('Revoke reason:');
                        if (reason) handleAction('revoke-badge', { userId: badge.userId, reason });
                      }}
                      disabled={actionLoading === `revoke-badge-${badge.userId}`}
                      className="text-[10px] px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors flex items-center gap-1"
                    >
                      {actionLoading === `revoke-badge-${badge.userId}` ? <Loader2 size={10} className="animate-spin" /> : <Ban size={10} />}
                      Revoke
                    </button>
                    {badge.expiresAt && (
                      <span className="text-[10px] text-gray-500">
                        Expires: {new Date(badge.expiresAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </motion.div>
              ))
            )}
          </div>
        ) : activeTab === 'memberships' ? (
          <div className="space-y-3">
            {filteredMemberships.length === 0 ? (
              <div className="text-center py-16 text-gray-500">
                <Crown size={40} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">No memberships found</p>
              </div>
            ) : (
              filteredMemberships.map((m) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="glass rounded-2xl border border-white/[0.06] p-4"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-400/20 to-yellow-500/20 flex items-center justify-center">
                        <Crown size={16} className="text-amber-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">{m.user.username}</p>
                        <p className="text-[10px] text-gray-400">{m.plan.name} • ${m.plan.price}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className={cn(
                          'text-[10px] font-medium',
                          m.status === 'ACTIVE' ? 'text-emerald-400' : 'text-red-400'
                        )}>
                          {m.status}
                        </p>
                        <p className="text-[10px] text-gray-500">
                          Ends: {new Date(m.endDate).toLocaleDateString()}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          const reason = prompt('Suspend reason:');
                          if (reason) handleAction('suspend', { userId: m.userId, reason });
                        }}
                        disabled={actionLoading === `suspend-${m.userId}`}
                        className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors"
                      >
                        {actionLoading === `suspend-${m.userId}` ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))
            )}
          </div>
        ) : activeTab === 'purchases' ? (
          <div className="space-y-3">
            {purchases.length === 0 ? (
              <div className="text-center py-16 text-gray-500">
                <History size={40} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">No Verified Badge purchases recorded yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {purchases.map((p) => (
                  <motion.div
                    key={p.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="glass rounded-2xl border border-white/[0.06] p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">
                          {p.plan?.name || 'Verified Badge'} — ${p.amount.toFixed(2)} {p.currency}
                        </p>
                        <p className="text-[10px] text-gray-400">
                          @{p.user?.username || p.userId} · {new Date(p.createdAt).toLocaleDateString()}
                        </p>
                        <p className="text-[10px] text-gray-500 font-mono truncate">
                          {p.network ? `${p.network.toUpperCase()} · ` : ''}
                          {p.providerReference ? `tx ${p.providerReference.slice(0, 18)}…` : 'no tx reference'}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <span className={cn(
                            'text-[10px] font-semibold uppercase tracking-wide',
                            p.status === 'COMPLETED' ? 'text-emerald-400'
                              : p.status === 'REFUNDED' || p.status === 'FAILED' || p.status === 'CANCELLED' ? 'text-red-300'
                              : p.status === 'PENDING' || p.status === 'PROCESSING' || p.status === 'PAID' ? 'text-amber-300'
                              : 'text-gray-400'
                          )}>
                            {p.status}
                          </span>
                          {p.status === 'COMPLETED' && (
                            <button
                              onClick={() => handleRefund(p.id)}
                              disabled={actionLoading === `refund-${p.id}`}
                              className="ml-1 p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors"
                              title="Refund purchase"
                            >
                              {actionLoading === `refund-${p.id}` ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
                            </button>
                          )}
                        </div>
                        {p.confirmedAt && (
                          <p className="text-[10px] text-gray-500">
                            Paid: {new Date(p.confirmedAt).toLocaleDateString()}
                          </p>
                        )}
                        {p.refundedAt && (
                          <p className="text-[10px] text-gray-500">
                            Refunded: {new Date(p.refundedAt).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        ) : activeTab === 'plans' ? (
          <PlanManager plans={plans} setPlans={setPlans} token={token} onNotice={(m, t) => {
            setError(null); setSuccess(null);
            if (t === 'error') setError(m); else setSuccess(m);
          }} />
        ) : null}
      </div>
    </div>
  );
}
// ============================================================================
// Plan Manager (real SubscriptionPlan CRUD via /api/verification)
// ============================================================================

function PlanManager({
  plans, setPlans, token, onNotice,
}: {
  plans: any[];
  setPlans: (p: any[]) => void;
  token: string | null;
  onNotice: (message: string, type: 'success' | 'error') => void;
}) {
  const [name, setName] = useState('');
  const [durationMonths, setDurationMonths] = useState(1);
  const [price, setPrice] = useState(0);
  const [badgeType, setBadgeType] = useState('GOLD');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);

  const upsert = async () => {
    if (!token || busy) return;
    if (!name.trim() || price <= 0 || durationMonths < 1) {
      onNotice('Name, a positive price and duration months are required.', 'error');
      return;
    }
    setBusy(true);
    try {
      await apiPost('/api/verification/admin/plan', {
        name: name.trim(),
        durationMonths,
        price,
        badgeType,
        description: description.trim() || null,
        isActive: active,
      }, token);
      const updated = await apiGet<any[]>('/api/verification/plans', token);
      setPlans(Array.isArray(updated) ? updated : []);
      onNotice('Plan saved.', 'success');
      setName(''); setDescription('');
    } catch (err: any) {
      onNotice(err.message || 'Failed to save plan.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Existing plans */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {plans.map((p) => (
          <div key={p.id} className="glass rounded-2xl border border-white/[0.06] p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-bold text-white">{p.name}</p>
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${p.isActive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-gray-500/15 text-gray-400'}`}>
                {p.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-400">
              <span>${Number(p.price || 0).toFixed(2)} {p.currency || 'USD'}</span>
              <span>{p.durationMonths} mo</span>
              <span className="text-[#d9a83f]">{p.badgeType || 'GOLD'}</span>
            </div>
            {p.description && <p className="text-[11px] text-gray-500 mt-2">{p.description}</p>}
          </div>
        ))}
        {plans.length === 0 && (
          <div className="col-span-2 py-10 text-center text-gray-500 text-sm">No subscription plans configured yet.</div>
        )}
      </div>

      {/* Create / update */}
      <div className="glass rounded-2xl border border-white/[0.06] p-4">
        <h3 className="text-sm font-bold text-white mb-3">Create / Update Plan</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Plan name" value={name} onChange={setName} placeholder="e.g. Gold Badge — 12 months" />
          <div className="grid grid-cols-3 gap-2">
            <LabeledInput label="Months" type="number" value={durationMonths} onChange={(v) => setDurationMonths(Number(v) || 1)} />
            <LabeledInput label="Price (USD)" type="number" value={price} onChange={(v) => setPrice(Number(v) || 0)} />
            <div>
              <label className="text-[10px] uppercase tracking-wider text-gray-500">Badge</label>
              <select value={badgeType} onChange={(e) => setBadgeType(e.target.value)} className="w-full glass rounded-xl px-2 py-2 text-sm text-white border border-white/[0.06] outline-none">
                <option value="GOLD">GOLD</option>
                <option value="BLUE">BLUE</option>
              </select>
            </div>
          </div>
          <div className="sm:col-span-2">
            <Input label="Description" value={description} onChange={setDescription} placeholder="Benefits, notes..." />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-300 sm:col-span-2">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-[#d9a83f]" />
            Active (available for purchase)
          </label>
        </div>
        <div className="mt-3">
          <Button variant="primary" size="sm" loading={busy} onClick={() => void upsert()}>Save Plan</Button>
        </div>
      </div>
    </div>
  );
}

function Input({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-gray-500">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-[#d9a83f]/50"
      />
    </div>
  );
}

function LabeledInput({ label, type, value, onChange }: { label: string; type: string; value: any; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-gray-500">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-[#d9a83f]/50"
      />
    </div>
  );
}