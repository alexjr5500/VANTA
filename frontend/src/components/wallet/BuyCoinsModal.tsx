'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Copy, Check, ExternalLink, Loader2, Clock, Shield, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPost } from '@/lib/apiClient';
import VantaCoinIcon from '@/components/ui/VantaCoinIcon';
import UsdtIcon from '@/components/ui/UsdtIcon';
import UsdcIcon from '@/components/ui/UsdcIcon';
import { VANTA_COIN_PACKAGES } from '@/lib/wallet';


interface CoinPackage {
  id: string;
  name: string;
  coins: number;
  price: number;
  bonusCoins?: number;
  isPopular?: boolean;
  badge?: string | null;
}

const APPROVED_PACKAGE_IDS = new Set(VANTA_COIN_PACKAGES.map(pkg => pkg.id));

interface PaymentNetwork {
  id: string;
  name: string;
  token: string;
  network: string;
  icon: string;
  estimatedTime: string;
  contractAddress: string;
}

interface BuyCoinsModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (coins: number) => void;
}

const PAYMENT_NETWORKS: (PaymentNetwork & { iconComponent: React.ReactNode })[] = [
  {
    id: 'usdt-bep20',
    name: 'USDT',
    token: 'USDT',
    network: 'BNB Smart Chain (BEP-20)',
    icon: '',
    iconComponent: <UsdtIcon size={20} />,
    estimatedTime: '1-3 minutes',
    contractAddress: '0x55d398326f99059fF775485246999027B3197955',
  },
  {
    id: 'usdc-base',
    name: 'USDC',
    token: 'USDC',
    network: 'Base Network',
    icon: '',
    iconComponent: <UsdcIcon size={20} />,
    estimatedTime: '1-3 minutes',
    contractAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
];

export default function BuyCoinsModal({ open, onClose, onSuccess }: BuyCoinsModalProps) {
  const { token } = useAuth();
  const [step, setStep] = useState<'packages' | 'payment' | 'confirming' | 'success'>('packages');
  const [packages, setPackages] = useState<CoinPackage[]>([]);
  const [selectedPackage, setSelectedPackage] = useState<CoinPackage | null>(null);
  const [selectedNetwork, setSelectedNetwork] = useState<PaymentNetwork | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [paymentAddress, setPaymentAddress] = useState<string>('');
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [orderId, setOrderId] = useState<string>('');

  // Fetch packages from backend
  useEffect(() => {
    if (!open || !token) return;
    setLoading(true);
    setError(null);
    setStep('packages');
    setSelectedPackage(null);
    setSelectedNetwork(null);
    setOrderId('');
    
    apiGet<any>('/api/wallets/packages', token)
      .then(data => {
        const pkgList = Array.isArray(data) ? data : data?.packages ?? data?.data ?? [];
        const approvedPackages = pkgList.filter((pkg: CoinPackage) => APPROVED_PACKAGE_IDS.has(pkg.id as typeof VANTA_COIN_PACKAGES[number]['id']));
        if (approvedPackages.length === VANTA_COIN_PACKAGES.length) {
          setPackages(approvedPackages.map((pkg: CoinPackage) => ({
            ...pkg,
            isPopular: pkg.isPopular || pkg.badge === 'MOST_POPULAR' || pkg.badge === 'BEST_VALUE',
          })));
        } else {
          setPackages([...VANTA_COIN_PACKAGES]);
        }
      })
      .catch(() => {
        setPackages([...VANTA_COIN_PACKAGES]);
      })
      .finally(() => setLoading(false));
  }, [open, token]);

  const handleSelectPackage = (pkg: CoinPackage) => {
    setSelectedPackage(pkg);
    setStep('payment');
    setPaymentAmount(pkg.price);
  };

  const handleSelectNetwork = async (network: PaymentNetwork) => {
    setSelectedNetwork(network);
    setError(null);
    
    if (!token || !selectedPackage) return;
    
    try {
      const data = await apiPost<any>('/api/wallets/payment-address', {
        packageId: selectedPackage.id,
        network: network.id,
        amount: selectedPackage.price,
      }, token);
      
      if (!data?.address || !data?.orderId) throw new Error('The payment provider did not return complete payment details.');
      setPaymentAddress(data.address);
      setOrderId(data.orderId);
    } catch (err: any) {
      setSelectedNetwork(null);
      setPaymentAddress('');
      setOrderId('');
      setError(err?.message || 'This payment network is temporarily unavailable. Choose another network or try again.');
    }
  };

  const handleCopyAddress = () => {
    if (paymentAddress) {
      navigator.clipboard.writeText(paymentAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleConfirmPayment = async () => {
    if (!token || !selectedPackage || !selectedNetwork || !orderId || !txHash?.trim()) return;
    setConfirming(true);
    setError(null);
    setStep('confirming');
    
    try {
      const result = await apiPost<any>('/api/wallets/verify-payment', {
        orderId,
        txHash: txHash.trim(),
      }, token);

      if (!result?.success) {
        setError(result?.message || 'Payment is awaiting provider verification.');
        setStep('payment');
        return;
      }
      setStep('success');
      
      if (onSuccess) {
        onSuccess(selectedPackage.coins + (selectedPackage.bonusCoins || 0));
      }
    } catch (err: any) {
      setError(err.message || 'Payment verification failed. Please contact support.');
      setStep('payment');
    } finally {
      setConfirming(false);
    }
  };

  const handleClose = () => {
    setStep('packages');
    setSelectedPackage(null);
    setSelectedNetwork(null);
    setError(null);
    setTxHash(null);
    setOrderId('');
    setConfirming(false);
    onClose();
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
            onClick={handleClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 30 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-x-0 bottom-0 top-[5dvh] z-[101] mx-auto flex w-full max-w-[480px] flex-col overflow-hidden rounded-t-xl border border-white/[0.08] bg-[#101010] shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="Buy VANTA Coins"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3 pb-[calc(.75rem+env(safe-area-inset-top))]">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--vanta-gold)]/30 bg-[var(--vanta-gold)]/[0.08]">
                  <VantaCoinIcon size={18} className="text-[var(--vanta-gold)]" />
                </div>
                <div>
                   <h2 className="text-base font-bold text-white">Buy VANTA Coins</h2>
                  <p className="text-[10px] text-gray-500">
                    {step === 'packages' && 'Choose a VANTA Coin package'}
                    {step === 'payment' && 'Complete your payment'}
                    {step === 'confirming' && 'Verifying transaction'}
                    {step === 'success' && 'Purchase complete'}
                  </p>
                </div>
              </div>
              <button onClick={handleClose} className="rounded-xl p-2 text-gray-400 hover:text-white hover:bg-white/[0.05] transition" aria-label="Close">
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto overscroll-contain scrollbar-hide px-4 py-4">
              {/* Step 1: Select Package */}
              {step === 'packages' && (
                <div className="space-y-3">
                  {loading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 size={24} className="animate-spin text-[var(--vanta-gold)]" />
                    </div>
                  ) : (
                    packages.map((pkg, i) => (
                      <motion.button
                        key={pkg.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03 }}
                        onClick={() => handleSelectPackage(pkg)}
                        className={cn(
                           'flex min-h-16 w-full items-center justify-between gap-3 rounded-md border p-3 text-left transition-all',
                          selectedPackage?.id === pkg.id
                             ? 'border-[var(--vanta-gold)]/40 bg-[var(--vanta-gold)]/[0.06]'
                            : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.12]'
                        )}
                      >
                         <div className="flex min-w-0 items-center gap-3">
                           <div className="flex h-10 w-10 items-center justify-center rounded-md border border-white/[0.1] bg-white/[0.04]">
                             <VantaCoinIcon size={16} className="text-[var(--vanta-gold)]" />
                          </div>
                           <div className="min-w-0">
                             <p className="truncate text-sm font-semibold text-white">{pkg.name}</p>
                             <p className="truncate text-xs text-white/40">
                              {pkg.coins.toLocaleString()} VANTA Coins
                              {pkg.bonusCoins ? ` + ${pkg.bonusCoins} bonus` : ''}
                            </p>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-bold text-white">${pkg.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                          {pkg.isPopular && (

                            <span className="rounded px-1.5 py-0.5 text-[9px] font-bold text-[var(--vanta-gold)]">
                              Best Value
                            </span>
                          )}
                        </div>
                      </motion.button>
                    ))
                  )}
                </div>
              )}

              {/* Step 2: Payment */}
              {step === 'payment' && selectedPackage && (
                <div className="space-y-5">
                  {/* Selected Package Summary */}
                  <div className="rounded-md border border-white/[0.08] bg-[#161616] p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-white/40">Package</span>
                      <span className="text-sm font-semibold text-white">{selectedPackage.name}</span>
                    </div>
                    <div className="flex items-center justify-between mb-2">
                       <span className="text-xs text-white/40">VANTA Coins</span>
                      <span className="text-sm font-semibold text-white">
                        {selectedPackage.coins.toLocaleString()}
                        {selectedPackage.bonusCoins ? ` + ${selectedPackage.bonusCoins} bonus` : ''}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-white/40">Total Price</span>
                      <span className="text-sm font-bold text-[var(--vanta-gold)]">${selectedPackage.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  </div>

                  {/* Select Network */}
                  <div>
                    <p className="text-xs font-medium text-white/50 mb-2">Select Payment Network</p>
                    <div className="space-y-2">
                      {PAYMENT_NETWORKS.map(network => (
                        <button
                          key={network.id}
                          onClick={() => handleSelectNetwork(network)}
                          className={cn(
                             'flex w-full items-center gap-3 rounded-md border p-3.5 text-left transition-all',
                            selectedNetwork?.id === network.id
                               ? 'border-white/25 bg-white/[0.07]'
                              : 'border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.05]'
                          )}
                        >
                          <span className="text-xl">{network.iconComponent}</span>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-white">{network.token}</p>
                            <p className="text-[10px] text-white/40">{network.network}</p>
                          </div>
                          <div className="text-right">
                            <div className="flex items-center gap-1 text-[10px] text-emerald-400">
                              <Clock size={10} />
                              {network.estimatedTime}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Payment Details */}
                  {selectedNetwork && paymentAddress && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                     className="space-y-3 rounded-md border border-white/[0.1] bg-[#161616] p-4"
                    >
                       <p className="text-xs font-semibold uppercase text-[var(--vanta-gold)]">Send payment</p>
                      
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-white/40">Network</span>
                          <span className="text-white font-medium">{selectedNetwork.network}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-white/40">Token</span>
                          <span className="text-white font-medium">{selectedNetwork.token}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-white/40">Amount</span>
                          <span className="text-white font-bold">${paymentAmount.toFixed(2)}</span>
                        </div>
                      </div>

                      {/* Wallet Address */}
                      <div>
                        <p className="text-[10px] text-white/30 mb-1.5">Send to this address:</p>
                        <div className="flex items-center gap-2 p-2.5 rounded-xl bg-black/40 border border-white/[0.06]">
                          <code className="flex-1 text-[10px] text-white/60 font-mono truncate">
                            {paymentAddress}
                          </code>
                          <button
                            onClick={handleCopyAddress}
                            className="shrink-0 p-1.5 rounded-lg hover:bg-white/[0.05] transition"
                          >
                            {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} className="text-gray-400" />}
                          </button>
                        </div>
                      </div>

                      {/* Transaction Hash Input */}
                      <div>
                        <p className="text-[10px] text-white/30 mb-1.5">Transaction Hash (after sending):</p>
                        <input
                          value={txHash || ''}
                          onChange={e => setTxHash(e.target.value)}
                          placeholder="0x..."
                          className="w-full rounded-xl border border-white/[0.06] bg-black/40 px-3 py-2.5 text-xs text-white placeholder-gray-600 font-mono outline-none focus:border-emerald-500/30 transition-all"
                        />
                      </div>

                      <div className="flex items-start gap-2 text-[10px] text-white/30">
                        <AlertCircle size={10} className="shrink-0 mt-0.5" />
                        <p>Send exactly ${paymentAmount.toFixed(2)} worth of {selectedNetwork.token} on {selectedNetwork.network}. Your coins will be credited automatically after confirmation.</p>
                      </div>
                    </motion.div>
                  )}

                  {error && (
                    <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                      <AlertCircle size={14} />
                      {error}
                    </div>
                  )}
                </div>
              )}

              {/* Step 3: Confirming */}
              {step === 'confirming' && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                   className="mb-4 flex h-16 w-16 items-center justify-center rounded-lg border border-white/[0.12] bg-[#161616]"
                  >
                     <Loader2 size={28} className="text-[var(--vanta-gold)]" />
                  </motion.div>
                  <h3 className="text-lg font-bold text-white mb-2">Verifying Transaction</h3>
                  <p className="text-sm text-white/40 max-w-xs">
                    Please wait while we confirm your payment on the blockchain. This usually takes 1-3 minutes.
                  </p>
                  <div className="mt-6 flex items-center gap-2 text-xs text-white/30">
                    <Shield size={12} />
                    Secured by blockchain
                  </div>
                </div>
              )}

              {/* Step 4: Success */}
              {step === 'success' && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                   className="mb-4 flex h-20 w-20 items-center justify-center rounded-lg border border-[var(--vanta-gold)]/30 bg-[var(--vanta-gold)]/[0.06]"
                  >
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.2 }}
                      className="text-4xl"
                    >
                      <VantaCoinIcon size={16} className="inline-block text-[#d8d8d8]" />
                    </motion.span>
                  </motion.div>
                  <motion.h3
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="text-xl font-bold text-white mb-2"
                  >
                    Purchase Complete!
                  </motion.h3>
                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                    className="text-sm text-white/40 max-w-xs"
                  >
                    {selectedPackage?.coins.toLocaleString()} VANTA
                    {selectedPackage?.bonusCoins ? ` + ${selectedPackage.bonusCoins} bonus` : ''} have been added to your wallet.
                  </motion.p>
                  {txHash && (
                    <motion.a
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.5 }}
                      href={`https://bscscan.com/tx/${txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 flex items-center gap-1.5 text-xs text-[#c8c8cc] hover:text-[#f5f5f5] transition-colors"
                    >
                      <ExternalLink size={12} />
                      View on Explorer
                    </motion.a>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="shrink-0 border-t border-white/[0.06] px-6 py-4">
              {step === 'packages' && (
                <p className="text-center text-[10px] text-white/20">
                  Secured by blockchain · Instant delivery · No hidden fees
                </p>
              )}
              {step === 'payment' && selectedNetwork && (
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => { setStep('packages'); setSelectedNetwork(null); setError(null); }}
                    className="flex-1 rounded-2xl border border-white/[0.06] bg-white/[0.04] py-2.5 text-sm font-medium text-gray-300 hover:text-white hover:bg-white/[0.08] transition"
                  >
                    Back
                  </button>
                  <motion.button
                    onClick={handleConfirmPayment}
                    disabled={confirming || !txHash}
                    whileTap={{ scale: 0.97 }}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-2 rounded-2xl py-2.5 text-sm font-bold transition-all',
                      !confirming && txHash
                         ? 'bg-[var(--vanta-gold)] text-black'
                        : 'bg-white/[0.05] text-gray-500 cursor-not-allowed'
                    )}
                  >
                    {confirming ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <>
                        <Check size={14} />
                        Confirm Payment
                      </>
                    )}
                  </motion.button>
                </div>
              )}
              {step === 'success' && (
                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.6 }}
                  onClick={handleClose}
                   className="w-full rounded-md bg-[var(--vanta-gold)] py-2.5 text-sm font-bold text-black"
                >
                  Done
                </motion.button>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}