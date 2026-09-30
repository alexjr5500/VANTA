"use client";

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Users, Search, Shield, XCircle, DollarSign, Check,
  TrendingUp, Star, Crown, Clock, Eye, MessageCircle, Activity,
  MoreHorizontal, Music, Gamepad2, Palette, Monitor, Camera
} from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import Button from '@/components/ui/Button';
import { getCreators, verifyCreator, toggleMonetization, approveSubscription } from '@/lib/adminApi';
import type { CreatorRecord } from '@/types/admin';
import type { VerificationType } from '@/types/verification';
import VerificationBadge from '@/components/ui/VerificationBadge';
import { useToast } from '@/components/ui/Toast';

export default function CreatorsPage() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [creators, setCreators] = useState<CreatorRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) return;
        const data = await getCreators(token);
        setCreators(data);
      } catch (err) {
        console.error('Failed to fetch creators:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const filtered = creators.filter(c =>
    !search || c.username.toLowerCase().includes(search.toLowerCase()) || c.displayName?.toLowerCase().includes(search.toLowerCase())
  );

  const fmt = (n: number) => n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n);

  const applyPatch = (id: string, patch: Record<string, any>) =>
    setCreators(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));

  const runVerify = async (creator: CreatorRecord, badgeType?: VerificationType) => {
    const token = localStorage.getItem('token');
    if (!token || busyId) return;
    setBusyId(creator.id);
    setMenuFor(null);
    try {
      const updated = await verifyCreator(token, creator.id, badgeType);
      applyPatch(creator.id, updated);
      toast.success(updated.isVerified ? 'Creator verified' : 'Verification removed',
        `${creator.displayName || creator.username}${updated.isVerified ? ` is now ${updated.verificationType ?? 'GOLD'} verified` : ' is no longer verified'}.`);
    } catch (error: any) {
      toast.error('Verification update failed', error.message || 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const toggleMonetize = async (creator: CreatorRecord) => {
    const token = localStorage.getItem('token');
    if (!token || busyId) return;
    setBusyId(creator.id);
    setMenuFor(null);
    try {
      const updated = await toggleMonetization(token, creator.id);
      applyPatch(creator.id, updated);
      toast.success('Monetization updated', `${creator.displayName || creator.username} is now ${updated.isMonetized ? 'monetized' : 'not monetized'}.`);
    } catch (error: any) {
      toast.error('Monetization update failed', error.message || 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const approveSub = async (creator: CreatorRecord) => {
    const token = localStorage.getItem('token');
    if (!token || busyId) return;
    setBusyId(creator.id);
    setMenuFor(null);
    try {
      const updated = await approveSubscription(token, creator.id);
      applyPatch(creator.id, updated);
      toast.success('Subscription approved', `${creator.displayName || creator.username}: ${updated.plan || 'membership active'}.`);
    } catch (error: any) {
      toast.error('Subscription approval failed', error.message || 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col   justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Users size={14} className="text-[#d6a83f]" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-semibold">Creators</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Creator Management</h1>
          <p className="text-sm text-gray-400 mt-1">Manage creators, verify accounts, and review monetization requests.</p>
        </div>
      </div>

      {/* Search */}
      <GlassCard>
        <div className="flex items-center gap-2 bg-white/5 rounded-2xl px-3 py-1.5 border border-white/[0.06] flex-1 min-w-[200px]">
          <Search size={14} className="text-gray-500" />
          <input type="text" placeholder="Search creators..." value={search} onChange={e => setSearch(e.target.value)}
            className="bg-transparent border-none outline-none text-sm text-white placeholder-gray-500 w-full" />
        </div>
      </GlassCard>

      {/* Creators List */}
      <div className="space-y-2">
        {filtered.map((creator, i) => (
          <motion.div key={creator.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
            className="glass rounded-[20px] p-4 border border-white/[0.06] hover:border-white/[0.12] transition-all">
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#151517]0 to-[#151517]0 flex items-center justify-center text-white font-bold shrink-0">
                {creator.username.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white">{creator.displayName || creator.username}</span>
                  {creator.isVerified && creator.verificationType && <VerificationBadge verified type={creator.verificationType} size="xs" className="inline-block" />}
                </div>
                <p className="text-xs text-gray-500">@{creator.username} • {creator.category}</p>
              </div>
              <div className="grid grid-cols-3 gap-4 text-center text-xs">
                <div><p className="font-bold text-white">{fmt(creator.followers)}</p><p className="text-gray-500">Followers</p></div>
                <div><p className="font-bold text-white">{fmt(creator.totalViews)}</p><p className="text-gray-500">Views</p></div>
                <div><p className="font-bold text-green-400">${fmt(creator.totalEarnings)}</p><p className="text-gray-500">Earnings</p></div>
              </div>
              <div className="relative flex items-center gap-1">
                <button
                  onClick={() => void runVerify(creator)}
                  disabled={busyId === creator.id}
                  className={`p-2 rounded-xl hover:bg-[#c8c8cc]/10 transition-colors ${creator.isVerified ? (creator.verificationType === 'BLUE' ? 'text-[#3b82f6]' : 'text-[#f2c75c]') : 'text-[#c8c8cc]'}`}
                  title={creator.isVerified ? 'Unverify Creator' : 'Verify Creator (Gold)'}
                  aria-label={creator.isVerified ? 'Unverify Creator' : 'Verify Creator'}
                ><Shield size={14} /></button>
                <button
                  onClick={() => void toggleMonetize(creator)}
                  disabled={busyId === creator.id}
                  className={`p-2 rounded-xl hover:bg-white/10 transition-colors ${creator.isMonetized ? 'text-green-400' : 'text-gray-400'}`}
                  title={creator.isMonetized ? 'Disable monetization' : 'Enable monetization'}
                  aria-label={creator.isMonetized ? 'Disable monetization' : 'Enable monetization'}
                ><DollarSign size={14} /></button>
                <button
                  onClick={() => setMenuFor(menuFor === creator.id ? null : creator.id)}
                  disabled={busyId === creator.id}
                  className="p-2 rounded-xl hover:bg-white/10 text-gray-400 transition-colors"
                  title="More actions"
                  aria-label="More actions"
                ><MoreHorizontal size={14} /></button>
                {menuFor === creator.id && !busyId && (
                  <div className="absolute right-0 top-full mt-1 z-20 w-56 rounded-xl border border-white/10 bg-[#101010] p-1.5 shadow-xl">
                    {!creator.isVerified && (
                      <button
                        type="button"
                        onClick={() => void runVerify(creator, 'BLUE')}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-white hover:bg-white/5"
                      >
                        <Shield size={13} className="text-[#3b82f6]" /> Verify with BLUE badge
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void approveSub(creator)}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-white hover:bg-white/5"
                    >
                      <Check size={13} className="text-green-400" /> Approve subscription
                    </button>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}