'use client';

import { motion } from 'framer-motion';
import { CheckCircle2, ShieldCheck, Sparkles } from 'lucide-react';
import VantaCoinIcon from '@/components/ui/VantaCoinIcon';
import { formatUsdFromCoins } from '@/lib/wallet';

interface WalletBalanceCardProps {
  coinBalance: number;
  pendingBalance: number;
  lockedBalance: number;
  usdtBalance: number;
  earningsBalance: number;
  totalPortfolioValue: number;
  walletAddress?: string;
  isConnected: boolean;
  securityStatus: {
    twoFactor: boolean;
    deviceVerified: boolean;
    lastLogin?: string;
  };
  onBuyCoins?: () => void;
  onSendCoins?: () => void;
  onReceiveCoins?: () => void;
  onTransactions?: () => void;
}

export default function WalletBalanceCard({
  coinBalance,
  isConnected,
  securityStatus,
}: WalletBalanceCardProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-[28px] border border-white/[0.08] bg-[#101010]/80 px-6 py-8 shadow-[0_24px_80px_rgba(0,0,0,.28)] backdrop-blur-2xl  "
      aria-label="Available VANTA balance"
    >
      <div className="pointer-events-none absolute -right-24 -top-32 h-64 w-64 rounded-full bg-white/[0.04] blur-3xl" />
      <div className="relative">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-white/45"><Sparkles size={14} className="text-[#b8b8b8]" /> VANTA Wallet</div>
          <div className="flex gap-2">
            {isConnected && <span className="flex items-center gap-1.5 rounded-full border border-emerald-400/15 bg-emerald-400/[.07] px-2.5 py-1 text-[10px] text-emerald-300"><i className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Connected</span>}
            {(securityStatus.deviceVerified || securityStatus.twoFactor) && <span className="flex items-center gap-1 rounded-full border border-emerald-400/15 bg-emerald-400/[.07] px-2.5 py-1 text-[10px] text-emerald-300"><CheckCircle2 size={11} />Verified</span>}
          </div>
        </div>
        <p className="mb-2 text-sm font-medium text-white/45">Available balance</p>
        <motion.div key={coinBalance} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center gap-3"><VantaCoinIcon size={30} className="text-[#d8d8d8]" /><h2 className="text-[clamp(2.35rem,8vw,4.5rem)] font-semibold leading-none tracking-[-.055em] text-white tabular-nums">{coinBalance.toLocaleString()}</h2></div>
          <p className="mt-3 text-base font-medium text-white/35 ">VANTA</p>
          <p className="mt-5 text-xl font-medium tracking-tight text-white/70">≈ {formatUsdFromCoins(coinBalance)} <span className="text-sm text-white/30">USD</span></p>
        </motion.div>
        <div className="mt-8 flex items-center gap-2 border-t border-white/[.06] pt-5 text-xs text-white/30"><ShieldCheck size={14} className="text-[#b8b8b8]" /> Protected by VANTA wallet security</div>
      </div>
    </motion.section>
  );
}