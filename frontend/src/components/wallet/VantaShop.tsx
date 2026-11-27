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
type Invoice = { orderId: string; amount: number; currency: string; network: string; mode: 'test'; expiresAt: string; simulateToken: string };
type Step = 'choose' | 'payment' | 'token' | 'invoice' | 'waiting' | 'success';
const networks = [
  { id: 'eth-erc20', label: 'ETH', chain: 'Ethereum', enabled: false },
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
  if (a.mode !== 'test' || typeof a.orderId !== 'string' || typeof a.amount !== 'number' || !Number.isFinite(a.amount) || a.amount <= 0 || typeof a.currency !== 'string' || typeof a.network !== 'string' || typeof a.expiresAt !== 'string' || !Number.isFinite(Date.parse(a.expiresAt)) || typeof a.simulateToken !== 'string') throw new Error('Checkout is not an isolated test invoice.');
  return a as Invoice;
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
    setProduct(initialProduct); setStep('choose'); setPackId(''); setPlanId(initialPlan?.id || ''); setGift(false); setRecipient(null); setQuery(''); setRecipients([]); setRenew(false); setCustom(''); setInvoice(null); setError(''); setSandbox(false); setPacks([]); setPlans([]); setRate(null); setBalance(null); setMethod('crypto'); setNetwork('usdt-bep20'); setLoading(true);
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
      if (s.status === 'fulfilled') setSandbox(obj(s.value).sandbox === true);
      if (b.status === 'fulfilled') { const raw = obj(b.value); const w = raw.wallet && typeof raw.wallet === 'object' ? obj(raw.wallet) : raw; if (typeof w.coinBalance === 'number') setBalance(w.coinBalance); }
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
  const selectedPack = packs.find(p => p.id === packId);
  const customNumber = Number(custom);
  const customValid = /^\d+$/.test(custom) && Number.isSafeInteger(customNumber) && customNumber >= 100 && customNumber <= 100000 && rate !== null;
  const quantity = packId === 'custom' ? (customValid ? customNumber : 0) : selectedPack?.coins || 0;
  const plan = plans.find(p => p.id === planId);
  const price = product === 'badge' ? plan?.priceUSD : packId === 'custom' ? customValid && rate ? Math.round(customNumber / rate * 100) / 100 : undefined : selectedPack?.price;
  const ready = !loading && typeof price === 'number' && price > 0 && (product === 'badge' ? !!plan : quantity > 0) && (!gift || !!recipient);
  const remaining = invoice ? Math.max(0, Math.ceil((Date.parse(invoice.expiresAt) - clock) / 1000)) : 0;
  const countdown = Math.floor(remaining / 60).toString().padStart(2, '0') + ':' + (remaining % 60).toString().padStart(2, '0');
  const networkInfo = networks.find(n => n.id === network);
  const recipientLabel = gift ? recipient ? '@' + recipient.username : 'Choose recipient' : 'You';
  const productLabel = product === 'badge' ? plan?.name || 'Verification Badge' : quantity.toLocaleString() + ' VANTA Coins';
  const selectProduct = (p: Product) => { setProduct(p); setStep('choose'); setError(''); setRenew(false); setMethod('crypto'); };
  const go = (s: Step) => { setError(''); setStep(s); };
  const clipboard = async (value: string) => { try { await navigator.clipboard.writeText(value); setCopied(value); } catch { setError('Clipboard unavailable. Select and copy manually.'); } };
  const paste = async () => { try { setRecipient(null); setQuery((await navigator.clipboard.readText()).trim()); } catch { setError('Paste the username into the field manually.'); } };
  async function start() {
    if (!token || !ready || !sandbox || gift || renew || method !== 'crypto' || !networkInfo?.enabled || actionLock.current) return;
    actionLock.current = true; setBusy(true); setError('');
    try {
      const data = product === 'coins'
        ? await request('/api/wallets/payment-address', token, { packageId: packId, network, ...(packId === 'custom' ? { customCoins: quantity } : {}) })
        : await request('/api/verification/purchase/init', token, { planId, network });
      const next = invoiceFrom(data);
      if (next.amount !== price || next.network !== network) throw new Error('The price or network changed. Reopen the shop and review the catalog.');
      setInvoice(next); setClock(Date.now()); setStep('invoice');
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to initialize checkout'); }
    finally { actionLock.current = false; setBusy(false); }
  }
  async function confirm() {
    if (!token || !invoice || !sandbox || remaining <= 0 || actionLock.current) return;
    actionLock.current = true; setBusy(true); setError(''); setStep('waiting');
    try {
      const result = obj(await request(product === 'coins' ? '/api/wallets/verify-payment' : '/api/verification/purchase/verify', token, { orderId: invoice.orderId, testConfirmation: true, simulateToken: invoice.simulateToken, ...(product === 'coins' ? { txHash: 'sandbox:' + invoice.orderId } : {}) }));
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
        {(step === 'invoice' || step === 'waiting') && invoice && <div className="space-y-4"><h2 className="text-xl font-semibold">{step === 'invoice' ? 'Amount due: ' + usd(invoice.amount) : 'Waiting for your payment'}</h2><p className={'text-sm ' + muted}>{productLabel}</p><div className="rounded-xl bg-[#212529] p-4"><p className="font-semibold text-amber-300">Test payment — do not send real funds</p><p className={'mt-2 text-sm ' + muted}>This order is only for the isolated VANTA sandbox. The server verifies the signed test confirmation.</p></div><div className="divide-y divide-white/5 rounded-xl bg-[#212529] p-3 text-sm">{[['Expires in',countdown],['Order reference',invoice.orderId],['Amount',usd(invoice.amount)],['Payment token',networkInfo?.label + ' · ' + networkInfo?.chain],['Status',step === 'waiting' ? 'Checking server' : remaining ? 'Unpaid (test)' : 'Expired'],['Network fee','None in sandbox']].map(([label,value]) => <div key={label} className="flex items-center justify-between gap-3 py-3"><span className={muted}>{label}</span><span className="min-w-0 break-all text-right">{value}</span>{label === 'Order reference' && <button type="button" aria-label="Copy order reference" onClick={() => clipboard(invoice.orderId)}><Copy size={16}/></button>}</div>)}</div>{copied === invoice.orderId && <p role="status" className="text-xs">Order reference copied.</p>}</div>}
        {step === 'success' && <div className="flex flex-col items-center gap-4 py-14 text-center"><span className="grid h-16 w-16 place-items-center rounded-full bg-emerald-700"><Check size={36}/></span><h2 className="text-2xl font-semibold">Payment successful</h2><p>{product === 'coins' ? resultCoins.toLocaleString() + ' test coins credited' : 'Test verification purchase confirmed'}</p><p className={muted}>Confirmed by the sandbox backend. No real payment was taken.</p></div>}
      </main>
      {!showPay && <footer className="shrink-0 space-y-2 rounded-t-2xl border-t border-white/5 bg-[#191d21] px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3">{error && <p role="alert" className="text-sm text-red-300">{error}</p>}{step === 'choose' && footerButton(ready && price !== undefined ? (gift ? 'Gift ' : product === 'badge' ? 'Subscribe for ' : 'Buy ' + quantity.toLocaleString() + ' coins for ') + usd(price) + (product === 'badge' && plan ? ' / ' + plan.durationLabel : '') : product === 'badge' ? 'Subscribe' : 'Buy coins', () => go('payment'), !ready)}{(step === 'invoice' || step === 'waiting') && <>{footerButton(step === 'waiting' ? 'Check test payment again' : 'Confirm test payment', confirm, remaining <= 0)}<button type="button" onClick={close} disabled={busy} className="w-full rounded-xl bg-[#212529] py-3 text-sm">Close</button></>}{step === 'success' && footerButton('Done', close)}</footer>}
      {showPay && <div className="absolute inset-0 z-10 flex flex-col justify-end bg-black/65"><section aria-label={step === 'token' ? 'Payment token' : 'Payment'} className="flex max-h-[96%] min-h-[50%] flex-col rounded-t-2xl bg-[#191d21]"><header className="flex shrink-0 items-center justify-between px-4 py-3"><h2 className="text-xl font-semibold">{step === 'token' ? 'Payment token' : 'Payment'}</h2><button type="button" aria-label="Close payment sheet" disabled={busy} onClick={() => go(step === 'token' ? 'payment' : 'choose')} className="grid h-9 w-9 place-items-center rounded-full bg-[#212529]"><X size={20}/></button></header><div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
        {step === 'token' ? <><label className="flex items-center gap-2 rounded-xl bg-[#212529] p-3"><Search size={18}/><input aria-label="Search payment tokens" placeholder="Search…" value={networkSearch} onChange={e => setNetworkSearch(e.target.value)} className="min-w-0 flex-1 bg-transparent outline-none"/></label>{networks.filter(n => (n.label + ' ' + n.chain).toLowerCase().includes(networkSearch.toLowerCase())).map(n => <Choice key={n.id} selected={network === n.id} disabled={!n.enabled} onClick={() => setNetwork(n.id)} icon={<Bitcoin size={22}/>} title={n.label} detail={n.chain + (!n.enabled ? ' · Not configured' : '')}/>)}</> : <>
          <div className={cardClass + ' p-4'}><p className={'text-sm ' + muted}>Total</p><p className="my-1 text-2xl font-bold">{usd(price || 0)}</p><div className="mt-4 flex justify-between gap-2 text-sm"><span className={muted}>{product === 'coins' ? 'VANTA Coins' : 'Verification Badge'}</span><span className="text-right">{product === 'coins' ? quantity.toLocaleString() : plan?.durationLabel}</span></div><div className="mt-2 flex justify-between text-sm"><span className={muted}>Recipient</span><span>{recipientLabel}</span></div>{product === 'badge' && <><label className="mt-2 flex justify-between text-sm"><span className={muted}>Auto-renewal</span><input type="checkbox" role="switch" checked={renew} onChange={e => setRenew(e.target.checked)}/></label>{renew && <div className="mt-2 flex justify-between text-sm"><span className={muted}>Renewal period</span><span>Every {plan?.durationLabel}</span></div>}</>}</div>
          {product === 'badge' && plan && <><div className="flex items-center justify-between text-sm"><span>Plan</span><button type="button" onClick={() => go('choose')} className="flex items-center gap-1 text-[#b8bcc0]"><Pencil size={14}/>Change</button></div><Choice selected onClick={() => go('choose')} icon={<VerificationBadge type={plan.badgeType} size="md"/>} title={plan.name} detail={usd(plan.priceUSD)}/></>}
          <h3 className="pt-2 text-sm">Payment method</h3><Choice selected={method === 'card'} onClick={() => setMethod('card')} icon={<CreditCard size={22}/>} title="Card" detail="Hosted card checkout · not configured"/>
          <Choice selected={method === 'crypto'} onClick={() => { setMethod('crypto'); setRenew(false); }} icon={<Bitcoin size={22}/>} title="Crypto" detail={(networkInfo?.label || '') + ' · ' + (networkInfo?.chain || '') + ' · One-time payment'}/>
          {method === 'crypto' && <button type="button" onClick={() => { setNetworkSearch(''); go('token'); }} className="w-full rounded-xl bg-[#212529] p-3 text-left text-sm">Change payment token <ChevronDown className="float-right" size={18}/></button>}
          {product === 'badge' && <Choice selected={method === 'coins'} onClick={() => { setMethod('coins'); setRenew(false); }} icon={<WalletCards size={22}/>} title="VANTA Coins" detail="Coin-balance checkout · not configured"/>}
          <p className={'text-sm ' + muted}>{gift ? 'Gift fulfillment is not connected yet. No payment will be taken.' : renew ? 'Recurring billing is not connected yet.' : method !== 'crypto' ? 'This payment provider is not configured.' : !sandbox ? 'Checkout is disabled on this environment. The isolated sandbox must be configured before a test purchase can be made.' : 'Test checkout only. No real funds will be requested.'}</p>
        </>}
      </div><footer className="shrink-0 space-y-2 px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-2">{error && <p role="alert" className="text-sm text-red-300">{error}</p>}{step === 'token' ? footerButton('OK', () => go('payment')) : footerButton((sandbox ? 'Test pay ' : 'Pay ') + usd(price || 0), start, !ready || !sandbox || gift || renew || method !== 'crypto' || !networkInfo?.enabled)}{step === 'payment' && <p className={'text-center text-xs ' + muted}>No payment is charged until a supported checkout is confirmed.</p>}</footer></section></div>}
    </div>
  </section>;
}
