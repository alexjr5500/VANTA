'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { API_BASE_URL } from '@/lib/api';
import { apiGet } from '@/lib/apiClient';
import {
  Plus, ArrowUpRight, ArrowDownLeft, Gift, Loader2,
  History, Search, Shield, Ban, X,
  ArrowUpFromLine, Download, ChevronRight,
  Wallet, Sparkles, TrendingUp, DollarSign, Lock, Eye, EyeOff, ArrowLeft, RefreshCw, Headphones
} from 'lucide-react';
import { cn } from '@/lib/utils';
import VantaCoinIcon from '@/components/ui/VantaCoinIcon';
import GiftArtwork from '@/components/gifts/GiftArtwork';
import { giftVisualQuality } from '@/lib/giftCatalog';
import { formatCoinsCompact, resolveWalletSpendable, transferDeductionBudget, type WalletTransferLimits } from '@/lib/wallet';
import BuyCoinsModal from '@/components/wallet/BuyCoinsModal';

import SendCoinsModal from '@/components/wallet/SendCoinsModal';
import WithdrawModal from '@/components/wallet/WithdrawModal';
import ReceiveCoinsModal from '@/components/wallet/ReceiveCoinsModal';
import WalletActivity from '@/components/wallet/WalletActivity';
import { useWalletDialog } from '@/components/wallet/useWalletDialog';

// ============================================================================
// TRANSACTION TYPE HELPERS
// ============================================================================

const INCOMING_TYPES = new Set([
  'DEPOSIT', 'PURCHASE', 'TRANSFER_RECEIVED', 'GIFT_RECEIVED', 'CREATOR_EARNING', 'REFUND', 'ADMIN_CREDIT', 'SYSTEM_CREDIT'
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
    CREATOR_EARNING: 'Creator Earnings',
    WITHDRAWAL: 'Withdrawal',
    REFUND: 'Refund',
    SYSTEM_CREDIT: 'System Credit',
    ADMIN_CREDIT: 'Credit',
    ADMIN_DEBIT: 'Debit',
  };
  return labels[type] || type;
}

