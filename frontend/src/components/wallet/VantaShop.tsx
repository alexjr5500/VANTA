'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, CreditCard, Gift, Pencil, Search, User, X, Copy, WalletCards, Bitcoin } from 'lucide-react';
import VantaCoinIcon from '@/components/ui/VantaCoinIcon';
import VerificationBadge from '@/components/ui/VerificationBadge';
import { useAuth } from '@/context/AuthContext';
import { API_BASE_URL, authHeaders } from '@/lib/api';
import { getBadgePurchasePlans, type BadgePurchasePlan } from '@/lib/verificationApi';
import { useWalletDialog } from './useWalletDialog';

type Product = 'coins' | 'badge';
type Pack = { id: string; coins: number; price: number };
type Recipient = { id: string; username: string; fullName?: string };
type Invoice = { orderId: string; amount: number; currency: string; network: string; expiresAt: string; coins?: number; planId?: string; product?: Product } & ({ mode: 'test'; simulateToken: string } | { mode: 'live'; address: string; paymentUri: string; qrCode: string; token: string; tokenAmount: string });
type PendingInvoice = { orderId: string; product: Product; network: string; amount: number; expiresAt: string };
type Step = 'choose' | 'payment' | 'token' | 'invoice' | 'waiting' | 'card' | 'success';
type CardOrder = { orderId: string; product: Product; amount: number; expiresAt: string; checkoutUrl?: string | null; status?: string };
function cardFrom(value: unknown): CardOrder {
  const a = obj(value);
  if (a.mode !== 'card-test' || typeof a.orderId !== 'string' || (a.product !== 'coins' && a.product !== 'badge') || typeof a.amount !== 'number' || !Number.isFinite(a.amount) || a.amount <= 0 || typeof a.expiresAt !== 'string') throw new Error('Invalid card order');
  if (a.checkoutUrl != null) {
    if (typeof a.checkoutUrl !== 'string') throw new Error('Invalid checkout link');
    const u = new URL(a.checkoutUrl);
    if (u.protocol !== 'https:' || u.hostname !== 'checkout.stripe.com' || u.username || u.password || u.port || !u.pathname.startsWith('/c/pay/cs_test_')) throw new Error('Invalid checkout link');
  }
  return a as CardOrder;
}
const networks = [
  { id: 'eth-erc20', label: 'ETH', chain: 'Ethereum (native)', enabled: false },
  { id: 'usdt-trc20', label: 'USDT', chain: 'Tron (TRC-20)', enabled: false },
  { id: 'usdt-erc20', label: 'USDT', chain: 'Ethereum (ERC-20)', enabled: false },
  { id: 'usdt-bep20', label: 'USDT', chain: 'BNB Smart Chain (BEP-20)', enabled: true },
  { id: 'usdc-base', label: 'USDC', chain: 'Base', enabled: true },
  { id: 'gram-ton', label: 'GRAM', chain: 'TON', enabled: false },
];
const packageOrder = [100, 250, 500, 1000, 2500, 5000, 10000, 25000];
const usd = (n: number) => 'USD ' + n.toFixed(2);
const cardClass = 'rounded-[12px] bg-[#212529] border border-transparent';
const muted = 'text-[#95979b]';
function obj(v: unknown): Record<string, unknown> {
  if (typeof v !== 'object' || v === null) throw new Error('Invalid server response');
  return v as Record<string, unknown>;
}
function packagesFrom(v: unknown): Pack[] {
  const data = obj(v);
  if (!Array.isArray(data.packages)) throw new Error('Invalid package catalog');
  return data.packages.filter((p: unknown): p is Pack => {
    if (typeof p !== 'object' || p === null) return false;
    const a = p as Record<string, unknown>;
    return typeof a.id === 'string' && typeof a.coins === 'number' && Number.isSafeInteger(a.coins) && a.coins > 0 && typeof a.price === 'number' && Number.isFinite(a.price) && a.price > 0;
  });
}
function recipientsFrom(v: unknown): Recipient[] {
  const data = obj(v);
  if (!Array.isArray(data.users)) return [];
  return data.users.filter((p: unknown): p is Recipient => {
    if (typeof p !== 'object' || p === null) return false;
    const a = p as Record<string, unknown>;
    return typeof a.id === 'string' && typeof a.username === 'string';
  });
}
function invoiceFrom(v: unknown): Invoice {
  const a = obj(v);
  if (typeof a.orderId !== 'string' || typeof a.amount !== 'number' || !Number.isFinite(a.amount) || a.amount <= 0 || a.currency !== 'USD' || typeof a.network !== 'string' || typeof a.expiresAt !== 'string' || !Number.isFinite(Date.parse(a.expiresAt))) throw new Error('Invalid invoice.');
  if (a.mode === 'test' && typeof a.simulateToken === 'string') return a as Invoice;
  if (a.mode === 'live' && typeof a.address === 'string' && (/^0x[0-9a-f]{40}$/i.test(a.address) || (a.network === 'usdt-trc20' && /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a.address))) && typeof a.paymentUri === 'string' && ((a.network === 'usdt-trc20' && a.paymentUri === a.address) || /^ethereum:0x[0-9a-f]{40}@[0-9]+\/transfer\?address=0x[0-9a-f]{40}&uint256=[0-9]+$/i.test(a.paymentUri) || (a.network === 'eth-erc20' && /^ethereum:0x[0-9a-f]{40}@1\?value=[1-9][0-9]*$/i.test(a.paymentUri))) && typeof a.qrCode === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(a.qrCode) && typeof a.token === 'string' && typeof a.tokenAmount === 'string') return a as Invoice;
  throw new Error('Invalid payment invoice.');
}
async function request(path: string, token: string, body?: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(API_BASE_URL + path, { headers: { ...authHeaders(token), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), cache: 'no-store' });
  const data: unknown = await response.json();
  if (!response.ok) { const a = obj(data); throw new Error(typeof a.error === 'string' ? a.error : typeof a.message === 'string' ? a.message : 'Request failed'); }
  return data;
}
function Choice({ selected, disabled, icon, title, detail, onClick }: { selected: boolean; disabled?: boolean; icon: React.ReactNode; title: React.ReactNode; detail?: React.ReactNode; onClick: () => void }) {
  return <button type="button" aria-pressed={selected} disabled={disabled} onClick={onClick} className={'flex w-full min-h-[58px] items-center gap-3 rounded-[12px] border p-3 text-left disabled:opacity-50 ' + (selected ? 'border-white bg-[#212529]' : 'border-transparent bg-[#212529]')}>
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#191d21]">{icon}</span><span className="min-w-0 flex-1"><span className="block text-[15px] font-medium leading-5">{title}</span>{detail && <span className={'mt-1 block text-[13px] leading-4 ' + muted}>{detail}</span>}</span>
    <span className={'grid h-[17px] w-[17px] shrink-0 place-items-center rounded-[4px] border ' + (selected ? 'border-white bg-white text-[#17191d]' : 'border-white')}>{selected && <Check size={13} strokeWidth={3}/>}</span>
  </button>;
}
interface Props { open: boolean; initialProduct: Product; initialPlan?: BadgePurchasePlan | null; onClose: () => void; onCoinsSuccess?: (coins: number) => void; onBadgeSuccess?: () => void; }
export default function VantaShop({ open, initialProduct, initialPlan, onClose, onCoinsSuccess, onBadgeSuccess }: Props) {
  const { token } = useAuth();
  const [product, setProduct] = useState<Product>(initialProduct);
  const [step, setStep] = useState<Step>('choose');
  const [packs, setPacks] = useState<Pack[]>([]);
  const [plans, setPlans] = useState<BadgePurchasePlan[]>([]);
  const [packId, setPackId] = useState('');
  const [planId, setPlanId] = useState('');
  const [custom, setCustom] = useState('');
  const [rate, setRate] = useState<number | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [availableCoins, setAvailableCoins] = useState<number | null>(null);
  const [coinBadge, setCoinBadge] = useState(false);
  const [walletPin, setWalletPin] = useState('');
  const [coinReceipt, setCoinReceipt] = useState<{ orderId: string; coinsSpent: number } | null>(null);
  const coinRequest = useRef<{ selection: string; key: string } | null>(null);
  const [gift, setGift] = useState(false);
  const [query, setQuery] = useState('');
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [searching, setSearching] = useState(false);
  const [renew, setRenew] = useState(false);
  const [method, setMethod] = useState<'card' | 'crypto' | 'coins'>('crypto');
  const [network, setNetwork] = useState('usdt-bep20');
  const [networkSearch, setNetworkSearch] = useState('');
  const [sandbox, setSandbox] = useState(false);
  const [liveCrypto, setLiveCrypto] = useState(false);
  const [liveNetworks, setLiveNetworks] = useState<string[]>([]);
  const [cardTest, setCardTest] = useState(false);
  const [cardOrder, setCardOrder] = useState<CardOrder | null>(null);
  const [pendingCards, setPendingCards] = useState<CardOrder[]>([]);
  const [pendingInvoices, setPendingInvoices] = useState<PendingInvoice[]>([]);
  const [txHash, setTxHash] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('PENDING');
  const [qrExpanded, setQrExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [copied, setCopied] = useState('');
  const [resultCoins, setResultCoins] = useState(0);
  const actionLock = useRef(false);
  const close = () => { if (!actionLock.current) { if (step === 'success') { if (product === 'coins') onCoinsSuccess?.(resultCoins); else onBadgeSuccess?.(); } onClose(); } };
  const dialog = useWalletDialog<HTMLElement>(open, close, busy, step);
  useEffect(() => {
    if (!open || !token) return;
    let active = true;
    setProduct(initialProduct); setStep('choose'); setPackId(''); setPlanId(initialPlan?.id || ''); setGift(false); setRecipient(null); setQuery(''); setRecipients([]); setRenew(false); setCustom(''); setInvoice(null); setError(''); setSandbox(false); setLiveCrypto(false); setLiveNetworks([]); setCardTest(false); setCardOrder(null); setPendingCards([]); setPendingInvoices([]); setTxHash(''); setPaymentStatus('PENDING'); setQrExpanded(false); setPacks([]); setPlans([]); setRate(null); setBalance(null); setAvailableCoins(null); setCoinBadge(false); setWalletPin(''); setCoinReceipt(null); coinRequest.current = null; setMethod('crypto'); setNetwork('usdt-bep20'); setLoading(true);
    Promise.allSettled([
      request('/api/wallets/packages', token).then(data => ({ packs: packagesFrom(data), rate: obj(data).exchangeRate })),
      getBadgePurchasePlans(token),
      request('/api/wallets/shop-capabilities', token),
      request('/api/wallets/me', token),
    ]).then(([p, v, s, b]) => {
      if (!active) return;
      if (p.status === 'fulfilled') {
        setPacks(p.value.packs);
        const r = p.value.rate;
        if (r && typeof r === 'object' && 'coinsPerUsd' in r && typeof r.coinsPerUsd === 'number' && Number.isFinite(r.coinsPerUsd) && r.coinsPerUsd > 0) setRate(r.coinsPerUsd);
      }
      if (v.status === 'fulfilled') setPlans(v.value);
      if (s.status === 'fulfilled') {
        const capabilities = obj(s.value);
        setSandbox(capabilities.sandbox === true);
        setCoinBadge(capabilities.coinBadge === true);
        setLiveCrypto(capabilities.liveCrypto === true);
        if (Array.isArray(capabilities.cryptoNetworks)) setLiveNetworks(capabilities.cryptoNetworks.filter((v: unknown): v is string => typeof v === 'string'));
        const webCard = capabilities.cardTest === true && !/VANTAAndroid/i.test(navigator.userAgent);
        setCardTest(webCard);
        if (webCard) {
          request('/api/wallets/shop/card/checkouts', token).then(data => {
            if (!active) return;
            const entries = obj(data).checkouts;
            if (Array.isArray(entries)) setPendingCards(entries.filter((v: unknown): v is CardOrder => {
              if (!v || typeof v !== 'object') return false;
              const p = v as Record<string, unknown>;
              return typeof p.orderId === 'string' && (p.product === 'coins' || p.product === 'badge') && typeof p.amount === 'number' && typeof p.expiresAt === 'string';
            }));
          }).catch(() => { if (active) setError('Could not load pending card orders.'); });
          const url = new URL(window.location.href);
          const orderId = url.searchParams.get('shopCard');
          if (orderId) {
            request('/api/wallets/shop/card/checkouts/' + encodeURIComponent(orderId), token).then(data => {
              if (!active) return;
              const next = cardFrom(data);
              setCardOrder(next); setProduct(next.product); setMethod('card'); setStep('card'); setPaymentStatus(next.status || 'PENDING');
              url.searchParams.delete('shopCard'); window.history.replaceState(window.history.state, '', url.toString());
            }).catch(() => { if (active) setError('Could not recover card order.'); });
          }
        }
        if (capabilities.liveCrypto === true) request('/api/wallets/shop/crypto/invoices', token).then(data => {
          if (!active) return;
          const entries = obj(data).invoices;
          if (Array.isArray(entries)) setPendingInvoices(entries.filter((v: unknown): v is PendingInvoice => {
            if (!v || typeof v !== 'object') return false;
            const p = v as Record<string, unknown>;
            return typeof p.orderId === 'string' && (p.product === 'coins' || p.product === 'badge') && typeof p.network === 'string' && typeof p.amount === 'number' && typeof p.expiresAt === 'string';
          }));
        }).catch(() => { if (active) setError('Could not load pending invoices.'); });
      }
      if (b.status === 'fulfilled') { const raw = obj(b.value); const w = raw.wallet && typeof raw.wallet === 'object' ? obj(raw.wallet) : raw; if (typeof w.coinBalance === 'number') setBalance(w.coinBalance); if (typeof w.availableCoins === 'number') setAvailableCoins(w.availableCoins); }
      if (p.status === 'rejected' || v.status === 'rejected') setError('Some product prices could not be loaded. Reopen the shop to retry.');
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : 'Unable to load shop'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, token, initialProduct, initialPlan?.id]);
  useEffect(() => {
    if (!open || !token || !gift || recipient || query.trim().replace(/^@/, '').length < 2) { setRecipients([]); setSearching(false); return; }
    let active = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      request('/api/wallets/users/search?q=' + encodeURIComponent(query.trim().replace(/^@/, '')), token)
        .then(data => { if (active) setRecipients(recipientsFrom(data)); })
        .catch(() => { if (active) setRecipients([]); })
        .finally(() => { if (active) setSearching(false); });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [open, token, gift, recipient, query]);
  useEffect(() => {
    if (!open || !invoice) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open, invoice]);
  useEffect(() => {
    if (!open || !token || invoice?.mode !== 'live' || (step !== 'invoice' && step !== 'waiting')) return;
    let active = true;
    const poll = async () => {
      try {
        const result = obj(await request('/api/wallets/shop/crypto/invoices/' + encodeURIComponent(invoice.orderId) + '/status', token));
        if (!active) return;
        if (typeof result.status === 'string') setPaymentStatus(result.status);
        if (result.success === true && result.status === 'COMPLETED') {
          setResultCoins(typeof result.coins === 'number' ? result.coins : 0);
          setStep('success'); setError('');
        }
      } catch { /* Keep the invoice visible for manual retry. */ }
    };
    void poll();
    const timer = window.setInterval(poll, 8000);
    return () => { active = false; window.clearInterval(timer); };
  }, [open, token, invoice, step]);
  const selectedPack = packs.find(p => p.id === packId);
  const customNumber = Number(custom);
  const customValid = /^\d+$/.test(custom) && Number.isSafeInteger(customNumber) && customNumber >= 100 && customNumber <= 100000 && rate !== null;
  const quantity = packId === 'custom' ? (customValid ? customNumber : 0) : selectedPack?.coins || 0;
  const plan = plans.find(p => p.id === planId);
  const price = product === 'badge' ? plan?.priceUSD : packId === 'custom' ? customValid && rate ? Math.round(customNumber / rate * 100) / 100 : undefined : selectedPack?.price;
  const ready = !loading && typeof price === 'number' && price > 0 && (product === 'badge' ? !!plan : quantity > 0) && (!gift || !!recipient);
  const remaining = invoice ? Math.max(0, Math.ceil((Date.parse(invoice.expiresAt) - clock) / 1000)) : 0;
  const countdown = Math.floor(remaining / 60).toString().padStart(2, '0') + ':' + (remaining % 60).toString().padStart(2, '0');
  const networkEnabled = (id: string) => sandbox ? networks.some(n => n.id === id && n.enabled) : liveCrypto && liveNetworks.includes(id);
  const networkInfo = networks.find(n => n.id === network);
  const recipientLabel = gift ? recipient ? '@' + recipient.username : 'Choose recipient' : 'You';
  const productLabel = product === 'badge' ? plan?.name || 'Verification Badge' : (invoice?.coins || quantity).toLocaleString() + ' VANTA Coins';
  const selectProduct = (p: Product) => { setProduct(p); setStep('choose'); setError(''); setRenew(false); setMethod('crypto'); };
  const go = (s: Step) => { setError(''); setStep(s); };
  const clipboard = async (value: string) => { try { await navigator.clipboard.writeText(value); setCopied(value); } catch { setError('Clipboard unavailable. Select and copy manually.'); } };
  const paste = async () => { try { setRecipient(null); setQuery((await navigator.clipboard.readText()).trim()); } catch { setError('Paste the username into the field manually.'); } };
  const badgeCost = product === 'badge' && plan && rate ? Math.round(plan.priceUSD * rate) : null;
  const canPay = !renew && (method === 'card' ? cardTest : method === 'coins' ? coinBadge && badgeCost !== null && availableCoins !== null && availableCoins >= badgeCost && /^[0-9]{4,6}$/.test(walletPin) : method === 'crypto' && (sandbox || (liveCrypto && !gift)) && networkEnabled(network));
  async function resumeCard(orderId: string) {
    if (!token || actionLock.current) return;
    actionLock.current = true; setBusy(true); setError('');
    try {
      const next = cardFrom(await request('/api/wallets/shop/card/checkouts/' + encodeURIComponent(orderId), token));
      setCardOrder(next); setProduct(next.product); setMethod('card'); setStep('card'); setPaymentStatus(next.status || 'PENDING');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not recover checkout'); }
    finally { actionLock.current = false; setBusy(false); }
  }
  async function checkCard() {
    if (!token || !cardOrder || !cardTest || actionLock.current) return;
    actionLock.current = true; setBusy(true); setError('');
    try {
      const result = obj(await request('/api/wallets/shop/card/checkouts/' + encodeURIComponent(cardOrder.orderId) + '/check', token, {}));
      setPaymentStatus(typeof result.status === 'string' ? result.status : 'PENDING');
      if (result.success === true && result.status === 'COMPLETED') { setResultCoins(typeof result.coins === 'number' ? result.coins : 0); setStep('success'); }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not confirm card payment'); }
    finally { actionLock.current = false; setBusy(false); }
  }
  async function resumePending(orderId: string) {
    if (!token || actionLock.current) return;
    actionLock.current = true; setBusy(true); setError('');
    try {
      const next = invoiceFrom(await request('/api/wallets/shop/crypto/invoices/' + encodeURIComponent(orderId), token));
      if (next.mode !== 'live' || !next.product) throw new Error('Invalid pending invoice');
      setProduct(next.product); setNetwork(next.network); setGift(false); setRenew(false);
      if (next.product === 'coins' && next.coins) { setPackId('custom'); setCustom(String(next.coins)); }
      if (next.planId) setPlanId(next.planId);
      setInvoice(next); setTxHash(''); setPaymentStatus('PENDING'); setClock(Date.now()); setStep('invoice');
    } catch (e) { setError(e instanceof Error ? e.message : 'Cannot resume invoice'); }
    finally { actionLock.current = false; setBusy(false); }
  }
  async function start() {
    if (!token || !ready || !canPay || actionLock.current) return;
    actionLock.current = true; setBusy(true); setError('');
    try {
      if (method === 'coins') {
        if (badgeCost === null || !plan || !coinBadge) throw new Error('Coin badge checkout unavailable');
        const selection = JSON.stringify([plan.id, gift ? recipient?.id : null, badgeCost]);
        if (coinRequest.current?.selection !== selection) coinRequest.current = { selection, key: crypto.randomUUID() };
        const result = obj(await request('/api/wallets/shop/badges/coins', token, {
          planId: plan.id, expectedCoins: badgeCost, requestKey: coinRequest.current.key, pin: walletPin,
          ...(gift && recipient ? { recipientId: recipient.id } : {}),
        }));
        if (result.success !== true || result.mode !== 'coin-test' || result.coinsSpent !== badgeCost || typeof result.orderId !== 'string') throw new Error('Unable to verify coin purchase');
        setCoinReceipt({ orderId: result.orderId, coinsSpent: badgeCost }); setWalletPin('');
        if (typeof result.balance === 'number') setBalance(result.balance);
        if (typeof result.availableCoins === 'number') setAvailableCoins(result.availableCoins);
        setStep('success');
        return;
      }
      if (method === 'card') {
        const next = cardFrom(await request('/api/wallets/shop/card/checkouts', token, { product, ...(product === 'coins' ? { packageId: packId, ...(packId === 'custom' ? { customCoins: quantity } : {}) } : { planId }), ...(gift && recipient ? { recipientId: recipient.id } : {}) }));
        if (next.amount !== price || next.product !== product || !next.checkoutUrl) throw new Error('Checkout price changed or payment link unavailable.');
        setCardOrder(next); setPaymentStatus('PENDING'); setStep('card');
        return;
      }
      const data = liveCrypto && !sandbox
        ? await request('/api/wallets/shop/crypto/invoices', token, { product, network, ...(product === 'coins' ? { packageId: packId, ...(packId === 'custom' ? { customCoins: quantity } : {}) } : { planId }) })
        : product === 'coins'
        ? await request('/api/wallets/payment-address', token, { packageId: packId, network, ...(packId === 'custom' ? { customCoins: quantity } : {}), ...(gift && recipient ? { recipientId: recipient.id } : {}) })
        : await request('/api/verification/purchase/init', token, { planId, network, ...(gift && recipient ? { recipientId: recipient.id } : {}) });
      const next = invoiceFrom(data);
      if (next.amount !== price || next.network !== network || next.mode !== (sandbox ? 'test' : 'live')) throw new Error('The price or network changed. Reopen the shop and review the catalog.');
      setInvoice(next); setTxHash(''); setPaymentStatus('PENDING'); setClock(Date.now()); setStep('invoice');
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to initialize checkout'); }
    finally { actionLock.current = false; setBusy(false); }
  }
  async function confirm() {
    if (!token || !invoice || (invoice.mode === 'test' ? !sandbox : !liveCrypto) || remaining <= 0 || actionLock.current) return;
    actionLock.current = true; setBusy(true); setError(''); setStep('waiting');
    try {
      const result = obj(invoice.mode === 'live'
        ? await request('/api/wallets/shop/crypto/invoices/' + encodeURIComponent(invoice.orderId) + '/check', token, txHash.trim() ? { txHash: txHash.trim() } : {})
        : await request(product === 'coins' ? '/api/wallets/verify-payment' : '/api/verification/purchase/verify', token, { orderId: invoice.orderId, testConfirmation: true, simulateToken: invoice.simulateToken, ...(product === 'coins' ? { txHash: 'sandbox:' + invoice.orderId } : {}) }));
      if (typeof result.status === 'string') setPaymentStatus(result.status);
      if (result.success === true) { setResultCoins(typeof result.coins === 'number' ? result.coins : quantity); setStep('success'); }
      else setError(typeof result.message === 'string' ? result.message : 'Awaiting server confirmation.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to verify checkout'); }
    finally { actionLock.current = false; setBusy(false); }
  }
  if (!open) return null;
  const footerButton = (label: string, onClick: () => void, disabled = false) => <button type="button" onClick={onClick} disabled={disabled || busy} className="min-h-12 w-full rounded-[12px] bg-white px-3 py-3 text-[15px] font-semibold text-black disabled:bg-[#484a50] disabled:text-[#1b1c20]">{busy ? 'Processing…' : label}</button>;
  const headerBack = () => { if (step === 'token') go('payment'); else if (step === 'payment') go('choose'); else if (step === 'invoice' || step === 'waiting') close(); else close(); };
  const showPay = step === 'payment' || step === 'token';
  const visiblePacks = packageOrder.map(n => packs.find(p => p.coins === n) || (rate ? { id: 'custom:' + n, coins: n, price: Math.round(n / rate * 100) / 100 } : null)).filter((p): p is Pack => p !== null);
  return <section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="VANTA Shop" className="fixed inset-0 z-[105] flex justify-center bg-[#15171b] text-white">
    <div className="relative flex h-[100dvh] w-full max-w-lg flex-col overflow-hidden bg-[#191d21]">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-black/20 px-4"><button type="button" aria-label="Back" onClick={headerBack} disabled={busy} className="grid h-10 w-10 place-items-center"><ArrowLeft size={22}/></button><h1 className="flex-1 text-xl font-semibold">VANTA Shop</h1><button type="button" onClick={close} disabled={busy} aria-label="Close" className="grid h-10 w-10 place-items-center"><ChevronDown size={22}/></button></header>
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5">
        {(step === 'choose' || showPay) && <div aria-hidden={showPay ? true : undefined}>
          <h2 className="mb-5 text-[25px] font-semibold leading-8">Choose a product</h2>
          {pendingCards.length > 0 && <div className="mb-4 space-y-2"><h3 className="text-sm font-semibold">Pending card payments</h3>{pendingCards.map(p => <button key={p.orderId} type="button" disabled={busy || showPay} onClick={() => resumeCard(p.orderId)} className="w-full rounded-xl bg-[#212529] p-3 text-left text-sm">Resume {p.product === 'coins' ? 'coin' : 'badge'} card payment · {usd(p.amount)}</button>)}</div>}
          {pendingInvoices.length > 0 && <div className="mb-4 space-y-2"><h3 className="text-sm font-semibold">Pending payments</h3>{pendingInvoices.map(p => <button key={p.orderId} type="button" disabled={busy || showPay} onClick={() => resumePending(p.orderId)} className="w-full rounded-xl bg-[#212529] p-3 text-left text-sm">Resume {p.product === 'coins' ? 'coin' : 'badge'} payment · {usd(p.amount)}</button>)}</div>}
          <div className="mb-6 flex flex-wrap gap-2">{(['badge','coins'] as Product[]).map(p => <button key={p} type="button" onClick={() => selectProduct(p)} aria-pressed={product === p} className={'rounded-full px-3 py-2 text-sm font-semibold ' + (product === p ? 'bg-white text-black' : 'bg-[#212529] text-[#95979b]')}>{p === 'badge' ? 'Verification Badge' : 'VANTA Coins'}</button>)}</div>
          <div className="space-y-2"><h3 className="mb-2 text-[15px]">Who is it for?</h3><Choice selected={!gift} onClick={() => { setGift(false); setRecipient(null); }} icon={<User size={22}/>} title="For me" detail="Goes to your VANTA account"/><Choice selected={gift} onClick={() => { setGift(true); setRenew(false); }} icon={<Gift size={22}/>} title="As a gift" detail="Send it to another VANTA user"/></div>
          <p className={'mt-3 text-[13px] ' + muted}>Buy it for yourself or send it to a friend on VANTA.</p>
          {gift && <div className="mt-5"><label htmlFor="shop-recipient" className="text-[15px]">Recipient</label><div className="mt-2 flex items-center gap-2 rounded-xl bg-[#212529] p-2"><Search size={16}/><input id="shop-recipient" className="min-w-0 flex-1 bg-transparent p-1 text-sm outline-none" placeholder="@username" value={query} onChange={e => { setRecipient(null); setQuery(e.target.value); }}/><button type="button" onClick={paste} className="rounded-lg bg-[#191d21] px-3 py-2 text-sm">Paste</button></div><p className={'mt-2 text-xs ' + muted}>{searching ? 'Searching…' : recipient ? 'Selected @' + recipient.username : 'Search and select a VANTA account.'}</p>{!recipient && recipients.map(r => <button type="button" key={r.id} onClick={() => { setRecipient(r); setQuery('@' + r.username); }} className="mt-2 block w-full rounded-lg bg-[#212529] p-3 text-left text-sm">@{r.username} {r.fullName && ' · ' + r.fullName}</button>)}</div>}
          {loading && <p role="status" className="my-5 text-sm">Loading shop…</p>}
          {product === 'coins' ? <div className="mt-6 space-y-2"><div className="flex items-center justify-between"><h3>Packs</h3><span className={'flex items-center gap-1 text-xs ' + muted}>Balance: <VantaCoinIcon size={14} decorative/> {balance === null ? '—' : balance.toLocaleString()}</span></div>
            {visiblePacks.map(p => { const isCustomPack = p.id.startsWith('custom:'); return <Choice key={p.id} selected={isCustomPack ? packId === 'custom' && custom === String(p.coins) : packId === p.id} onClick={() => { if (isCustomPack) { setPackId('custom'); setCustom(String(p.coins)); } else setPackId(p.id); }} icon={<VantaCoinIcon size={38} decorative/>} title={p.coins.toLocaleString() + ' VANTA Coins'} detail={usd(p.price)}/>; })}
            <Choice selected={packId === 'custom'} onClick={() => setPackId('custom')} icon={<Pencil size={22}/>} title="Custom amount" detail="Enter how many coins you need"/>
            {packId === 'custom' && <div className="pt-3"><label htmlFor="shop-custom" className="text-sm">Amount</label><input id="shop-custom" inputMode="numeric" value={custom} onChange={e => setCustom(e.target.value)} className="mt-2 w-full rounded-xl bg-[#212529] p-4 text-lg outline-none" placeholder="100" maxLength={6}/><p className={'mt-3 text-sm ' + muted}>Enter between 100 and 100,000 coins.</p></div>}
          </div> : <div className="mt-6 space-y-2"><h3>Plan</h3>{[...plans].sort((a,b) => b.durationMonths - a.durationMonths).map(p => { const base = plans.find(x => x.badgeType === p.badgeType && x.durationMonths === 1); const saving = base ? Math.round((1 - p.priceUSD / p.durationMonths / base.priceUSD) * 100) : 0; return <Choice key={p.id} selected={planId === p.id} onClick={() => setPlanId(p.id)} icon={<VerificationBadge type={p.badgeType} size="md"/>} title={<>{p.durationLabel} <span className="text-xs">{p.badgeType === 'GOLD' ? 'Gold' : 'Blue'}</span>{saving > 0 && <span className="ml-2 rounded bg-[#183832] px-1.5 text-xs text-[#36d5b2]">-{saving}%</span>}</>} detail={usd(p.priceUSD) + ' · ' + usd(p.priceUSD / p.durationMonths) + ' a month'}/>; })}
            <p className={'pt-2 text-sm ' + muted}>Longer plans may cost less per month.</p><label className="flex items-center justify-between gap-3 pt-5 text-[15px]"><span>Auto-renewal</span><input type="checkbox" role="switch" checked={renew} onChange={e => setRenew(e.target.checked)} className="h-5 w-9 accent-white"/></label><p className={'text-sm ' + muted}>{plan ? 'Renew every ' + plan.durationLabel + '. ' : ''}Auto-renewal requires a supported recurring payment provider.</p>
          </div>}
        </div>}
        {(step === 'invoice' || step === 'waiting') && invoice && <div className="space-y-4">
          <h2 className="text-xl font-semibold">{step === 'invoice' ? 'Amount due: ' + (invoice.mode === 'live' ? invoice.tokenAmount + ' ' + invoice.token : usd(invoice.amount)) : 'Waiting for your payment'}</h2><p className={'text-sm ' + muted}>{productLabel}</p>
          {invoice.mode === 'live' ? <>
            {remaining > 0 && paymentStatus !== 'RECONCILIATION' ? <>
              <div className="rounded-xl bg-[#212529] p-4 text-center">
                <p className="font-semibold">{invoice.token} · {networkInfo?.chain}</p>
                <button type="button" onClick={() => setQrExpanded(!qrExpanded)} aria-label={qrExpanded ? 'Reduce QR code' : 'Enlarge QR code'} className="mx-auto mt-3 block rounded-xl bg-white p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={invoice.qrCode} alt="Crypto invoice QR code" className={qrExpanded ? 'h-auto w-[min(72vw,320px)]' : 'h-44 w-44'}/>
                </button><p className={'mt-2 text-xs ' + muted}>Tap QR to enlarge</p>
                <p className="mt-4 break-all text-sm">{invoice.address}</p>
                <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => clipboard(invoice.address)} className="rounded-lg bg-[#191d21] p-3 text-sm">Copy address</button><button type="button" onClick={() => clipboard(invoice.tokenAmount)} className="rounded-lg bg-[#191d21] p-3 text-sm">Copy amount</button></div>
              </div>
              {invoice.network === "usdt-trc20" ? <p className="text-sm">Open your TRON-compatible wallet and paste the address and exact USDT amount. The QR contains the receiving address only.</p> : <a href={invoice.paymentUri} className="block rounded-xl bg-[#212529] p-3 text-center text-sm font-semibold">Open wallet</a>}
              <p className="text-xs text-amber-200">Send the exact amount on {networkInfo?.chain}. Network fees are paid separately. Use this address only for this invoice; do not send after expiry.</p>
            </> : <div role="alert" className="rounded-xl bg-[#212529] p-4 text-sm text-amber-200">Invoice closed. If you sent payment, contact support with the order reference and transaction hash.</div>}
            <label className="block text-sm">Transaction hash (optional)<input value={txHash} onChange={e => setTxHash(e.target.value)} maxLength={66} placeholder={invoice.network === "usdt-trc20" ? "64-character TRON hash" : "0x…"} className="mt-2 w-full rounded-xl bg-[#212529] p-3 outline-none"/></label>
          </> : <div className="rounded-xl bg-[#212529] p-4"><p className="font-semibold text-amber-300">Test payment — do not send real funds</p><p className={'mt-2 text-sm ' + muted}>This order is only for the isolated VANTA sandbox. The server verifies the signed test confirmation.</p></div>}
          <div className="divide-y divide-white/5 rounded-xl bg-[#212529] p-3 text-sm">{[['Expires in',countdown],['Order reference',invoice.orderId],['Amount',invoice.mode === 'live' ? invoice.tokenAmount + ' ' + invoice.token : usd(invoice.amount)],['Payment token',networkInfo?.label + ' · ' + networkInfo?.chain],['Status',invoice.mode === 'live' ? (remaining ? paymentStatus : 'Expired / reconciliation') : step === 'waiting' ? 'Checking server' : remaining ? 'Unpaid (test)' : 'Expired'],['Network fee',invoice.mode === 'live' ? 'Paid by you' : 'None in sandbox']].map(([label,value]) => <div key={label} className="flex items-center justify-between gap-3 py-3"><span className={muted}>{label}</span><span className="min-w-0 break-all text-right">{value}</span>{label === 'Order reference' && <button type="button" aria-label="Copy order reference" onClick={() => clipboard(invoice.orderId)}><Copy size={16}/></button>}</div>)}</div>
          {copied && <p role="status" className="text-xs">Copied.</p>}
        </div>}
        {step === 'card' && cardOrder && <div className="space-y-4">
          <h2 className="text-xl font-semibold">Card checkout · {usd(cardOrder.amount)}</h2>
          <div className="rounded-xl bg-[#212529] p-4"><p className="font-semibold text-amber-200">Stripe test payment — no real charge</p><p className={'mt-2 text-sm ' + muted}>Card details are entered on Stripe, not on VANTA. Return to the shop after completing or cancelling checkout.</p></div>
          <div className="rounded-xl bg-[#212529] p-4 text-sm space-y-3"><p>Order: <span className="break-all">{cardOrder.orderId}</span></p><p>Status: {paymentStatus}</p><p>Product: {cardOrder.product === 'coins' ? 'VANTA Coins' : 'Verification Badge'}</p></div>
          {cardOrder.checkoutUrl && paymentStatus === 'PENDING' && Date.parse(cardOrder.expiresAt) > Date.now() && <a href={cardOrder.checkoutUrl} className="block rounded-xl bg-white p-3 text-center text-sm font-semibold text-black">Open secure test checkout</a>}
          {paymentStatus === 'EXPIRED' || paymentStatus === 'RECONCILIATION' ? <p className="text-sm text-amber-200">Order closed. If you completed payment, contact support with this order reference.</p> : null}
        </div>}
        {step === 'success' && <div className="flex flex-col items-center gap-4 py-14 text-center"><span className="grid h-16 w-16 place-items-center rounded-full bg-emerald-700"><Check size={36}/></span><h2 className="text-2xl font-semibold">Payment successful</h2><p>{product === 'coins' ? resultCoins.toLocaleString() + ((invoice?.mode === 'test' || cardOrder || coinReceipt) ? ' test coins credited' : ' VANTA Coins credited') : (invoice?.mode === 'test' || cardOrder) ? 'Test verification purchase confirmed' : 'Verification purchase confirmed'}</p>{gift && recipient && <p>Gift delivered to @{recipient.username}</p>}{coinReceipt && <p>{coinReceipt.coinsSpent.toLocaleString()} test coins spent · Order {coinReceipt.orderId}</p>}<p className={muted}>{(invoice?.mode === 'test' || cardOrder) ? 'Confirmed by the sandbox backend. No real payment was taken.' : 'Payment verified and fulfilled by VANTA.'}</p></div>}
      </main>
      {!showPay && <footer className="shrink-0 space-y-2 rounded-t-2xl border-t border-white/5 bg-[#191d21] px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3">{error && <p role="alert" className="text-sm text-red-300">{error}</p>}{step === 'choose' && footerButton(ready && price !== undefined ? (gift ? 'Gift ' : product === 'badge' ? 'Subscribe for ' : 'Buy ' + quantity.toLocaleString() + ' coins for ') + usd(price) + (product === 'badge' && plan ? ' / ' + plan.durationLabel : '') : product === 'badge' ? 'Subscribe' : 'Buy coins', () => go('payment'), !ready)}{(step === 'invoice' || step === 'waiting') && <>{footerButton(invoice?.mode === 'live' ? (step === 'waiting' ? 'Check payment again' : "I've sent the payment") : step === 'waiting' ? 'Check test payment again' : 'Confirm test payment', confirm, remaining <= 0 || paymentStatus === 'RECONCILIATION')}<button type="button" onClick={close} disabled={busy} className="w-full rounded-xl bg-[#212529] py-3 text-sm">Close</button></>}{step === 'card' && footerButton('Check card payment', checkCard, !cardTest || !cardOrder)}{step === 'success' && footerButton('Done', close)}</footer>}
      {showPay && <div className="absolute inset-0 z-10 flex flex-col justify-end bg-black/65"><section aria-label={step === 'token' ? 'Payment token' : 'Payment'} className="flex max-h-[96%] min-h-[50%] flex-col rounded-t-2xl bg-[#191d21]"><header className="flex shrink-0 items-center justify-between px-4 py-3"><h2 className="text-xl font-semibold">{step === 'token' ? 'Payment token' : 'Payment'}</h2><button type="button" aria-label="Close payment sheet" disabled={busy} onClick={() => go(step === 'token' ? 'payment' : 'choose')} className="grid h-9 w-9 place-items-center rounded-full bg-[#212529]"><X size={20}/></button></header><div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
        {step === 'token' ? <><label className="flex items-center gap-2 rounded-xl bg-[#212529] p-3"><Search size={18}/><input aria-label="Search payment tokens" placeholder="Search…" value={networkSearch} onChange={e => setNetworkSearch(e.target.value)} className="min-w-0 flex-1 bg-transparent outline-none"/></label>{networks.filter(n => (n.label + ' ' + n.chain).toLowerCase().includes(networkSearch.toLowerCase())).map(n => <Choice key={n.id} selected={network === n.id} disabled={!networkEnabled(n.id)} onClick={() => setNetwork(n.id)} icon={<Bitcoin size={22}/>} title={n.label} detail={n.chain + (!networkEnabled(n.id) ? ' · Not configured' : '')}/>)}</> : <>
          <div className={cardClass + ' p-4'}><p className={'text-sm ' + muted}>Total</p><p className="my-1 text-2xl font-bold">{usd(price || 0)}</p><div className="mt-4 flex justify-between gap-2 text-sm"><span className={muted}>{product === 'coins' ? 'VANTA Coins' : 'Verification Badge'}</span><span className="text-right">{product === 'coins' ? quantity.toLocaleString() : plan?.durationLabel}</span></div><div className="mt-2 flex justify-between text-sm"><span className={muted}>Recipient</span><span>{recipientLabel}</span></div>{product === 'badge' && <><label className="mt-2 flex justify-between text-sm"><span className={muted}>Auto-renewal</span><input type="checkbox" role="switch" checked={renew} onChange={e => setRenew(e.target.checked)}/></label>{renew && <div className="mt-2 flex justify-between text-sm"><span className={muted}>Renewal period</span><span>Every {plan?.durationLabel}</span></div>}</>}</div>
          {product === 'badge' && plan && <><div className="flex items-center justify-between text-sm"><span>Plan</span><button type="button" onClick={() => go('choose')} className="flex items-center gap-1 text-[#b8bcc0]"><Pencil size={14}/>Change</button></div><Choice selected onClick={() => go('choose')} icon={<VerificationBadge type={plan.badgeType} size="md"/>} title={plan.name} detail={usd(plan.priceUSD)}/></>}
          <h3 className="pt-2 text-sm">Payment method</h3><Choice selected={method === 'card'} onClick={() => setMethod('card')} icon={<CreditCard size={22}/>} title="Card" detail={cardTest ? "Secure Stripe hosted checkout · test mode" : "Hosted web card checkout · not configured"}/>
          <Choice selected={method === 'crypto'} onClick={() => { setMethod('crypto'); setRenew(false); }} icon={<Bitcoin size={22}/>} title="Crypto" detail={(networkInfo?.label || '') + ' · ' + (networkInfo?.chain || '') + ' · One-time payment'}/>
          {method === 'crypto' && <button type="button" onClick={() => { setNetworkSearch(''); go('token'); }} className="w-full rounded-xl bg-[#212529] p-3 text-left text-sm">Change payment token <ChevronDown className="float-right" size={18}/></button>}
          {product === 'badge' && <Choice selected={method === 'coins'} onClick={() => { setMethod('coins'); setRenew(false); }} icon={<WalletCards size={22}/>} title="VANTA Coins" detail={coinBadge ? (badgeCost === null ? 'Select a plan' : badgeCost.toLocaleString() + ' coins · test checkout') : 'Coin-balance checkout · not configured'}/>}
          {method === 'coins' && product === 'badge' && coinBadge && <div className={cardClass + ' space-y-3 p-4 text-sm'}>
            <div className="flex justify-between"><span>Available coins</span><span>{availableCoins === null ? 'Unavailable' : availableCoins.toLocaleString()}</span></div>
            <div className="flex justify-between"><span>Coins to pay</span><span>{badgeCost === null ? '—' : badgeCost.toLocaleString()}</span></div>
            {availableCoins !== null && badgeCost !== null && <div className="flex justify-between"><span>Remaining available balance</span><span>{availableCoins >= badgeCost ? (availableCoins - badgeCost).toLocaleString() : 'Insufficient coins'}</span></div>}
            <label className="block">Confirm wallet PIN<input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={walletPin} onChange={e => setWalletPin(e.target.value.replace(/[^0-9]/g, ''))} className="mt-2 w-full rounded-xl bg-[#191d21] p-3" placeholder="4–6 digits"/></label>
            <p className={muted}>One-time payment from spendable test coins. Existing active or suspended badges cannot be replaced with this payment method.</p>
          </div>}
          <p className={'text-sm ' + muted}>{renew ? 'Recurring billing is not connected yet.' : method === 'card' ? (cardTest ? 'You will enter card details on Stripe in test mode.' : 'Web card checkout is not configured; Android Play Billing is separate.') : method === 'coins' ? (coinBadge ? 'Your PIN authorizes the exact coin debit.' : 'Coin checkout is not configured.') : method !== 'crypto' ? 'This payment provider is not configured.' : sandbox ? 'Test checkout only. No real funds will be requested.' : liveCrypto && gift ? 'Live gifts are not enabled yet.' : liveCrypto ? 'Send the exact token amount on the selected network.' : 'Checkout is disabled on this environment.'}</p>
        </>}
      </div><footer className="shrink-0 space-y-2 px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-2">{error && <p role="alert" className="text-sm text-red-300">{error}</p>}{step === 'token' ? footerButton('OK', () => go('payment')) : footerButton(method === 'coins' && badgeCost !== null ? 'Pay ' + badgeCost.toLocaleString() + ' test coins' : ((sandbox || (method === 'card' && cardTest)) ? 'Test pay ' : 'Pay ') + usd(price || 0), start, !ready || !canPay)}{step === 'payment' && <p className={'text-center text-xs ' + muted}>No payment is charged until a supported checkout is confirmed.</p>}</footer></section></div>}
    </div>
  </section>;
}
