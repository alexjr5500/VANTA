'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Copy, Check, QrCode, User, Wallet, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import VantaCoinIcon from '@/components/ui/VantaCoinIcon';

interface ReceiveCoinsModalProps {
  open: boolean;
  walletId: string;
  onClose: () => void;
}

export default function ReceiveCoinsModal({ open, walletId, onClose }: ReceiveCoinsModalProps) {
  const { user } = useAuth();
  const [copied, setCopied] = useState<'wallet' | 'username' | null>(null);

  const walletAddress = walletId || user?.id || '';

  const handleCopy = (type: 'wallet' | 'username') => {
    const text = type === 'wallet' ? walletAddress : `@${user?.username || ''}`;
    if (text) {
      navigator.clipboard.writeText(text);
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-md"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 30 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-x-0 top-[max(12px,env(safe-area-inset-top))] bottom-[max(12px,env(safe-area-inset-bottom))] z-[101] mx-auto flex min-h-0 w-[calc(100%-1.5rem)] max-w-[456px] flex-col overflow-hidden rounded-3xl border border-white/[0.08] bg-[#0e0e16]/95 shadow-2xl backdrop-blur-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="Receive VANTA"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/[0.08] border border-white/[0.1] flex items-center justify-center">
                  <VantaCoinIcon size={18} className="text-[#d8d8d8]" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Receive VANTA</h2>
                  <p className="text-[10px] text-gray-500">Share your wallet details</p>
                </div>
              </div>
              <button onClick={onClose} className="rounded-xl p-2 text-gray-400 hover:text-white hover:bg-white/[0.05] transition" aria-label="Close">
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto scrollbar-hide p-6 space-y-5">
              {/* QR Code */}
              <div className="flex flex-col items-center">
                <div className="relative w-48 h-48 rounded-3xl bg-white p-3 shadow-2xl">
                  {/* Placeholder QR - in production use a QR library */}
                  <div className="w-full h-full rounded-2xl bg-gradient-to-br from-[#0e0e16] to-[#1a1a2e] flex items-center justify-center">
                    <QrCode size={80} className="text-white" />
                  </div>
                  <div className="absolute inset-0 rounded-3xl ring-1 ring-white/10" />
                </div>
                <p className="text-[10px] text-white/30 mt-3">Scan to receive VANTA</p>
              </div>

              {/* Wallet ID */}
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/30 font-semibold mb-2">Wallet ID</p>
                <div className="flex items-center gap-2 p-3 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
                  <Wallet size={14} className="text-white/30 shrink-0" />
                  <code className="flex-1 text-xs text-white/60 font-mono truncate">{walletAddress}</code>
                  <button
                    onClick={() => handleCopy('wallet')}
                    className="shrink-0 p-2 rounded-lg hover:bg-white/[0.05] transition"
                    aria-label="Copy wallet ID"
                  >
                    {copied === 'wallet' ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} className="text-gray-400" />}
                  </button>
                </div>
              </div>

              {/* Username */}
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/30 font-semibold mb-2">Username</p>
                <div className="flex items-center gap-2 p-3 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
                  <User size={14} className="text-white/30 shrink-0" />
                  <span className="flex-1 text-sm text-white/60 truncate">@{user?.username || 'username'}</span>
                  <button
                    onClick={() => handleCopy('username')}
                    className="shrink-0 p-2 rounded-lg hover:bg-white/[0.05] transition"
                    aria-label="Copy username"
                  >
                    {copied === 'username' ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} className="text-gray-400" />}
                  </button>
                </div>
              </div>

              {/* Info */}
              <div className="flex items-start gap-2 text-[10px] text-white/30 bg-white/[0.02] border border-white/[0.04] rounded-xl p-3">
                <Shield size={10} className="shrink-0 mt-0.5 text-emerald-400" />
                <p>Anyone with your Wallet ID or @username can send you VANTA. Never share your login credentials or PIN.</p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}