'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { API_BASE_URL } from '@/lib/api';
import { apiGet, apiPost } from '@/lib/apiClient';
import {
  Plus, ArrowUpRight, ArrowDownLeft, Gift, Loader2,
  History, Search, Shield, Ban, X,
  ArrowUpFromLine, Download, ChevronRight,
  Wallet, Sparkles, TrendingUp, DollarSign, Lock, Eye, EyeOff
} from 'lucide-react';
import { cn } from '@/lib/utils';
import VantaCoinIcon from '@/components/ui/VantaCoinIcon';
import PageHeader from '@/components/ui/PageHeader';
import GiftArtwork from '@/components/gifts/GiftArtwork';
import { formatCoinsCompact } from '@/lib/wallet';
import BuyCoinsModal from '@/components/wallet/BuyCoinsModal';

import SendCoinsModal from '@/components/wallet/SendCoinsModal';
import WithdrawModal from '@/components/wallet/WithdrawModal';

// ============================================================================
// TRANSACTION TYPE HELPERS
// ============================================================================

const INCOMING_TYPES = new Set([
  'DEPOSIT', 'PURCHASE', 'TRANSFER_RECEIVED', 'GIFT_RECEIVED', 'REFUND', 'ADMIN_CREDIT', 'SYSTEM_CREDIT'
]);

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'purchases', label: 'Purchases' },
  { id: 'transfers', label: 'Transfers' },
  { id: 'gifts', label: 'Gifts' },
  { id: 'earnings', label: 'Earnings' },
  { id: 'withdrawals', label: 'Withdrawals' },
  { id: 'refunds', label: 'Refunds' },
] as const;

function formatTxLabel(type: string) {
  const labels: Record<string, string> = {
    DEPOSIT: 'Purchase',
    PURCHASE: 'Purchase',
    TRANSFER_SENT: 'Transfer Sent',
    TRANSFER_RECEIVED: 'Transfer Received',
    GIFT_SENT: 'Gift Sent',
    GIFT_RECEIVED: 'Gift Received',
    WITHDRAWAL: 'Withdrawal',
    REFUND: 'Refund',
    SYSTEM_CREDIT: 'System Credit',
    ADMIN_CREDIT: 'Credit',
    ADMIN_DEBIT: 'Debit',
  };
  return labels[type] || type;
}

function getTxIcon(type: string) {
  if (INCOMING_TYPES.has(type)) return <ArrowDownLeft size={15} className="text-[#8A8A8A]" />;
  if (type === 'GIFT_SENT') return <Gift size={15} className="text-[#8A8A8A]" />;
  if (type === 'WITHDRAWAL') return <ArrowUpFromLine size={15} className="text-[#8A8A8A]" />;
  return <ArrowUpRight size={15} className="text-[#8A8A8A]" />;
}