function getTxIcon(type: string) {
  if (INCOMING_TYPES.has(type)) return <ArrowDownLeft size={15} className="text-[var(--vanta-gold-bright)]" />;
  if (type === 'GIFT_SENT') return <Gift size={15} className="text-[var(--vanta-gold-bright)]" />;
  if (type === 'WITHDRAWAL') return <ArrowUpFromLine size={15} className="text-[var(--vanta-gold-bright)]" />;
  return <ArrowUpRight size={15} className="text-[var(--vanta-gold-bright)]" />;
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
    <div className="mx-auto min-h-[calc(100dvh-6rem)] w-full min-w-0 space-y-2.5 pb-[calc(5rem+env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between">
        <div className="skeleton h-10 w-36 rounded-lg" />
        <div className="skeleton h-10 w-10 rounded-lg" />
      </div>
      <div className="skeleton h-44 rounded-lg" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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

type BalanceTab = 'overview' | 'transactions' | 'gifts' | 'earnings' | 'withdrawals' | 'security';

const BALANCE_TABS: readonly BalanceTab[] = ['overview', 'transactions', 'gifts', 'earnings', 'withdrawals', 'security'];
const balanceTabOf = (value: string | null | undefined): BalanceTab =>
  BALANCE_TABS.includes(value as BalanceTab) ? (value as BalanceTab) : 'overview';

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
  const [statusFilter, setStatusFilter] = useState('');
  const [directionFilter, setDirectionFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [historyRows, setHistoryRows] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyRetry, setHistoryRetry] = useState(0);
  const [receiptNotice, setReceiptNotice] = useState('');
  const historyVersion = useRef(0);
  const [activeTab, setActiveTab] = useState<BalanceTab>('overview');
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [initialRecipientId, setInitialRecipientId] = useState<string | null>(null);
  const [recipientLinkError, setRecipientLinkError] = useState('');
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [selectedTx, setSelectedTx] = useState<any>(null);
  const [hideBalance, setHideBalance] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [historyErrors, setHistoryErrors] = useState<string[]>([]);
  const [transactionTotal, setTransactionTotal] = useState(0);
  const [transactionOffset, setTransactionOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState('');
  const [twoFactor, setTwoFactor] = useState<boolean | null>(null);
  const requestVersion = useRef(0);
  const loadMoreLock = useRef(false);
  const detailsRef = useWalletDialog<HTMLDivElement>(Boolean(selectedTx), () => setSelectedTx(null));

  // Deep links (e.g. wallet notifications land on /balance/transactions, which
  // redirects to /balance?tab=transactions) must select the requested tab on
  // first mount. This runs once after hydration; the activeTab state then owns
  // the view and the URL is kept in sync for shareable/refreshable state.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const requested = new URLSearchParams(window.location.search).get('tab');
    setActiveTab(balanceTabOf(requested));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Switch tabs and keep the `?tab=` query in sync so reloads stay on the view. */
  const changeTab = useCallback((tab: BalanceTab) => {
    setActiveTab(tab);
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (tab === 'overview') params.delete('tab');
    else params.set('tab', tab);
    const search = params.toString();
    router.replace(search ? `/balance?${search}` : '/balance', { scroll: false });
  }, [router]);

  const fetchWallet = useCallback(async () => {
    if (!token) { requestVersion.current++; setWallet(null); setTransactions([]); setGifts([]); setWithdrawals([]); setLoading(false); return; }
    const version = ++requestVersion.current;
    loadMoreLock.current = false;
    setLoadingMore(false);
    setMoreError('');
    setLoading(true);
    setError(null);
    try {
      const [walletData, txData, giftData, withdrawalData, securityData] = await Promise.all([
        apiGet<any>('/api/wallets/me', token, { skipCache: true }),
        apiGet<any>('/api/wallets/transactions?limit=50&offset=0', token, { skipCache: true }).catch(() => null),
        apiGet<any>('/api/wallets/gift-history', token, { skipCache: true }).catch(() => null),
        apiGet<any>('/api/wallets/withdrawals/history', token, { skipCache: true }).catch(() => null),
        apiGet<{ enabled: boolean }>('/api/auth/2fa/status', token, { skipCache: true }).catch(() => null),
      ]);
      if (version !== requestVersion.current) return;
      setHistoryErrors([...(txData === null ? ['Transactions'] : []), ...(giftData === null ? ['Gifts'] : []), ...(withdrawalData === null ? ['Withdrawals'] : [])]);
      setTwoFactor(typeof securityData?.enabled === 'boolean' ? securityData.enabled : null);
      if (resolveWalletSpendable(walletData) === null) throw new Error('The Balance service returned invalid account data.');
      setWallet(walletData);
      const txList = Array.isArray(txData) ? txData : txData?.transactions ?? txData?.data ?? [];
      setTransactions(Array.isArray(txList) ? txList : []);
      setHistoryRetry(v => v + 1);
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
      if (version === requestVersion.current) setError(err.message || 'Couldn\'t load your balance.');
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchWallet();
    return () => { requestVersion.current++; };
  }, [fetchWallet]);

  const coinBalance = wallet?.coinBalance ?? 0;
  const spendable = resolveWalletSpendable(wallet) ?? 0;
  const limits: WalletTransferLimits | null = wallet?.effectiveTransferLimits ?? null;
  const transferBudget = transferDeductionBudget(spendable, limits);
  const pendingRows: { currency: string; count: number; amount: number }[] | null = Array.isArray(wallet?.pendingTransactions) ? wallet.pendingTransactions : null;
  const pendingCount = pendingRows?.reduce((sum, row) => sum + row.count, 0);
  const hidden = '••••••';
  const displayCoins = (value: number) => hideBalance ? hidden : value.toLocaleString();
  const displayUsd = (value: number) => hideBalance ? hidden : '$' + value.toFixed(2);
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

  useEffect(() => {
    if (!wallet || !token || loading) return;
    const url = new URL(window.location.href);
    const id = url.searchParams.get('recipient');
    if (!id) return;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || id === user?.id) setRecipientLinkError('This receiving link is invalid or belongs to your account.');
    else if (isFrozen || transferBudget <= 0) setRecipientLinkError('Sending is unavailable. Check your spendable balance and transfer limits.');
    else { setInitialRecipientId(id); setShowSendModal(true); }
    url.searchParams.delete('recipient');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, [wallet, token, loading, isFrozen, transferBudget, user?.id]);

  const handleCoinsPurchased = (_coins: number) => {
    setShowBuyModal(false);
    fetchWallet();
  };

  const handleSuccess = () => {
    fetchWallet();
  };

  const historyQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (filter !== 'all') params.set('type', filter);
    if (searchQuery.trim()) params.set('search', searchQuery.trim());
    if (statusFilter) params.set('status', statusFilter);
    if (directionFilter) params.set('direction', directionFilter);
    if (startDate) params.set('startDate', new Date(startDate + 'T00:00:00').toISOString());
    if (endDate) params.set('endDate', new Date(endDate + 'T23:59:59.999').toISOString());
    return params.toString();
  }, [filter, searchQuery, statusFilter, directionFilter, startDate, endDate]);

  useEffect(() => {
    const version = ++historyVersion.current;
    loadMoreLock.current = false;
    setLoadingMore(false); setMoreError(''); setHistoryRows([]); setTransactionOffset(0); setTransactionTotal(0);
    setHistoryError('');
    if (!token || activeTab !== 'transactions') { setHistoryLoading(false); return; }
    if (startDate && endDate && startDate > endDate) { setHistoryError('Start date must be before end date.'); setHistoryLoading(false); return; }
    setHistoryLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const page = await apiGet<any>('/api/wallets/transactions?limit=50&offset=0&' + historyQuery, token, { skipCache: true });
        if (version !== historyVersion.current) return;
        if (!Array.isArray(page?.transactions) || !Number.isSafeInteger(page?.total)) throw new Error('Invalid history');
        setHistoryRows(page.transactions); setTransactionOffset(page.transactions.length); setTransactionTotal(page.total);
      } catch { if (version === historyVersion.current) setHistoryError('Could not load transaction history.'); }
      finally { if (version === historyVersion.current) setHistoryLoading(false); }
    }, 250);
    return () => { window.clearTimeout(timer); historyVersion.current++; };
  }, [token, activeTab, historyQuery, historyRetry, startDate, endDate]);

  const loadMore = async () => {
    if (!token || historyLoading || loadMoreLock.current || transactionOffset >= transactionTotal) return;
    const version = historyVersion.current;
    loadMoreLock.current = true;
    setLoadingMore(true); setMoreError('');
    try {
      const page = await apiGet<any>('/api/wallets/transactions?limit=50&offset=' + transactionOffset + '&' + historyQuery, token, { skipCache: true });
      if (version !== historyVersion.current) return;
      if (!Array.isArray(page?.transactions) || !Number.isSafeInteger(page?.total)) throw new Error('Invalid history');
      const rows = page.transactions;
      setHistoryRows(previous => [...new Map([...previous, ...rows].map(row => [row.id, row])).values()]);
      setTransactionOffset(previous => previous + rows.length); setTransactionTotal(page.total);
      if (!rows.length) setMoreError('No additional records returned. Refresh history.');
    } catch { if (version === historyVersion.current) setMoreError('Could not load more transactions. Try again.'); }
    finally { if (version === historyVersion.current) { loadMoreLock.current = false; setLoadingMore(false); } }
  };

  const handleExport = async () => {
    if (!token || exporting) return;
    setExporting(true);
    setExportError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/wallets/transactions/export?${historyQuery}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vanta-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setExportError('Could not export the transaction history. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const filteredTx = historyRows;
  const hasFilters = Boolean(searchQuery.trim() || filter !== 'all' || statusFilter || directionFilter || startDate || endDate);
  const clearFilters = () => { setSearchQuery(''); setFilter('all'); setStatusFilter(''); setDirectionFilter(''); setStartDate(''); setEndDate(''); };

  const downloadReceipt = (tx: any) => {
    const lines = ['VANTA transaction record', 'ID: ' + tx.id, 'Reference: ' + (tx.reference || 'Not assigned'), 'Date: ' + tx.createdAt,
      'Type: ' + formatTxLabel(tx.type), 'Status: ' + tx.status, 'Currency: ' + tx.currency,
      'Ledger amount: ' + (tx.displayAmount ?? tx.amount), 'Fee (included in sender transfer debit): ' + (tx.fee ?? 0),
      'Balance after entry: ' + tx.balance, 'This record does not confirm external settlement.'];
    const url = URL.createObjectURL(new Blob([lines.join('\n')], {type:'text/plain;charset=utf-8'}));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'vanta-transaction-' + tx.id + '.txt';
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const recentTx = [...transactions].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5);
  const sortedGifts = [...gifts].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const recentGifts = sortedGifts.slice(0, 5);

  if (loading) return <div role="status" aria-label="Loading balance"><BalanceSkeleton /></div>;

  if (error || !wallet) {
    return (
      <div className="mx-auto flex min-h-[calc(100dvh-8rem)] max-w-sm flex-col items-center justify-center px-4 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-white/[0.08] bg-[var(--surface-secondary)]">
          <Loader2 size={24} className="text-[var(--text-secondary)]" />
        </div>
        <h2 className="mb-2 text-base font-semibold text-[var(--text-primary)]">Balance could not load</h2>
        <p className="mb-6 text-sm leading-5 text-[var(--text-secondary)]">{error || 'Sign in to view your balance.'}</p>
        <button
          onClick={fetchWallet}
          className="px-5 py-2.5 rounded-2xl bg-[var(--vanta-gold)] text-black text-sm font-bold hover:bg-[var(--vanta-gold-bright)] transition-all"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="vanta-wallet-ui mx-auto min-h-[calc(100dvh-5rem)] w-full min-w-0 space-y-2.5 pb-[calc(5rem+env(safe-area-inset-bottom))]"
    >
      {/* Header — Discover-style full-bleed sticky bar that stays fixed at the top
          while the balance and transaction content scroll beneath it. */}
      <header className="sticky top-0 z-30 relative -mx-4 flex h-14 w-[calc(100%+2rem)] shrink-0 items-center gap-2.5 border-b border-white/[.08] bg-[var(--header-surface)] px-4 backdrop-blur-xl">
        <button type="button" onClick={() => router.back()} aria-label="Go back" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-white/[.05] hover:text-white"><ArrowLeft size={20} /></button>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-[var(--text-primary)]">Balance</h1>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button type="button" onClick={fetchWallet} aria-label="Refresh wallet" className="grid h-11 w-11 place-items-center rounded-lg text-[var(--vanta-gold-bright)]"><RefreshCw size={18}/></button>
          <button
            type="button"
            onClick={() => setHideBalance(!hideBalance)}
            aria-label={hideBalance ? 'Show wallet summaries' : 'Hide wallet summaries'}
            aria-pressed={hideBalance}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-[var(--surface-secondary)] text-[var(--text-secondary)] transition hover:text-white"
          >
            {hideBalance ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </header>

      {/* Main Balance Card */}
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl border border-[var(--gold-border)] bg-[var(--surface)] px-4 py-4"
        aria-label="Spendable wallet balance"
      >
        <div className="relative">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
              <Sparkles size={14} className="text-[var(--vanta-gold-bright)]" />
          VANTA Coins
            </div>
            <div className="flex gap-2">
              {isFrozen && (
                <span className="flex items-center gap-1.5 rounded-full border border-red-400/15 bg-red-400/[.07] px-2.5 py-1 text-[10px] text-red-300">
                  <Ban size={10} /> Frozen
                </span>
              )}
              {!isFrozen && (
                <span className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[.04] px-2.5 py-1 text-[11px] text-[var(--text-secondary)]">
                  <i className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Active
                </span>
              )}
            </div>
          </div>
          <p className="mb-1.5 text-xs font-medium text-[var(--text-secondary)]">Available to spend</p>
          <motion.div key={spendable} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex min-w-0 items-center gap-2.5">
              <VantaCoinIcon size={24} className="shrink-0 text-[var(--vanta-gold)]" />
              <h2 className="min-w-0 break-all text-[clamp(1.75rem,8vw,2.6rem)] font-semibold leading-tight tracking-tight text-[var(--vanta-gold-bright)] tabular-nums">
                {displayCoins(spendable)}
              </h2>
            </div>
            <p className="mt-1.5 text-xs font-medium text-[var(--text-secondary)]">VANTA Coins</p>
            <p className="mt-2 text-xs text-[var(--text-secondary)]">Platform currency · not a cash withdrawal balance</p>
            <dl className="mt-4 space-y-2 border-t border-[var(--border)] pt-3 text-sm">
              <div className="flex items-center justify-between gap-3"><dt>Total coins</dt><dd className="tabular-nums">{displayCoins(coinBalance)}</dd></div>
              <div className="flex items-center justify-between gap-3"><dt>Locked / reserved coins</dt><dd className="tabular-nums">{displayCoins(wallet.lockedCoins)}</dd></div>
              <div className="flex items-center justify-between gap-3"><dt>Pending transactions</dt><dd className="tabular-nums">{pendingCount === undefined ? 'Unavailable' : displayCoins(pendingCount)}</dd></div>
              {pendingRows?.filter(row => row.count > 0).map(row => <div key={row.currency} className="flex items-center justify-between gap-3 text-xs text-[var(--text-secondary)]"><dt>Pending {row.currency} ledger total</dt><dd>{row.currency === 'USD' ? displayUsd(row.amount) : displayCoins(row.amount) + ' ' + row.currency}</dd></div>)}
              {isCreator && <><div className="flex items-center justify-between gap-3"><dt>Creator earnings</dt><dd>{displayUsd(earningsBalance)}</dd></div><div className="flex items-center justify-between gap-3"><dt>Pending withdrawals (net)</dt><dd>{typeof wallet?.pendingWithdrawals?.netUsd === 'number' ? displayUsd(wallet.pendingWithdrawals.netUsd) : 'Unavailable'}</dd></div></>}
            </dl>
          </motion.div>

          {isFrozen && <p role="status" className="mt-3 rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-300">Your wallet is frozen. Transfers and withdrawals are unavailable.</p>}
          {!isFrozen && !limits && <p className="mt-2 text-xs text-[var(--text-secondary)]">Transfer limits unavailable. Refresh before sending.</p>}
          {/* Quick Actions */}
          <div className="mt-4 grid w-full grid-cols-4 gap-1.5">
            <button
              onClick={() => setShowBuyModal(true)}
              className="flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 rounded-lg bg-[var(--vanta-gold)] px-2 py-2.5 text-xs font-bold text-black transition active:scale-[.98] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus size={16} />
               Buy
            </button>
            <button
              onClick={() => setShowSendModal(true)}
              disabled={isFrozen || transferBudget <= 0}
              className="flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 rounded-lg border border-white/[0.08] bg-[var(--surface-secondary)] px-2 py-2.5 text-xs font-medium text-[var(--text-primary)] active:scale-[.98] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ArrowUpRight size={16} className="text-[var(--vanta-gold-bright)]" />
               Send
            </button>
            <button type="button" onClick={() => setShowReceiveModal(true)} className="flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-secondary)] px-1 py-2 text-xs font-medium"><ArrowDownLeft size={18} className="text-[var(--vanta-gold-bright)]"/>Receive</button>
            <button
              disabled={isFrozen || spendable <= 0}
              onClick={() => router.push('/gifts')}
              className="flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 rounded-lg border border-white/[0.08] bg-[var(--surface-secondary)] px-2 py-2.5 text-xs font-medium text-[var(--text-primary)] active:scale-[.98] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Gift size={16} className="text-[var(--vanta-gold-bright)]" />
              Gift
            </button>
            {isCreator && earningsBalance > 0 && (
              <button
                onClick={() => setShowWithdrawModal(true)} disabled={isFrozen}
                className="col-span-4 flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 rounded-lg border border-white/[0.08] bg-[var(--surface-secondary)] px-2 py-2.5 text-xs font-medium text-[var(--text-primary)] active:scale-[.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ArrowUpFromLine size={16} className="text-[var(--vanta-gold-bright)]" />
                Withdraw {hideBalance ? '••••' : displayUsd(earningsBalance)}
              </button>
            )}
          </div>


          <div className="mt-3 flex items-center gap-2 border-t border-white/[.06] pt-2.5 text-[11px] text-[var(--text-secondary)]">
            <Lock size={14} />
            Protected by VANTA Balance security
          </div>
        </div>
      </motion.section>

      {recipientLinkError && <p role="alert" className="rounded-xl bg-[var(--surface)] p-3 text-sm text-red-300">{recipientLinkError}</p>}
      {historyErrors.length > 0 && <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-400/20 bg-[var(--surface)] p-3 text-sm text-[var(--text-secondary)]"><span>Could not load: {historyErrors.join(', ')}.</span><button type="button" onClick={fetchWallet} className="min-h-11 font-semibold text-[var(--vanta-gold-bright)]">Retry</button></div>}
      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Balance summary">
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
            className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3.5"
          >
            <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--active-soft)] text-[var(--vanta-gold-bright)]">
              {stat.icon}
            </div>
            <p className="truncate text-lg font-semibold tabular-nums text-[var(--text-primary)]">{hideBalance ? hidden : stat.value}</p>
            <p className="mt-0.5 truncate text-[11px] font-medium text-[var(--text-secondary)]">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex w-full min-w-0 items-center gap-1 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 scrollbar-hide">
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
            onClick={() => changeTab(tab.id as BalanceTab)}
            aria-pressed={activeTab === tab.id}
            type="button"
            className={cn(
               'flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-[11px] font-semibold whitespace-nowrap transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--vanta-gold-bright)]',
              activeTab === tab.id ? 'bg-[var(--vanta-gold)] text-black' : 'text-[var(--text-secondary)] hover:text-white'
            )}
          >
            <span className="shrink-0">{tab.icon}</span>
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
          {token && <WalletActivity token={token} hidden={hideBalance}/>}
          {/* Recent Transactions */}
          <section className="rounded-xl border border-white/[0.07] bg-[var(--surface)] p-3">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <History size={16} className="text-[var(--vanta-gold-bright)]" />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Recent activity</h2>
              </div>
              <button
                onClick={() => changeTab('transactions')}
                className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-white transition"
              >
                View all <ChevronRight size={12} />
              </button>
            </div>

            {hideBalance ? <p className="text-sm text-[var(--text-secondary)]">Recent transactions hidden.</p> : historyErrors.includes('Transactions') ? <p className="py-4 text-sm text-[var(--text-secondary)]">Transaction history could not load.</p> : recentTx.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <History size={28} className="text-[var(--vanta-gold-bright)] opacity-65 mb-3" />
                <p className="text-sm text-[var(--text-secondary)]">No transactions yet.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {recentTx.map((tx: any) => {
                  const isIncoming = tx.isIncoming ?? INCOMING_TYPES.has(tx.type);
                  const displayAmount = typeof tx.displayAmount === 'number' ? tx.displayAmount : (isIncoming ? (tx.amount ?? 0) : -(tx.amount ?? 0));
                  const sign = displayAmount >= 0 ? '+' : '-';
                  const isUsd = tx.currency === 'USD';
                  const formattedAmount = isUsd ? Math.abs(displayAmount).toFixed(2) : Math.abs(displayAmount).toLocaleString();
                  return (
                    <button
                      key={tx.id}
                      onClick={() => {setReceiptNotice(''); setSelectedTx(tx);}}
                      className="flex min-h-14 w-full items-center gap-3 rounded-lg p-2 text-left transition hover:bg-white/[0.03]"
                    >
                      <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center border shrink-0', getTxColor(tx.type))}>
                        {getTxIcon(tx.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                          {tx.description || formatTxLabel(tx.type)}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                          <span className="text-[11px] text-[var(--text-secondary)]">
                            {formatDate(tx.createdAt)} · {formatTime(tx.createdAt)}
                          </span>
                          <span className="text-[11px] text-[var(--text-secondary)]">·</span>
                          <span className="text-[11px] text-[var(--text-secondary)]">{formatTxLabel(tx.type)}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={cn('text-sm font-bold tabular-nums', isIncoming ? 'text-emerald-400' : 'text-[var(--text-primary)]')}>
                          {sign}{isUsd ? '$' : ''}{formattedAmount}
                        </p>
                        <p className="text-[11px] text-[var(--text-secondary)]">{tx.status}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Recent Gifts */}
          <section className="rounded-xl border border-white/[0.07] bg-[var(--surface)] p-3">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Gift size={16} className="text-[var(--vanta-gold-bright)]" />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Recent gifts</h2>

              </div>
              <button
                onClick={() => changeTab('gifts')}
                className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-white transition"
              >
                View all <ChevronRight size={12} />
              </button>
            </div>

            {hideBalance ? <p className="text-sm text-[var(--text-secondary)]">Gift activity hidden.</p> : historyErrors.includes('Gifts') ? <p className="py-4 text-sm text-[var(--text-secondary)]">Gift history could not load.</p> : recentGifts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Gift size={28} className="text-[var(--vanta-gold-bright)] opacity-65 mb-3" />
                <p className="text-sm text-[var(--text-secondary)]">No gift activity yet.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {recentGifts.map((gift: any) => {
                  const isIncoming = gift.isIncoming;
                  const counterparty = isIncoming ? gift.sender : gift.receiver;
                  const displayName = counterparty?.fullName || counterparty?.username || 'Unknown';
                  return (
                    <div key={gift.id} className="flex items-center gap-4 p-3 rounded-lg hover:bg-white/[0.03] transition-colors">
                      <div className="w-9 h-9 rounded-lg bg-white/[0.035] flex items-center justify-center shrink-0">
                        {gift.gift ? <GiftArtwork slug={gift.gift.slug} name={gift.gift.name} size={38} quality={giftVisualQuality(gift.gift)} /> : <Gift size={16} className="text-[var(--vanta-gold-bright)]" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                          {isIncoming ? `Received ${gift.gift?.name || 'Gift'} from ` : `Sent ${gift.gift?.name || 'Gift'} to `}
                          <span className="text-[var(--text-secondary)]">{displayName}</span>
                        </p>
                        <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                          {formatDate(gift.createdAt)} · {formatTime(gift.createdAt)}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={cn('text-sm font-bold', isIncoming ? 'text-emerald-400' : 'text-[var(--text-primary)]')}>
                          {isIncoming ? '+' : '-'}{(gift.amount ?? 0).toLocaleString()}
                        </p>
                        <p className="text-[11px] text-[var(--text-secondary)]">{isIncoming ? 'Received' : 'Sent'}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Creator Earnings Preview */}
          {isCreator && (
            <section className="rounded-lg border border-white/[0.08] bg-[var(--surface)] p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <TrendingUp size={16} className="text-[var(--vanta-gold-bright)]" />
                  <h2 className="text-base font-bold text-[var(--text-primary)]">Creator Earnings</h2>
                </div>
                <button
                  onClick={() => changeTab('earnings')}
                  className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-white transition"
                >
                  View all <ChevronRight size={12} />
                </button>
              </div>
              <div className="grid grid-cols-2  gap-3">
                <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-4">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">Available</p>
                  <p className="mt-1 text-xl font-bold text-[var(--text-primary)]">{displayUsd(earningsBalance)}</p>
                </div>
                <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-4">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">Lifetime</p>
                  <p className="mt-1 text-xl font-bold text-[var(--text-primary)]">{displayUsd(lifetimeEarnings)}</p>
                </div>
                <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-4">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">Withdrawn</p>
                  <p className="mt-1 text-xl font-bold text-[var(--text-primary)]">{displayUsd(totalWithdrawn)}</p>
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
              <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search transactions..."
                aria-label="Search all transactions" maxLength={120}
                className="w-full rounded-2xl border border-white/[0.06] bg-white/[0.04] py-2.5 pl-10 pr-4 text-sm text-[var(--text-primary)] placeholder-[#8A8A8A] outline-none transition-all"
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
                    aria-pressed={filter === f.id}
                    className={cn(
                      'min-h-11 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all',
                      filter === f.id ? 'bg-[var(--vanta-gold)] text-black' : 'text-[var(--text-secondary)] hover:text-white'
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <button
                onClick={handleExport}
                disabled={exporting || historyLoading || Boolean(historyError) || transactionTotal === 0 || hideBalance}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08] text-[11px] text-[var(--text-secondary)] hover:text-white disabled:opacity-50 transition-all"
              >
                {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                {exporting ? 'Exporting…' : 'Export CSV'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs"><label className="min-w-0">Status<select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg bg-[var(--surface)] p-2"><option value="">All statuses</option>{['COMPLETED','PENDING','FAILED','REVERSED'].map(s=><option key={s} value={s}>{s}</option>)}</select></label><label className="min-w-0">Direction<select value={directionFilter} onChange={e=>setDirectionFilter(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg bg-[var(--surface)] p-2"><option value="">All directions</option><option value="incoming">Incoming</option><option value="outgoing">Outgoing</option></select></label><label className="min-w-0">From<input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} className="mt-1 min-h-11 w-full min-w-0 rounded-lg bg-[var(--surface)] p-2"/></label><label className="min-w-0">To<input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} className="mt-1 min-h-11 w-full min-w-0 rounded-lg bg-[var(--surface)] p-2"/></label></div>
          {exportError && <p role="alert" className="text-sm text-red-300">{exportError}</p>}
          <p role="status" className="text-xs text-[var(--text-secondary)]">{hideBalance ? 'History hidden by wallet privacy.' : `${historyRows.length} of ${transactionTotal} matching transactions loaded. CSV exports up to 10,000 matching records.`}</p>
          {/* Transaction List */}
          {hideBalance ? null : historyLoading ? <p role="status">Loading transactions…</p> : historyError ? <p role="alert" className="text-sm">{historyError} <button type="button" onClick={()=>setHistoryRetry(v=>v+1)} className="min-h-11 text-[var(--vanta-gold-bright)]">Retry</button></p> : filteredTx.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center rounded-3xl bg-white/[0.02] border border-white/[0.04]">
              <History size={32} className="text-[var(--vanta-gold-bright)] opacity-65 mb-3" />
              <h3 className="text-[var(--text-primary)] font-medium text-base mb-1">{hasFilters ? 'No matching transactions' : 'No transactions yet'}</h3>
              <p className="text-[var(--text-secondary)] text-sm max-w-xs">
                 {hasFilters ? 'Try another search or clear the filters.' : 'Your transaction history will appear here when you buy, send, or receive VANTA Coins.'}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredTx.map((tx: any, i: number) => {
                const isIncoming = tx.isIncoming ?? INCOMING_TYPES.has(tx.type);
                const displayAmount = typeof tx.displayAmount === 'number' ? tx.displayAmount : (isIncoming ? (tx.amount ?? 0) : -(tx.amount ?? 0));
                const sign = displayAmount >= 0 ? '+' : '-';
                const isUsd = tx.currency === 'USD';
                const formattedAmount = isUsd ? Math.abs(displayAmount).toFixed(2) : Math.abs(displayAmount).toLocaleString();
                return (
                  <div key={tx.id}>
                  {(i === 0 || formatDate(filteredTx[i-1].createdAt) !== formatDate(tx.createdAt)) && <h3 className="px-2 pt-3 text-xs font-semibold text-[var(--text-secondary)]">{formatDate(tx.createdAt)}</h3>}
                  <motion.button
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(i * 0.02, 0.5) }}
                    onClick={() => {setReceiptNotice(''); setSelectedTx(tx);}}
                    className="w-full flex items-center gap-4 p-4 rounded-lg hover:bg-white/[0.03] transition-colors text-left"
                  >
                    <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center border shrink-0', getTxColor(tx.type))}>
                      {getTxIcon(tx.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                        {tx.description || formatTxLabel(tx.type)}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-[11px] text-[var(--text-secondary)]">
                          {formatDate(tx.createdAt)} · {formatTime(tx.createdAt)}
                        </span>
                        <span className="text-[11px] text-[var(--text-secondary)]">·</span>
                        <span className="text-[11px] text-[var(--text-secondary)]">{formatTxLabel(tx.type)}</span>
                        {tx.fee > 0 && (
                          <>
                            <span className="text-[11px] text-[var(--text-secondary)]">·</span>
                            <span className="text-[10px] text-amber-400/70">Fee: {tx.currency === 'USD' ? '$' + Number(tx.fee).toFixed(2) : tx.fee.toLocaleString()}</span>
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
                      <p className={cn('text-sm font-bold tabular-nums', isIncoming ? 'text-emerald-400' : 'text-[var(--text-primary)]')}>
                        {sign}{isUsd ? '$' : ''}{formattedAmount}
                      </p>
                      <p className="text-[11px] text-[var(--text-secondary)]">Balance: {isUsd ? '$' : ''}{isUsd ? Number(tx.balance ?? 0).toFixed(2) : (tx.balance ?? 0).toLocaleString()}</p>
                    </div>
                  </motion.button>
                  </div>
                );
              })}
            </div>
          )}
          {hasFilters && <button type="button" onClick={clearFilters} className="min-h-11 px-3 text-sm font-semibold text-[var(--vanta-gold-bright)]">Clear filters</button>}
          {moreError && <p role="alert" className="text-sm text-red-300">{moreError}</p>}
          {!hideBalance && !historyLoading && !historyError && transactionOffset < transactionTotal && <button type="button" onClick={loadMore} disabled={loadingMore} className="min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] text-sm font-semibold text-[var(--vanta-gold-bright)] disabled:opacity-50">{loadingMore ? 'Loading…' : 'Load older transactions'}</button>}
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
              <Gift size={16} className="text-[var(--vanta-gold-bright)]" />
              <h2 className="text-lg font-bold text-[var(--text-primary)]">Gift History</h2>
            </div>
            <button
              onClick={() => router.push('/gifts')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.05] border border-white/[0.08] text-xs text-[var(--text-secondary)] hover:text-white transition-all"
            >
              <Gift size={12} />
              Open Gift Store
            </button>
          </div>

          {historyErrors.includes('Gifts') ? <p className="py-4 text-sm text-[var(--text-secondary)]">Gift history could not load. Use Retry above.</p> : gifts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center rounded-3xl bg-white/[0.02] border border-white/[0.04]">
              <Gift size={32} className="text-[var(--vanta-gold-bright)] opacity-65 mb-3" />
              <h3 className="text-[var(--text-primary)] font-medium text-base mb-1">No gift activity yet</h3>
              <p className="text-[var(--text-secondary)] text-sm max-w-xs">
                You haven&apos;t sent or received any gifts yet. Support creators during their live streams!
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {sortedGifts.map((gift: any, i: number) => {
                const isIncoming = gift.isIncoming;
                const counterparty = isIncoming ? gift.sender : gift.receiver;
                const displayName = counterparty?.fullName || counterparty?.username || 'Unknown';
                return (
                  <motion.div
                    key={gift.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(i * 0.02, 0.5) }}
                    className="flex items-center gap-4 p-4 rounded-lg hover:bg-white/[0.03] transition-colors"
                  >
                    <div className="w-9 h-9 rounded-lg bg-white/[0.035] flex items-center justify-center shrink-0">
                      {gift.gift ? <GiftArtwork slug={gift.gift.slug} name={gift.gift.name} size={38} quality={giftVisualQuality(gift.gift)} /> : <Gift size={16} className="text-[var(--vanta-gold-bright)]" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                        {isIncoming ? `Received ${gift.gift?.name || 'Gift'} from ` : `Sent ${gift.gift?.name || 'Gift'} to `}
                        <span className="text-[var(--text-secondary)]">{displayName}</span>
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                        <span className="text-[11px] text-[var(--text-secondary)]">
                          {formatDate(gift.createdAt)} · {formatTime(gift.createdAt)}
                        </span>
                        {gift.streamId && (
                          <>
                            <span className="text-[11px] text-[var(--text-secondary)]">·</span>
                            <span className="text-[11px] text-[var(--text-secondary)]">Live Stream</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={cn('text-sm font-bold', isIncoming ? 'text-emerald-400' : 'text-[var(--text-primary)]')}>
                        {isIncoming ? '+' : '-'}{(gift.amount ?? 0).toLocaleString()}
                      </p>
                      <p className="text-[11px] text-[var(--text-secondary)]">{isIncoming ? 'Received' : 'Sent'}</p>
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
              { label: 'Available', value: `${displayUsd(earningsBalance)}`, icon: <DollarSign size={16} /> },
              { label: 'Lifetime', value: `${displayUsd(lifetimeEarnings)}`, icon: <TrendingUp size={16} /> },
              { label: 'Withdrawn', value: `${displayUsd(totalWithdrawn)}`, icon: <ArrowUpFromLine size={16} /> },
              { label: 'Gifts Received', value: totalGiftsReceived.toLocaleString(), icon: <Gift size={16} /> },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4"
              >
                <div className="w-8 h-8 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-[var(--text-secondary)] mb-2">
                  {stat.icon}
                </div>
                <p className="text-lg font-bold text-[var(--text-primary)]">{hideBalance ? hidden : stat.value}</p>
                <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">{stat.label}</p>
              </motion.div>
            ))}
          </div>

          {earningsBalance > 0 && (
            <button
              onClick={() => setShowWithdrawModal(true)} disabled={isFrozen}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-[var(--vanta-gold)] text-black text-sm font-bold hover:bg-[var(--vanta-gold-bright)] transition-all"
            >
              <ArrowUpFromLine size={16} />
              Withdraw {displayUsd(earningsBalance)}
            </button>
          )}

          {earningsBalance === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center rounded-3xl bg-white/[0.02] border border-white/[0.04]">
              <TrendingUp size={32} className="text-[var(--vanta-gold-bright)] opacity-65 mb-3" />
              <h3 className="text-[var(--text-primary)] font-medium text-base mb-1">No earnings yet</h3>
              <p className="text-[var(--text-secondary)] text-sm max-w-xs">
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
              <ArrowUpFromLine size={16} className="text-[var(--vanta-gold-bright)]" />
              <h2 className="text-lg font-bold text-[var(--text-primary)]">Withdrawal History</h2>
            </div>
            {earningsBalance > 0 && (
              <button
                onClick={() => setShowWithdrawModal(true)} disabled={isFrozen}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--vanta-gold)] text-black text-xs font-bold hover:bg-[var(--vanta-gold-bright)] transition-all"
              >
                <ArrowUpFromLine size={12} />
                Withdraw
              </button>
            )}
          </div>

          {historyErrors.includes('Withdrawals') ? <p className="py-4 text-sm text-[var(--text-secondary)]">Withdrawal history could not load. Use Retry above.</p> : withdrawals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center rounded-3xl bg-white/[0.02] border border-white/[0.04]">
              <ArrowUpFromLine size={32} className="text-[var(--vanta-gold-bright)] opacity-65 mb-3" />
              <h3 className="text-[var(--text-primary)] font-medium text-base mb-1">No withdrawals yet</h3>
              <p className="text-[var(--text-secondary)] text-sm max-w-xs">
                Your withdrawal history will appear here when you request a payout.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {withdrawals.map((wd: any) => (
                <div key={wd.id} className="flex items-center gap-4 p-4 rounded-lg hover:bg-white/[0.03] transition-colors">
                  <div className="w-9 h-9 rounded-lg bg-white/[0.035] flex items-center justify-center shrink-0">
                    <ArrowUpFromLine size={16} className="text-[var(--vanta-gold-bright)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--text-primary)]">
                      Withdrawal of ${wd.amount.toFixed(2)}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                      <span className="text-[11px] text-[var(--text-secondary)]">
                        {formatDate(wd.createdAt)} · {formatTime(wd.createdAt)}
                      </span>
                      <span className="text-[11px] text-[var(--text-secondary)]">·</span>
                      <span className="text-[11px] text-[var(--text-secondary)]">Fee: ${wd.fee.toFixed(2)}</span>
                      <span className="text-[11px] text-[var(--text-secondary)]">·</span>
                      <span className="text-[11px] text-[var(--text-secondary)]">Net: ${wd.netAmount.toFixed(2)}</span>
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
              <Shield size={16} className="text-[var(--vanta-gold-bright)]" />
              <h2 className="text-base font-bold text-[var(--text-primary)]">Balance Security</h2>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div className="rounded-2xl bg-white/[0.03] border border-white/[0.04] p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-[var(--text-secondary)]">Wallet PIN</span>
                  <span className={cn('text-xs', hasPin ? 'text-emerald-400' : 'text-amber-400')}>
                    {hasPin ? 'Set' : 'Not Set'}
                  </span>
                </div>
                <p className="text-[11px] text-[var(--text-secondary)]">
                  {hasPin ? 'Your PIN protects transfers and withdrawals.' : 'Set a PIN to protect your transfers and withdrawals.'}
                </p>
                <button type="button" onClick={() => router.push('/settings/payments')} className="mt-2 min-h-11 text-sm font-semibold text-[var(--vanta-gold-bright)]">{hasPin ? 'Manage wallet PIN' : 'Set wallet PIN'}</button>
              </div>

              <div className="rounded-2xl bg-white/[0.03] border border-white/[0.04] p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-[var(--text-secondary)]">Two-Factor Auth</span>
                  <span className="text-xs text-[var(--text-secondary)]">{twoFactor === null ? 'Unavailable' : twoFactor ? 'Enabled' : 'Not enabled'}</span>
                </div>
                <p className="text-[11px] text-[var(--text-secondary)]">
                  {twoFactor ? 'An authenticator protects sensitive account actions.' : 'Manage two-factor authentication in account settings.'}
                </p>
                <button type="button" onClick={() => router.push('/settings')} className="mt-2 min-h-11 text-sm font-semibold text-[var(--vanta-gold-bright)]">Account settings</button>
              </div>

              <div className="rounded-2xl bg-white/[0.03] border border-white/[0.04] p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-[var(--text-secondary)]">USDT Wallet</span>
                  <span className={cn('text-xs', usdtWalletAddress ? 'text-emerald-400' : 'text-[var(--text-secondary)]')}>
                    {usdtWalletAddress ? 'Connected' : 'Not Set'}
                  </span>
                </div>
                <p className="text-[11px] text-[var(--text-secondary)] truncate">
                  {usdtWalletAddress ? `${usdtWalletAddress.slice(0, 6)}…${usdtWalletAddress.slice(-4)}` : 'Connect a USDT (BEP-20) wallet for withdrawals.'}
                </p>
                <button type="button" onClick={() => router.push('/settings/payments')} className="mt-2 min-h-11 text-sm font-semibold text-[var(--vanta-gold-bright)]">Manage payout address</button>
              </div>

              <div className="rounded-2xl bg-white/[0.03] border border-white/[0.04] p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-[var(--text-secondary)]">Account Status</span>
                  <span className={cn('text-xs', isFrozen ? 'text-red-400' : 'text-emerald-400')}>
                    {isFrozen ? 'Frozen' : 'Active'}
                  </span>
                </div>
                <p className="text-[11px] text-[var(--text-secondary)]">
                  {isFrozen ? 'Your balance is frozen. Contact support.' : 'Your balance is active and secure.'}
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4" aria-label="Wallet transfer limits"><h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Shield size={16} className="text-[var(--vanta-gold-bright)]"/>Transfer limits</h2>{limits ? <dl className="space-y-2 text-xs"><div className="flex justify-between gap-2"><dt>Daily limit</dt><dd>{displayCoins(limits.dailyLimit)}</dd></div><div className="flex justify-between gap-2"><dt>Remaining today (UTC)</dt><dd>{displayCoins(limits.dailyRemaining)}</dd></div><div className="flex justify-between gap-2"><dt>Single transfer limit</dt><dd>{displayCoins(limits.singleTxLimit)}</dd></div><p className="text-[var(--text-secondary)]">Limits include transfer fees.</p></dl> : <p className="text-xs text-[var(--text-secondary)]">Unavailable. Refresh wallet.</p>}</section>
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
              className="fixed inset-x-0 top-[max(12px,env(safe-area-inset-top))] bottom-[max(12px,env(safe-area-inset-bottom))] z-[101] mx-auto flex min-h-0 w-[calc(100%-1.5rem)] max-w-[456px] flex-col overflow-hidden rounded-3xl border border-white/[0.08] bg-[var(--background-secondary)] shadow-2xl backdrop-blur-2xl"
              role="dialog"
              aria-modal="true"
              aria-label="Transaction details"
              ref={detailsRef}
              tabIndex={-1}
            >
              <div className="flex items-center justify-between px-4 py-4 sm:px-6 border-b border-white/[0.06] shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center">
                    {getTxIcon(selectedTx.type)}
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-[var(--text-primary)]">Transaction Details</h2>
                    <p className="text-[11px] text-[var(--text-secondary)]">{formatTxLabel(selectedTx.type)}</p>
                  </div>
                </div>
                <button onClick={() => setSelectedTx(null)} className="rounded-xl p-2 text-[var(--text-secondary)] hover:text-white hover:bg-white/[0.05] transition" aria-label="Close">
                  <X size={18} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-hide p-4 sm:p-6 space-y-4">
                <div className="text-center">
                  <p className={cn('text-3xl font-bold tabular-nums', selectedTx.isIncoming ? 'text-emerald-400' : 'text-[var(--text-primary)]')}>
                    {selectedTx.isIncoming ? '+' : '-'}{selectedTx.currency === 'USD' ? '$' : ''}{selectedTx.currency === 'USD' ? Math.abs(selectedTx.displayAmount ?? selectedTx.amount ?? 0).toFixed(2) : Math.abs(selectedTx.displayAmount ?? selectedTx.amount ?? 0).toLocaleString()}
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">{selectedTx.currency === 'USD' ? 'USD / USDT' : 'VANTA Coins'}</p>
                </div>

                <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] p-4 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--text-secondary)]">Type</span>
                    <span className="font-medium text-[var(--text-primary)]">{formatTxLabel(selectedTx.type)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--text-secondary)]">Amount</span>
                    <span className="font-medium text-[var(--text-primary)]">{selectedTx.currency === 'USD' ? '$' : ''}{selectedTx.currency === 'USD' ? Math.abs(selectedTx.amount ?? 0).toFixed(2) : Math.abs(selectedTx.amount ?? 0).toLocaleString()}</span>
                  </div>
                  {selectedTx.fee > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[var(--text-secondary)]">Fee</span>
                      <span className="font-medium text-[var(--text-primary)]">{selectedTx.currency === 'USD' ? '$' : ''}{selectedTx.currency === 'USD' ? selectedTx.fee.toFixed(2) : selectedTx.fee.toLocaleString()}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--text-secondary)]">Status</span>
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
                    <span className="text-[var(--text-secondary)]">Date</span>
                    <span className="font-medium text-[var(--text-primary)]">{formatDate(selectedTx.createdAt)} · {formatTime(selectedTx.createdAt)}</span>
                  </div>
                  {selectedTx.counterparty && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[var(--text-secondary)]">Counterparty</span>
                      <span className="font-medium text-[var(--text-primary)]">@{selectedTx.counterparty.username}</span>
                    </div>
                  )}
                  <div className="flex justify-between gap-2 text-xs"><span>Transaction ID</span><span className="max-w-[65%] break-all text-right font-mono">{selectedTx.id}</span></div>
                  {selectedTx.reference && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[var(--text-secondary)]">Reference</span>
                      <span className="font-medium text-[var(--text-primary)] font-mono text-xs break-all max-w-[65%] text-right">{selectedTx.reference}</span>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2"><button type="button" onClick={async()=>{try{await navigator.clipboard.writeText(selectedTx.reference || selectedTx.id);setReceiptNotice('Reference copied.');}catch{setReceiptNotice('Copy unavailable. Select the displayed reference instead.');}}} className="min-h-11 rounded-lg bg-[var(--surface)] text-xs">Copy reference</button><button type="button" onClick={()=>downloadReceipt(selectedTx)} className="min-h-11 rounded-lg bg-[var(--vanta-gold)] text-xs font-semibold text-black">Download record</button></div>
                {receiptNotice && <p role="status" className="text-xs">{receiptNotice}</p>}
                {selectedTx.description && (
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{selectedTx.description}</p>
                )}
              </div>

              <div className="shrink-0 border-t border-white/[0.06] px-4 py-4 sm:px-6">
                <button
                  onClick={() => setSelectedTx(null)}
                  className="w-full py-2.5 rounded-2xl bg-white/[0.05] border border-white/[0.08] text-sm font-medium text-[var(--text-primary)] hover:bg-white/[0.08] transition-all"
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
        balance={spendable}
        transferBudget={transferBudget}
        dailyRemaining={limits?.dailyRemaining}
        initialRecipientId={initialRecipientId}
        onClose={() => { setShowSendModal(false); setInitialRecipientId(null); }}
        onSuccess={handleSuccess}
      />

      <ReceiveCoinsModal open={showReceiveModal} onClose={() => setShowReceiveModal(false)} />

      <WithdrawModal
        open={showWithdrawModal}
        balance={earningsBalance}
        walletAddress={usdtWalletAddress}
        onClose={() => setShowWithdrawModal(false)}
        onSuccess={handleSuccess}
      />
    </motion.div>
    </MotionConfig>
  );
}