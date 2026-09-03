'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/context/AuthContext';
import { getVerificationStatus, getVerificationHistory, submitVerificationRequest, type VerificationStatus, type VerificationHistory } from '@/lib/verificationApi';
import { ShieldCheck, Crown, Check, X, Clock, Loader2, ChevronRight, Sparkles, AlertCircle, Send, History } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';

export default function VerificationPage() {
  const { user, token, isLoading } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [history, setHistory] = useState<VerificationHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [requestType, setRequestType] = useState<string>('CREATOR');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showRequestForm, setShowRequestForm] = useState(false);

  useEffect(() => {
    if (!token) return;
    loadData();
  }, [token]);

  const loadData = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [statusData, historyData] = await Promise.all([
        getVerificationStatus(token),
        getVerificationHistory(token),
      ]);
      setStatus(statusData);
      setHistory(historyData);
    } catch (err: any) {
      setError(err.message || 'Failed to load verification data');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitRequest = async () => {
    if (!token) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitVerificationRequest(token, { requestType });
      setSuccess('Verification request submitted successfully!');
      setShowRequestForm(false);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-[#151517]0/60" />
      </div>
    );
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <div className="glass rounded-[28px] p-12 text-center max-w-md mx-4">
          <ShieldCheck size={48} className="text-[#c8c8cc] mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white">Verification</h2>
          <p className="text-sm text-gray-400 mt-2">Sign in to manage your verification status.</p>
          <button onClick={() => router.push('/login')} className="mt-6 px-6 py-2.5 rounded-full bg-gradient-to-r from-[#151517]0 to-[#68686c] text-white text-sm font-semibold hover:brightness-110 transition-all">
            Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <div className="w-full">
        {/* Header */}
        <PageHeader title="Verification" back="/settings" />

        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2"
          >
            <AlertCircle size={14} />
            {error}
          </motion.div>
        )}

        {success && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm flex items-center gap-2"
          >
            <Check size={14} />
            {success}
          </motion.div>
        )}

        {loading ? (
          <div className="space-y-4">
            <div className="skeleton h-48 rounded-3xl" />
            <div className="skeleton h-32 rounded-3xl" />
          </div>
        ) : (
          <>
            {/* Current Status */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="glass rounded-3xl border border-white/[0.06] p-6 mb-6"
            >
              <h2 className="text-lg font-bold text-white mb-4">Current Status</h2>
              <div className="grid grid-cols-1  gap-4">
                <div className={cn(
                  'rounded-2xl p-4 border',
                  status?.hasBlueBadge
                    ? 'bg-[#c8c8cc]/5 border-[#151517]0/20'
                    : 'bg-white/[0.02] border-white/[0.06]'
                )}>
                  <div className="flex items-center gap-3 mb-2">
                    <div className={cn(
                      'w-10 h-10 rounded-full flex items-center justify-center',
                      status?.hasBlueBadge
                        ? 'bg-gradient-to-br from-[#151517]0 to-[#68686c]'
                        : 'bg-white/5'
                    )}>
                      <ShieldCheck size={16} className={status?.hasBlueBadge ? 'text-white' : 'text-gray-500'} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Blue Badge</p>
                      <p className="text-[10px] text-gray-400">Identity Verification</p>
                    </div>
                  </div>
                  {status?.hasBlueBadge ? (
                    <div className="flex items-center gap-1.5 text-emerald-400 text-xs">
                      <Check size={12} />
                      Active
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500">Not verified</p>
                  )}
                </div>

                <div className={cn(
                  'rounded-2xl p-4 border',
                  status?.hasGoldBadge
                    ? 'bg-amber-500/5 border-amber-500/20'
                    : 'bg-white/[0.02] border-white/[0.06]'
                )}>
                  <div className="flex items-center gap-3 mb-2">
                    <div className={cn(
                      'w-10 h-10 rounded-full flex items-center justify-center',
                      status?.hasGoldBadge
                        ? 'bg-gradient-to-br from-amber-400 to-yellow-600'
                        : 'bg-white/5'
                    )}>
                      <Crown size={16} className={status?.hasGoldBadge ? 'text-white' : 'text-gray-500'} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Gold Badge</p>
                      <p className="text-[10px] text-gray-400">Creator Membership</p>
                    </div>
                  </div>
                  {status?.hasGoldBadge ? (
                    <div>
                      <div className="flex items-center gap-1.5 text-emerald-400 text-xs">
                        <Check size={12} />
                        Active
                      </div>
                      {status.expiryDate && (
                        <p className="text-[10px] text-gray-500 mt-1">
                          Expires: {new Date(status.expiryDate).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  ) : (
                    <Link
                      href="/creator/upgrade"
                      className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 transition-colors"
                    >
                      Upgrade to Creator <ChevronRight size={10} />
                    </Link>
                  )}
                </div>
              </div>

              {/* Creator Studio Access */}
              <div className="mt-4 p-4 rounded-2xl bg-white/[0.02] border border-white/[0.06]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">Creator Studio Access</p>
                    <p className="text-[10px] text-gray-400">Requires Gold Badge</p>
                  </div>
                  {status?.canAccessCreatorStudio ? (
                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      <span className="text-[10px] text-emerald-400 font-medium">Active</span>
                    </div>
                  ) : (
                    <Link
                      href="/creator/upgrade"
                      className="px-3 py-1.5 rounded-full bg-gradient-to-r from-amber-500 to-yellow-500 text-white text-[10px] font-bold"
                    >
                      Upgrade
                    </Link>
                  )}
                </div>
              </div>
            </motion.div>

            {/* Request Verification */}
            {!status?.hasBlueBadge && !status?.hasGoldBadge && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="glass rounded-3xl border border-white/[0.06] p-6 mb-6"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Send size={16} className="text-[#c8c8cc]" />
                    <h2 className="text-lg font-bold text-white">Request Verification</h2>
                  </div>
                  <button
                    onClick={() => setShowRequestForm(!showRequestForm)}
                    className="text-xs text-[#c8c8cc] hover:text-[#c8c8cc] transition-colors"
                  >
                    {showRequestForm ? 'Cancel' : 'Apply'}
                  </button>
                </div>

                <AnimatePresence>
                  {showRequestForm && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      <div className="space-y-4">
                        <div>
                          <label className="text-xs text-gray-400 mb-1.5 block">Request Type</label>
                          <select
                            value={requestType}
                            onChange={(e) => setRequestType(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-[#151517]0/50 transition-colors"
                          >
                            <option value="CREATOR">Creator</option>
                            <option value="BUSINESS">Business</option>
                            <option value="INDIVIDUAL">Individual</option>
                          </select>
                        </div>
                        <button
                          onClick={handleSubmitRequest}
                          disabled={submitting}
                          className="w-full py-3 rounded-2xl bg-gradient-to-r from-[#151517]0 to-[#68686c] text-white text-sm font-bold shadow-lg shadow-[#151517]0/20 hover:shadow-[#151517]0/30 transition-all flex items-center justify-center gap-2"
                        >
                          {submitting ? (
                            <>
                              <Loader2 size={14} className="animate-spin" />
                              Submitting...
                            </>
                          ) : (
                            <>
                              <Send size={14} />
                              Submit Request
                            </>
                          )}
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {/* Verification History */}
            {history.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="glass rounded-3xl border border-white/[0.06] p-6"
              >
                <div className="flex items-center gap-2 mb-4">
                  <History size={16} className="text-gray-400" />
                  <h2 className="text-lg font-bold text-white">Verification History</h2>
                </div>
                <div className="space-y-2">
                  {history.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]"
                    >
                      <div className={cn(
                        'w-8 h-8 rounded-lg flex items-center justify-center',
                        item.action.includes('GRANTED') || item.action.includes('APPROVED')
                          ? 'bg-emerald-500/10'
                          : item.action.includes('REVOKED') || item.action.includes('REJECTED') || item.action.includes('EXPIRED')
                          ? 'bg-red-500/10'
                          : 'bg-[#c8c8cc]/10'
                      )}>
                        {item.action.includes('GRANTED') || item.action.includes('APPROVED') ? (
                          <Check size={14} className="text-emerald-400" />
                        ) : item.action.includes('REVOKED') || item.action.includes('REJECTED') || item.action.includes('EXPIRED') ? (
                          <X size={14} className="text-red-400" />
                        ) : (
                          <Clock size={14} className="text-[#c8c8cc]" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white/70 truncate">
                          {item.action.replace(/_/g, ' ')}
                        </p>
                        <p className="text-[10px] text-gray-500">
                          {new Date(item.createdAt).toLocaleDateString()} at {new Date(item.createdAt).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </>
        )}
      </div>
    </div>
  );
}