function getTxColor(type: string) {
  if (INCOMING_TYPES.has(type)) return 'bg-white/[0.04] border-white/[0.08]';
  if (type === 'GIFT_SENT') return 'bg-white/[0.04] border-white/[0.08]';
  if (type === 'WITHDRAWAL') return 'bg-white/[0.04] border-white/[0.08]';
  return 'bg-white/[0.04] border-white/[0.08]';
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

// ============================================================================
// SKELETON LOADER
// ============================================================================

function BalanceSkeleton() {
  return (
    <div className="mx-auto min-h-[calc(100dvh-6rem)] w-full min-w-0 space-y-3 pb-[calc(5rem+env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between">
        <div className="skeleton h-10 w-36 rounded-lg" />
        <div className="skeleton h-10 w-10 rounded-lg" />
      </div>
      <div className="skeleton h-44 rounded-lg" />
      <div className="grid grid-cols-4 gap-1.5">
        {[1, 2, 3, 4].map(i => <div key={i} className="skeleton h-14 rounded-lg" />)}
      </div>
      <div className="skeleton h-11 w-full rounded-lg" />
      <div className="space-y-1">
        {[1, 2, 3, 4].map(i => <div key={i} className="skeleton h-14 w-full rounded-lg" />)}
      </div>
    </div>
  );
}

// ============================================================================
// MAIN BALANCE PAGE
// ============================================================================

export default function BalancePage() {
  const { token, user } = useAuth();
  const router = useRouter();
  const [wallet, setWallet] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [gifts, setGifts] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'transactions' | 'gifts' | 'earnings' | 'withdrawals' | 'security'>('overview');
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [selectedTx, setSelectedTx] = useState<any>(null);
  const [hideBalance, setHideBalance] = useState(false);
  const [exporting, setExporting] = useState(false);

  const fetchWallet = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [walletData, txData, giftData, withdrawalData] = await Promise.all([
        apiGet<any>('/api/wallets/me', token),
        apiGet<any>('/api/wallets/transactions', token).catch(() => ({ transactions: [] })),
        apiGet<any>('/api/wallets/gift-history', token).catch(() => ({ sentGifts: [], receivedGifts: [] })),
        apiGet<any>('/api/wallets/withdrawals/history', token).catch(() => ({ withdrawals: [] })),
      ]);
      const loadedBalance = Number(walletData?.coinBalance);
      if (!Number.isSafeInteger(loadedBalance) || loadedBalance < 0) throw new Error('The Balance service returned invalid account data.');
      setWallet(walletData);
      const txList = Array.isArray(txData) ? txData : txData?.transactions ?? txData?.data ?? [];
      setTransactions(Array.isArray(txList) ? txList : []);
      const giftDataObj = Array.isArray(giftData) ? { sentGifts: giftData, receivedGifts: [] } : giftData;
      const sentList = giftDataObj?.sentGifts ?? [];
      const recvList = giftDataObj?.receivedGifts ?? [];
      setGifts([
        ...(Array.isArray(sentList) ? sentList.map((g: any) => ({ ...g, isIncoming: false })) : []),
        ...(Array.isArray(recvList) ? recvList.map((g: any) => ({ ...g, isIncoming: true })) : []),
      ]);
      const wdData = Array.isArray(withdrawalData) ? withdrawalData : withdrawalData?.withdrawals ?? [];
      setWithdrawals(Array.isArray(wdData) ? wdData : []);
    } catch (err: any) {
      setError(err.message || 'Couldn\'t load your balance.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchWallet();
  }, [fetchWallet]);

  const coinBalance = Number(wallet?.coinBalance ?? 0);
  const earningsBalance = wallet?.earningsBalance ?? 0;
  const lifetimeEarnings = wallet?.lifetimeEarnings ?? 0;
  const totalCoinsPurchased = wallet?.totalCoinsPurchased ?? 0;
  const totalCoinsReceived = wallet?.totalCoinsReceived ?? 0;
  const totalCoinsSent = wallet?.totalCoinsSent ?? 0;
  const totalGiftsSent = wallet?.totalGiftsSent ?? 0;
  const totalGiftsReceived = wallet?.totalGiftsReceived ?? 0;
  const totalWithdrawn = wallet?.totalWithdrawn ?? 0;
  const isFrozen = wallet?.isFrozen ?? false;
  const hasPin = wallet?.hasPin ?? false;
  const usdtWalletAddress = wallet?.usdtWalletAddress ?? '';
  const isCreator = (user as any)?.role === 'CREATOR' || (user as any)?.role === 'ADMIN' || (user as any)?.role === 'SUPER_ADMIN' || (user as any)?.premium;

  const handleCoinsPurchased = (_coins: number) => {
    setShowBuyModal(false);
    fetchWallet();
  };

  const handleSuccess = () => {
    fetchWallet();
  };

  const handleExport = async () => {
    if (!token) return;
    setExporting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/wallets/transactions/export`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vanta-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Fallback: client-side CSV
      const headers = ['Date', 'Type', 'Description', 'Amount', 'Fee', 'Balance', 'Status', 'Reference'];
      const rows = transactions.map((tx: any) => [
        new Date(tx.createdAt).toISOString(),
        tx.type,
        `"${(tx.description || '').replace(/"/g, '""')}"`,
        tx.displayAmount ?? tx.amount ?? 0,
        tx.fee ?? 0,
        tx.balance ?? 0,
        tx.status,
        tx.reference || '',
      ]);
      const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vanta-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  // Filter transactions
  const filteredTx = useMemo(() => {
    let list = transactions;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(tx =>
        (tx.description || '').toLowerCase().includes(q) ||
        (tx.type || '').toLowerCase().includes(q) ||
        (tx.counterparty?.username || '').toLowerCase().includes(q)
      );
    }
    if (filter !== 'all') {
      const typeMap: Record<string, string[]> = {
        purchases: ['PURCHASE', 'DEPOSIT'],
        transfers: ['TRANSFER_SENT', 'TRANSFER_RECEIVED'],
        gifts: ['GIFT_SENT', 'GIFT_RECEIVED'],
        earnings: ['GIFT_RECEIVED'],
        withdrawals: ['WITHDRAWAL'],
        refunds: ['REFUND'],
      };
      const types = typeMap[filter];
      if (types) list = list.filter(tx => types.includes(tx.type));
    }
    return [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [transactions, filter, searchQuery]);

  const recentTx = filteredTx.slice(0, 5);
  const recentGifts = gifts.slice(0, 5);

  if (loading) return <BalanceSkeleton />;

  if (error) {
    return (
      <div className="mx-auto flex min-h-[calc(100dvh-8rem)] max-w-sm flex-col items-center justify-center px-4 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-white/[0.08] bg-[#0D0D0F]">
          <Loader2 size={24} className="text-[#8A8A8A]" />
        </div>
        <h2 className="mb-2 text-base font-semibold text-[#F5F5F5]">Balance could not load</h2>
        <p className="mb-6 text-sm leading-5 text-[#8A8A8A]">{error}</p>
        <button
          onClick={fetchWallet}
          className="px-5 py-2.5 rounded-2xl bg-[#F5F5F5] text-black text-sm font-bold hover:bg-white transition-all"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="mx-auto min-h-[calc(100dvh-5rem)] w-full min-w-0 space-y-3 overflow-x-hidden pb-[calc(5rem+env(safe-area-inset-bottom))]"
    >
      {/* Header */}
      <PageHeader
        back
        title="Balance"
        eyebrow="VANTA"
        actions={
          <button
            type="button"
            onClick={() => setHideBalance(!hideBalance)}
            aria-label={hideBalance ? 'Show balance' : 'Hide balance'}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-[#0D0D0F] text-[#8A8A8A] transition hover:text-white"
          >
            {hideBalance ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        }
      />

      {/* Main Balance Card */}
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-lg border border-white/[0.09] bg-[#0D0D0F] px-3.5 py-4 shadow-[0_16px_48px_rgba(0,0,0,.24)]"
        aria-label="Available balance"
      >
        <div className="relative">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-[#8A8A8A]">
              <Sparkles size={14} className="text-[#F5F5F5]" />
          VANTA Coins
            </div>
            <div className="flex gap-2">
              {isFrozen && (
                <span className="flex items-center gap-1.5 rounded-full border border-red-400/15 bg-red-400/[.07] px-2.5 py-1 text-[10px] text-red-300">
                  <Ban size={10} /> Frozen
                </span>
              )}
              {!isFrozen && (
                <span className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[.04] px-2.5 py-1 text-[10px] text-[#8A8A8A]">
                  <i className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Active
                </span>
              )}
            </div>
          </div>
          <p className="mb-1.5 text-xs font-medium text-[#8A8A8A]">Available balance</p>
          <motion.div key={coinBalance} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex min-w-0 items-center gap-2.5">
              <VantaCoinIcon size={24} className="shrink-0 text-[var(--vanta-gold)]" />
              <h2 className="min-w-0 truncate text-[2rem] font-semibold leading-none text-[#F5F5F5] tabular-nums">
                {hideBalance ? '••••••' : coinBalance.toLocaleString()}
              </h2>
            </div>
            <p className="mt-1.5 text-xs font-medium text-[#8A8A8A]">VANTA Coins</p>
            <p className="mt-2 text-xs font-medium text-white/55">
              ≈ ${hideBalance ? '••••' : ((coinBalance / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))} USD
            </p>
          </motion.div>

          {/* Quick Actions */}
          <div className="mt-4 grid w-full grid-cols-3 gap-1.5">
            <button
              onClick={() => setShowBuyModal(true)}
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-[var(--vanta-gold)] px-2 py-2.5 text-xs font-bold text-black transition active:scale-[.98]"
            >
              <Plus size={16} />
               Buy
            </button>
            <button
              onClick={() => setShowSendModal(true)}
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#151517] px-2 py-2.5 text-xs font-medium text-[#F5F5F5] active:scale-[.98]"
            >
              <ArrowUpRight size={16} />
               Send
            </button>
            <button
              onClick={() => router.push('/gifts')}
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#151517] px-2 py-2.5 text-xs font-medium text-[#F5F5F5] active:scale-[.98]"
            >
              <Gift size={16} />
              Gift
            </button>
            {isCreator && earningsBalance > 0 && (
              <button
                onClick={() => setShowWithdrawModal(true)}
                className="col-span-3 flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#151517] px-2 py-2.5 text-xs font-medium text-[#F5F5F5] active:scale-[.98]"
              >
                <ArrowUpFromLine size={16} />
                Withdraw ${earningsBalance.toFixed(2)}
              </button>
            )}
          </div>


          <div className="mt-3 flex items-center gap-2 border-t border-white/[.06] pt-2.5 text-[10px] text-[#8A8A8A]">
            <Lock size={14} />
            Protected by VANTA Balance security
          </div>
        </div>
      </motion.section>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-1.5" aria-label="Balance summary">
        {[
          { label: 'Purchased', value: formatCoinsCompact(totalCoinsPurchased), icon: <Plus size={16} /> },
          { label: 'Received', value: formatCoinsCompact(totalCoinsReceived), icon: <ArrowDownLeft size={16} /> },
          { label: 'Sent', value: formatCoinsCompact(totalCoinsSent), icon: <ArrowUpRight size={16} /> },
          { label: 'Gifts', value: `${totalGiftsSent + totalGiftsReceived}`, icon: <Gift size={16} /> },

        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 + i * 0.04 }}
            className="min-w-0 rounded-lg border border-white/[0.06] bg-[#0D0D0F] px-2 py-2.5"
          >
            <div className="mb-1.5 flex h-6 w-6 items-center justify-center rounded-md bg-white/[0.05] text-[#8A8A8A]">
              {stat.icon}
            </div>
            <p className="truncate text-[11px] font-bold text-[#F5F5F5]">{stat.value}</p>
            <p className="truncate text-[9px] text-[#8A8A8A] mt-0.5">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex w-full min-w-0 items-center gap-1 overflow-x-auto rounded-lg border border-white/[0.06] bg-[#0D0D0F] p-1 scrollbar-hide">
        {[
          { id: 'overview', label: 'Overview', icon: <Wallet size={12} /> },
          { id: 'transactions', label: 'Transactions', icon: <History size={12} /> },
          { id: 'gifts', label: 'Gifts', icon: <Gift size={12} /> },
          ...(isCreator ? [{ id: 'earnings', label: 'Earnings', icon: <TrendingUp size={12} /> }] : []),
          ...(isCreator ? [{ id: 'withdrawals', label: 'Withdrawals', icon: <ArrowUpFromLine size={12} /> }] : []),
          { id: 'security', label: 'Security', icon: <Shield size={12} /> },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={cn(
               'min-h-9 px-3 py-2 rounded-md text-[11px] font-medium whitespace-nowrap transition-all',
              activeTab === tab.id ? 'bg-white text-black' : 'text-[#8A8A8A] hover:text-white'
            )}
          >
            <span className="inline mr-1.5">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ============ OVERVIEW TAB ============ */}
      {activeTab === 'overview' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-3"
        >
          {/* Recent Transactions */}
          <section className="rounded-lg border border-white/[0.08] bg-[#0D0D0F] p-3">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <History size={16} className="text-[#8A8A8A]" />
                <h2 className="text-sm font-semibold text-[#F5F5F5]">Recent activity</h2>
              </div>
              <button
                onClick={() => setActiveTab('transactions')}
                className="flex items-center gap-1 text-xs text-[#8A8A8A] hover:text-white transition"
              >
                View all <ChevronRight size={12} />
              </button>
            </div>

            {recentTx.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <History size={28} className="text-white/10 mb-3" />
                <p className="text-sm text-[#8A8A8A]">No transactions yet.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {recentTx.map((tx: any) => {
                  const isIncoming = tx.isIncoming ?? INCOMING_TYPES.has(tx.type);
                  const displayAmount = typeof tx.displayAmount === 'number' ? tx.displayAmount : (isIncoming ? (tx.amount ?? 0) : -(tx.amount ?? 0));
                  const sign = displayAmount >= 0 ? '+' : '-';
                  return (
                    <button
                      key={tx.id}
                      onClick={() => setSelectedTx(tx)}
                      className="flex min-h-14 w-full items-center gap-3 rounded-lg p-2 text-left transition hover:bg-white/[0.03]"
                    >
                      <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center border shrink-0', getTxColor(tx.type))}>
                        {getTxIcon(tx.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#F5F5F5] truncate">
                          {tx.description || formatTxLabel(tx.type)}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-[#8A8A8A]">
                            {formatDate(tx.createdAt)} · {formatTime(tx.createdAt)}
                          </span>
                          <span className="text-[10px] text-[#8A8A8A]">·</span>
                          <span className="text-[10px] text-[#8A8A8A]">{formatTxLabel(tx.type)}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={cn('text-sm font-bold tabular-nums', isIncoming ? 'text-emerald-400' : 'text-[#F5F5F5]')}>
                          {sign}{Math.abs(displayAmount ?? 0).toLocaleString()}
                        </p>
                        <p className="text-[9px] text-[#8A8A8A]">{tx.status}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Recent Gifts */}
          <section className="rounded-lg border border-white/[0.08] bg-[#0D0D0F] p-3">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Gift size={16} className="text-[#8A8A8A]" />
                <h2 className="text-sm font-semibold text-[#F5F5F5]">Recent gifts</h2>

              </div>
              <button
                onClick={() => setActiveTab('gifts')}
                className="flex items-center gap-1 text-xs text-[#8A8A8A] hover:text-white transition"
              >
                View all <ChevronRight size={12} />
              </button>
            </div>

            {recentGifts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Gift size={28} className="text-white/10 mb-3" />
                <p className="text-sm text-[#8A8A8A]">No gift activity yet.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {recentGifts.map((gift: any) => {
                  const isIncoming = gift.isIncoming;
                  const counterparty = isIncoming ? gift.sender : gift.receiver;
                  const displayName = counterparty?.fullName || counterparty?.username || 'Unknown';
                  return (
                    <div key={gift.id} className="flex items-center gap-4 p-3 rounded-2xl hover:bg-white/[0.03] transition-all">
                      <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center shrink-0">
                        {gift.gift ? <GiftArtwork slug={gift.gift.slug} name={gift.gift.name} size={38} /> : <Gift size={16} className="text-[#8A8A8A]" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#F5F5F5] truncate">
                          {isIncoming ? `Received ${gift.gift?.name || 'Gift'} from ` : `Sent ${gift.gift?.name || 'Gift'} to `}
                          <span className="text-[#8A8A8A]">{displayName}</span>
                        </p>
                        <p className="text-[10px] text-[#8A8A8A] mt-0.5">
                          {formatDate(gift.createdAt)} · {formatTime(gift.createdAt)}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={cn('text-sm font-bold', isIncoming ? 'text-emerald-400' : 'text-[#F5F5F5]')}>
                          {isIncoming ? '+' : '-'}{(gift.amount ?? 0).toLocaleString()}
                        </p>
                        <p className="text-[9px] text-[#8A8A8A]">{isIncoming ? 'Received' : 'Sent'}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Creator Earnings Preview */}
          {isCreator && (
            <section className="rounded-lg border border-white/[0.08] bg-[#101010] p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <TrendingUp size={16} className="text-[#8A8A8A]" />
                  <h2 className="text-base font-bold text-[#F5F5F5]">Creator Earnings</h2>
                </div>
                <button
                  onClick={() => setActiveTab('earnings')}
                  className="flex items-center gap-1 text-xs text-[#8A8A8A] hover:text-white transition"
                >
                  View all <ChevronRight size={12} />
                </button>
              </div>
              <div className="grid grid-cols-2  gap-3">
                <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-4">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-[#8A8A8A]">Available</p>
                  <p className="mt-1 text-xl font-bold text-[#F5F5F5]">${earningsBalance.toFixed(2)}</p>
                </div>
                <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-4">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-[#8A8A8A]">Lifetime</p>
                  <p className="mt-1 text-xl font-bold text-[#F5F5F5]">${lifetimeEarnings.toFixed(2)}</p>
                </div>
                <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-4">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-[#8A8A8A]">Withdrawn</p>
                  <p className="mt-1 text-xl font-bold text-[#F5F5F5]">${totalWithdrawn.toFixed(2)}</p>
                </div>
              </div>
            </section>
          )}
        </motion.div>
      )}

      {/* ============ TRANSACTIONS TAB ============ */}
      {activeTab === 'transactions' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          {/* Search & Filters */}
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8A8A8A]" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search transactions..."
                className="w-full rounded-2xl border border-white/[0.06] bg-white/[0.04] py-2.5 pl-10 pr-4 text-sm text-[#F5F5F5] placeholder-[#8A8A8A] outline-none focus:border-white/[0.15] transition-all"
              />
            </div>
            <div className="flex min-w-0 items-center gap-2 flex-wrap">
              {/* min-w-0 lets this scroll container shrink below its content
                  width so the category pills scroll horizontally WITHIN the
                  mobile viewport instead of widening the whole Balance page. */}
              <div className="flex min-w-0 flex-1 items-center gap-1 bg-white/[0.04] rounded-xl p-1 overflow-x-auto scrollbar-hide">
                {FILTERS.map(f => (

                  <button
                    key={f.id}
                    onClick={() => setFilter(f.id)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-[10px] font-medium whitespace-nowrap transition-all',
                      filter === f.id ? 'bg-white text-black' : 'text-[#8A8A8A] hover:text-white'
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <button
                onClick={handleExport}
                disabled={exporting || transactions.length === 0}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08] text-[10px] text-[#8A8A8A] hover:text-white disabled:opacity-50 transition-all"
              >
                {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                Export CSV
              </button>
            </div>
          </div>

          {/* Transaction List */}
          {filteredTx.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center rounded-3xl bg-white/[0.02] border border-white/[0.04]">
              <History size={32} className="text-white/10 mb-3" />
              <h3 className="text-white/50 font-medium text-base mb-1">No transactions yet</h3>
              <p className="text-white/25 text-sm max-w-xs">
                 Your transaction history will appear here when you buy, send, or receive VANTA Coins.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredTx.map((tx: any, i: number) => {
                const isIncoming = tx.isIncoming ?? INCOMING_TYPES.has(tx.type);
                const displayAmount = typeof tx.displayAmount === 'number' ? tx.displayAmount : (isIncoming ? (tx.amount ?? 0) : -(tx.amount ?? 0));
                const sign = displayAmount >= 0 ? '+' : '-';
                return (
                  <motion.button
                    key={tx.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(i * 0.02, 0.5) }}
                    onClick={() => setSelectedTx(tx)}
                    className="w-full flex items-center gap-4 p-4 rounded-2xl hover:bg-white/[0.03] transition-all text-left"
                  >
                    <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center border shrink-0', getTxColor(tx.type))}>
                      {getTxIcon(tx.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#F5F5F5] truncate">
                        {tx.description || formatTxLabel(tx.type)}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-[10px] text-[#8A8A8A]">
                          {formatDate(tx.createdAt)} · {formatTime(tx.createdAt)}
                        </span>
                        <span className="text-[10px] text-[#8A8A8A]">·</span>
                        <span className="text-[10px] text-[#8A8A8A]">{formatTxLabel(tx.type)}</span>
                        {tx.fee > 0 && (
                          <>
                            <span className="text-[10px] text-[#8A8A8A]">·</span>
                            <span className="text-[10px] text-amber-400/70">Fee: {tx.fee}</span>
                          </>
                        )}
                        <span className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded-full border',
                          tx.status === 'COMPLETED' && 'text-emerald-400 border-emerald-400/20 bg-emerald-400/[.05]',
                          tx.status === 'PENDING' && 'text-amber-400 border-amber-400/20 bg-amber-400/[.05]',
                          tx.status === 'FAILED' && 'text-red-400 border-red-400/20 bg-red-400/[.05]',
                          tx.status === 'REVERSED' && 'text-orange-400 border-orange-400/20 bg-orange-400/[.05]',
                        )}>
                          {tx.status}
                        </span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={cn('text-sm font-bold tabular-nums', isIncoming ? 'text-emerald-400' : 'text-[#F5F5F5]')}>
                        {sign}{Math.abs(displayAmount ?? 0).toLocaleString()}
                      </p>
                      <p className="text-[9px] text-[#8A8A8A]">Balance: {(tx.balance ?? 0).toLocaleString()}</p>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          )}
        </motion.div>
      )}

      {/* ============ GIFTS TAB ============ */}
      {activeTab === 'gifts' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Gift size={16} className="text-[#8A8A8A]" />
              <h2 className="text-lg font-bold text-[#F5F5F5]">Gift History</h2>
            </div>
            <button
              onClick={() => router.push('/gifts')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.05] border border-white/[0.08] text-xs text-[#8A8A8A] hover:text-white transition-all"
            >
              <Gift size={12} />
              Open Gift Store
            </button>
          </div>

          {gifts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center rounded-3xl bg-white/[0.02] border border-white/[0.04]">
              <Gift size={32} className="text-white/10 mb-3" />
              <h3 className="text-white/50 font-medium text-base mb-1">No gift activity yet</h3>
              <p className="text-white/25 text-sm max-w-xs">
                You haven&apos;t sent or received any gifts yet. Support creators during their live streams!
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {gifts.map((gift: any, i: number) => {
                const isIncoming = gift.isIncoming;
                const counterparty = isIncoming ? gift.sender : gift.receiver;
                const displayName = counterparty?.fullName || counterparty?.username || 'Unknown';
                return (
                  <motion.div
                    key={gift.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(i * 0.02, 0.5) }}
                    className="flex items-center gap-4 p-4 rounded-2xl hover:bg-white/[0.03] transition-all"
                  >
                    <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center shrink-0">
                      {gift.gift ? <GiftArtwork slug={gift.gift.slug} name={gift.gift.name} size={38} /> : <Gift size={16} className="text-[#8A8A8A]" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#F5F5F5] truncate">
                        {isIncoming ? `Received ${gift.gift?.name || 'Gift'} from ` : `Sent ${gift.gift?.name || 'Gift'} to `}
                        <span className="text-[#8A8A8A]">{displayName}</span>
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-[#8A8A8A]">
                          {formatDate(gift.createdAt)} · {formatTime(gift.createdAt)}
                        </span>
                        {gift.streamId && (
                          <>
                            <span className="text-[10px] text-[#8A8A8A]">·</span>
                            <span className="text-[10px] text-[#8A8A8A]">Live Stream</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={cn('text-sm font-bold', isIncoming ? 'text-emerald-400' : 'text-[#F5F5F5]')}>
                        {isIncoming ? '+' : '-'}{(gift.amount ?? 0).toLocaleString()}
                      </p>
                      <p className="text-[9px] text-[#8A8A8A]">{isIncoming ? 'Received' : 'Sent'}</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </motion.div>
      )}

      {/* ============ EARNINGS TAB ============ */}
      {activeTab === 'earnings' && isCreator && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <div className="grid grid-cols-2  gap-3">
            {[
              { label: 'Available', value: `$${earningsBalance.toFixed(2)}`, icon: <DollarSign size={16} /> },
              { label: 'Lifetime', value: `$${lifetimeEarnings.toFixed(2)}`, icon: <TrendingUp size={16} /> },
              { label: 'Withdrawn', value: `$${totalWithdrawn.toFixed(2)}`, icon: <ArrowUpFromLine size={16} /> },
              { label: 'Gifts Received', value: totalGiftsReceived.toLocaleString(), icon: <Gift size={16} /> },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4"
              >
                <div className="w-8 h-8 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-[#8A8A8A] mb-2">
                  {stat.icon}
                </div>
                <p className="text-lg font-bold text-[#F5F5F5]">{stat.value}</p>
                <p className="text-[10px] text-[#8A8A8A] mt-0.5">{stat.label}</p>
              </motion.div>
            ))}
          </div>

          {earningsBalance > 0 && (
            <button
              onClick={() => setShowWithdrawModal(true)}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-[#F5F5F5] text-black text-sm font-bold hover:bg-white transition-all"
            >
              <ArrowUpFromLine size={16} />
              Withdraw ${earningsBalance.toFixed(2)}
            </button>
          )}

          {earningsBalance === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center rounded-3xl bg-white/[0.02] border border-white/[0.04]">
              <TrendingUp size={32} className="text-white/10 mb-3" />
              <h3 className="text-white/50 font-medium text-base mb-1">No earnings yet</h3>
              <p className="text-white/25 text-sm max-w-xs">
                Your creator earnings will appear here when you receive gifts and subscriptions.
              </p>
            </div>
          )}
        </motion.div>
      )}

      {/* ============ WITHDRAWALS TAB ============ */}
      {activeTab === 'withdrawals' && isCreator && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ArrowUpFromLine size={16} className="text-[#8A8A8A]" />
              <h2 className="text-lg font-bold text-[#F5F5F5]">Withdrawal History</h2>
            </div>
            {earningsBalance > 0 && (
              <button
                onClick={() => setShowWithdrawModal(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#F5F5F5] text-black text-xs font-bold hover:bg-white transition-all"
              >
                <ArrowUpFromLine size={12} />
                Withdraw
              </button>
            )}
          </div>

          {withdrawals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center rounded-3xl bg-white/[0.02] border border-white/[0.04]">
              <ArrowUpFromLine size={32} className="text-white/10 mb-3" />
              <h3 className="text-white/50 font-medium text-base mb-1">No withdrawals yet</h3>
              <p className="text-white/25 text-sm max-w-xs">
                Your withdrawal history will appear here when you request a payout.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {withdrawals.map((wd: any) => (
                <div key={wd.id} className="flex items-center gap-4 p-4 rounded-2xl hover:bg-white/[0.03] transition-all">
                  <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center shrink-0">
                    <ArrowUpFromLine size={16} className="text-[#8A8A8A]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#F5F5F5]">
                      Withdrawal of ${wd.amount.toFixed(2)}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-[#8A8A8A]">
                        {formatDate(wd.createdAt)} · {formatTime(wd.createdAt)}
                      </span>
                      <span className="text-[10px] text-[#8A8A8A]">·</span>
                      <span className="text-[10px] text-[#8A8A8A]">Fee: ${wd.fee.toFixed(2)}</span>
                      <span className="text-[10px] text-[#8A8A8A]">·</span>
                      <span className="text-[10px] text-[#8A8A8A]">Net: ${wd.netAmount.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={cn(
                      'text-[10px] px-2 py-0.5 rounded-full border',
                      wd.status === 'COMPLETED' && 'text-emerald-400 border-emerald-400/20 bg-emerald-400/[.05]',
                      wd.status === 'PENDING' && 'text-amber-400 border-amber-400/20 bg-amber-400/[.05]',
                      wd.status === 'FAILED' && 'text-red-400 border-red-400/20 bg-red-400/[.05]',
                    )}>
                      {wd.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}

      {/* ============ SECURITY TAB ============ */}
      {activeTab === 'security' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <div className="rounded-3xl border border-white/[0.06] bg-white/[0.02] p-5">
            <div className="flex items-center gap-2 mb-4">
              <Shield size={16} className="text-[#8A8A8A]" />
              <h2 className="text-base font-bold text-[#F5F5F5]">Balance Security</h2>
            </div>

            <div className="grid grid-cols-1  gap-3">
              <div className="rounded-2xl bg-white/[0.03] border border-white/[0.04] p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-[#8A8A8A]">Wallet PIN</span>
                  <span className={cn('text-xs', hasPin ? 'text-emerald-400' : 'text-amber-400')}>
                    {hasPin ? 'Set' : 'Not Set'}
                  </span>
                </div>
                <p className="text-[10px] text-[#8A8A8A]">
                  {hasPin ? 'Your PIN protects transfers and withdrawals.' : 'Set a PIN to protect your transfers and withdrawals.'}
                </p>
              </div>

              <div className="rounded-2xl bg-white/[0.03] border border-white/[0.04] p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-[#8A8A8A]">Two-Factor Auth</span>
                  <span className="text-xs text-[#8A8A8A]">Via Account</span>
                </div>
                <p className="text-[10px] text-[#8A8A8A]">
                  Enable 2FA in your account settings for stronger protection.
                </p>
              </div>

              <div className="rounded-2xl bg-white/[0.03] border border-white/[0.04] p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-[#8A8A8A]">USDT Wallet</span>
                  <span className={cn('text-xs', usdtWalletAddress ? 'text-emerald-400' : 'text-[#8A8A8A]')}>
                    {usdtWalletAddress ? 'Connected' : 'Not Set'}
                  </span>
                </div>
                <p className="text-[10px] text-[#8A8A8A] truncate">
                  {usdtWalletAddress || 'Connect a USDT (BEP-20) wallet for withdrawals.'}
                </p>
              </div>

              <div className="rounded-2xl bg-white/[0.03] border border-white/[0.04] p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-[#8A8A8A]">Account Status</span>
                  <span className={cn('text-xs', isFrozen ? 'text-red-400' : 'text-emerald-400')}>
                    {isFrozen ? 'Frozen' : 'Active'}
                  </span>
                </div>
                <p className="text-[10px] text-[#8A8A8A]">
                  {isFrozen ? 'Your balance is frozen. Contact support.' : 'Your balance is active and secure.'}
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Transaction Details Modal */}
      <AnimatePresence>
        {selectedTx && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-md"
              onClick={() => setSelectedTx(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed inset-x-0 top-[max(12px,env(safe-area-inset-top))] bottom-[max(12px,env(safe-area-inset-bottom))] z-[101] mx-auto flex min-h-0 w-[calc(100%-1.5rem)] max-w-[456px] flex-col overflow-hidden rounded-3xl border border-white/[0.08] bg-[#101010]/95 shadow-2xl backdrop-blur-2xl"
              role="dialog"
              aria-modal="true"
              aria-label="Transaction details"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center">
                    {getTxIcon(selectedTx.type)}
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-[#F5F5F5]">Transaction Details</h2>
                    <p className="text-[10px] text-[#8A8A8A]">{formatTxLabel(selectedTx.type)}</p>
                  </div>
                </div>
                <button onClick={() => setSelectedTx(null)} className="rounded-xl p-2 text-[#8A8A8A] hover:text-white hover:bg-white/[0.05] transition" aria-label="Close">
                  <X size={18} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-hide p-6 space-y-4">
                <div className="text-center">
                  <p className={cn('text-3xl font-bold tabular-nums', selectedTx.isIncoming ? 'text-emerald-400' : 'text-[#F5F5F5]')}>
                    {selectedTx.isIncoming ? '+' : '-'}{Math.abs(selectedTx.displayAmount ?? selectedTx.amount ?? 0).toLocaleString()}
                  </p>
                  <p className="mt-1 text-xs text-[#8A8A8A]">VANTA Coins</p>
                </div>

                <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#8A8A8A]">Type</span>
                    <span className="font-medium text-[#F5F5F5]">{formatTxLabel(selectedTx.type)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#8A8A8A]">Amount</span>
                    <span className="font-medium text-[#F5F5F5]">{Math.abs(selectedTx.amount ?? 0).toLocaleString()}</span>
                  </div>
                  {selectedTx.fee > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[#8A8A8A]">Fee</span>
                      <span className="font-medium text-[#F5F5F5]">{selectedTx.fee.toLocaleString()}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#8A8A8A]">Status</span>
                    <span className={cn(
                      'font-medium',
                      selectedTx.status === 'COMPLETED' && 'text-emerald-400',
                      selectedTx.status === 'PENDING' && 'text-amber-400',
                      selectedTx.status === 'FAILED' && 'text-red-400',
                    )}>
                      {selectedTx.status}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#8A8A8A]">Date</span>
                    <span className="font-medium text-[#F5F5F5]">{formatDate(selectedTx.createdAt)} · {formatTime(selectedTx.createdAt)}</span>
                  </div>
                  {selectedTx.counterparty && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[#8A8A8A]">Counterparty</span>
                      <span className="font-medium text-[#F5F5F5]">@{selectedTx.counterparty.username}</span>
                    </div>
                  )}
                  {selectedTx.reference && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[#8A8A8A]">Reference</span>
                      <span className="font-medium text-[#F5F5F5] font-mono text-[10px] truncate max-w-[180px]">{selectedTx.reference}</span>
                    </div>
                  )}
                </div>

                {selectedTx.description && (
                  <p className="text-xs text-[#8A8A8A] leading-relaxed">{selectedTx.description}</p>
                )}
              </div>

              <div className="shrink-0 border-t border-white/[0.06] px-6 py-4">
                <button
                  onClick={() => setSelectedTx(null)}
                  className="w-full py-2.5 rounded-2xl bg-white/[0.05] border border-white/[0.08] text-sm font-medium text-[#F5F5F5] hover:bg-white/[0.08] transition-all"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Modals */}
      <BuyCoinsModal
        open={showBuyModal}
        onClose={() => setShowBuyModal(false)}
        onSuccess={handleCoinsPurchased}
      />

      <SendCoinsModal
        open={showSendModal}
        balance={coinBalance}
        onClose={() => setShowSendModal(false)}
        onSuccess={handleSuccess}
      />

      <WithdrawModal
        open={showWithdrawModal}
        balance={earningsBalance}
        walletAddress={usdtWalletAddress}
        onClose={() => setShowWithdrawModal(false)}
        onSuccess={handleSuccess}
      />
    </motion.div>
  );
}