'use client';
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { AlertCircle, Check, Gift, Loader2, RefreshCw, Search, Send, X } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import GiftArtwork from '@/components/gifts/GiftArtwork';
import VantaCoinIcon from '@/components/ui/VantaCoinIcon';
import { apiPost } from '@/lib/apiClient';

import { useToast } from '@/components/ui/Toast';
import { filterGiftCatalog, visibleGiftCategories, giftVisualQuality, type GiftCatalogItem, type GiftCategoryId } from '@/lib/giftCatalog';
export type { GiftCatalogItem } from '@/lib/giftCatalog';

interface Recipient { id: string; username: string; fullName?: string; avatar?: string }
const number = (value: number) => new Intl.NumberFormat().format(value);

function Visual({ gift, preview = false, size = 68 }: { gift: GiftCatalogItem; preview?: boolean; size?: number }) {
  const asset = preview ? gift.previewAssetUrl || gift.animationUrl || gift.image || gift.thumbnailUrl : gift.thumbnailUrl || gift.image;
  // One renderer for every gift surface: old remote thumbnails must not
  // bypass the approved catalog artwork or reduced-motion preference.
  return <GiftArtwork slug={gift.slug} name={gift.name} artworkType={gift.artworkType} assetUrl={asset} size={size} responsive={!preview} blendReferenceBackground animate={preview} quality={giftVisualQuality(gift)} />;
}

export default function GiftPicker({ gifts, balance, recipient, token, streamId, videoId, initialGift, loading = false, loadError, onRetry, onClose, onSent }: { gifts: GiftCatalogItem[]; balance: number; recipient: Recipient; token: string; streamId?: string; videoId?: string; initialGift?: GiftCatalogItem | null; loading?: boolean; loadError?: string; onRetry?: () => void; onClose: () => void; onSent: (_balance: number, _amount: number, _gift: GiftCatalogItem, _quantity?: number) => void }) {
  const router = useRouter(), toast = useToast();
  const [query, setQuery] = useState(''), [category, setCategory] = useState<GiftCategoryId>('all');
  const [selected, setSelected] = useState<GiftCatalogItem | null>(initialGift || null);
  const [message, setMessage] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [sending, setSending] = useState(false), [sent, setSent] = useState(false);
  const visible = useMemo(() => filterGiftCatalog(gifts, category, query), [gifts, category, query]);
  const categories = useMemo(() => visibleGiftCategories(gifts), [gifts]);
  const totalCost = selected ? selected.price * quantity : 0;
  const insufficient = !!selected && totalCost > balance;
  const validRecipient = Boolean(recipient?.id && recipient?.username);
  useEffect(() => {
    const body = document.body, overflow = body.style.overflow, padding = body.style.paddingRight, overscroll = body.style.overscrollBehavior;
    const scrollbar = innerWidth - document.documentElement.clientWidth; body.style.overflow = 'hidden'; body.style.overscrollBehavior = 'none'; if (scrollbar) body.style.paddingRight = `${scrollbar}px`;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !sending) onClose(); }; addEventListener('keydown', key);
    return () => { body.style.overflow = overflow; body.style.paddingRight = padding; body.style.overscrollBehavior = overscroll; removeEventListener('keydown', key); };
  }, [onClose, sending]);
  const send = async () => {
    if (!selected || insufficient || sending || !validRecipient) return; setSending(true);
    const requestId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
    try { const response = await apiPost<any>('/api/monetization/gifts/send', { receiverId: recipient.id, giftId: selected.id, expectedPrice: selected.price, streamId, videoId, quantity, message: message.trim() || undefined, requestId }, token); const result = response.transaction || response; onSent(response.remainingBalance ?? result.remainingBalance ?? balance, response.amount ?? result.amount ?? totalCost, selected, quantity); setSent(true); setTimeout(onClose, 2100); }
    catch (error: any) { toast.error('Gift not sent', error?.message || 'The transaction could not be completed.'); setSending(false); }
  };
  return <>
    <motion.button aria-label="Close gift picker" disabled={sending} onClick={onClose} className="fixed inset-0 z-[70] bg-[var(--overlay)] backdrop-blur-sm" initial={{opacity:0}} animate={{opacity:1}} />
    <motion.section
      role="dialog"
      aria-modal="true"
      aria-labelledby="gift-title"
      initial={{ opacity: 0, y: '24%' }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: '24%' }}
      className="fixed inset-x-0 bottom-[var(--vanta-kb,0px)] z-[80] mx-auto flex h-[min(690px,var(--vanta-vh,100dvh))] max-h-[calc(var(--vanta-vh,100dvh)_-_20px)] w-full max-w-[520px] flex-col overflow-hidden rounded-t-[28px] border-x border-t border-[var(--border-strong)] bg-[var(--background)] shadow-[0_-24px_90px_rgba(0,0,0,.6)] sm:max-w-[540px] md:inset-y-0 md:left-1/2 md:my-auto md:h-[min(740px,calc(var(--vanta-vh,100dvh)_-_100px))] md:max-h-none md:max-w-[580px] md:-translate-x-1/2 md:rounded-[28px]"
    >
      <header className="relative flex shrink-0 items-center gap-2.5 border-b border-[var(--border)] bg-[var(--background-secondary)] px-3.5 py-3.5 backdrop-blur-xl sm:px-4">
        <Avatar src={recipient.avatar} alt={recipient.username} size="sm" />
        <div className="min-w-0 flex-1">
          <h2 id="gift-title" className="truncate text-[15px] font-bold leading-tight tracking-tight text-[var(--text-primary)]">Send a Gift</h2>
          <p className="mt-0.5 truncate text-[11px] leading-tight text-[var(--text-secondary)]">
            to {recipient.fullName || recipient.username} <span className="text-[var(--text-muted)]">· @{recipient.username}</span>
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-[#e5c35a]/25 bg-[#d8b44b]/[0.09] px-3 py-1.5 text-sm font-bold tabular-nums text-[var(--text-primary)]">
          <VantaCoinIcon size={14} className="text-[var(--vanta-gold)]" />{number(balance)}
        </span>
        <button aria-label="Close gift picker" disabled={sending} onClick={onClose} className="-mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:opacity-50"><X size={19} /></button>
      </header>
      <AnimatePresence mode="wait">{sent && selected ? <motion.div key="success" initial={{ opacity: 0, scale: .9 }} animate={{ opacity: 1, scale: 1 }} className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden p-8 text-center">
        <motion.div initial={{ y: 30, scale: .5 }} animate={{ y: [0, -6, 0], scale: 1 }} className="relative flex h-44 w-44 items-center justify-center"><Visual gift={selected} preview size={168} /></motion.div>
        <span className="relative grid h-10 w-10 place-items-center rounded-full bg-white text-black"><Check size={22} /></span>
        <h3 className="relative mt-3 text-xl font-bold text-[var(--text-primary)]">Gift sent</h3>
        <p className="relative mt-1 text-sm text-[var(--text-secondary)]">You sent a {selected.name} to {recipient.fullName || recipient.username}</p>
      </motion.div> : loading ?
      <div className="flex min-h-64 flex-1 flex-col items-center justify-center gap-3 text-sm text-[var(--text-secondary)]"><Loader2 className="animate-spin text-[#d8d8d8]" /><span>Loading gifts and balance...</span></div> : loadError ?
      <div className="flex min-h-64 flex-1 flex-col items-center justify-center p-6 text-center"><AlertCircle className="text-rose-300" /><h3 className="mt-3 font-semibold">Unable to load gifts. Please try again.</h3><p className="mt-1 max-w-sm text-xs text-[var(--text-secondary)]">{loadError}</p>{onRetry && <button onClick={onRetry} className="mt-5 flex h-10 items-center gap-2 rounded-lg bg-white/10 px-4 text-sm hover:bg-white/15"><RefreshCw size={15} />Retry</button>}</div> : !gifts.length ?
      <div className="flex min-h-64 flex-1 flex-col items-center justify-center p-6 text-center"><Gift className="text-[var(--text-muted)]" /><h3 className="mt-3 font-semibold">No gifts available right now</h3><p className="mt-1 text-xs text-[var(--text-secondary)]">The gift catalog is currently empty.</p>{onRetry && <button onClick={onRetry} className="mt-5 flex h-10 items-center gap-2 rounded-lg bg-white/10 px-4 text-sm hover:bg-white/15"><RefreshCw size={15} />Retry</button>}</div> :
      <motion.div key="catalog" className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 space-y-3 border-b border-[var(--border)] bg-[var(--background-secondary)] px-3.5 py-3.5 sm:px-4">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search gifts..." className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] pl-9 pr-3 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] transition focus:border-[#d6b34f]/50 focus:bg-[var(--surface-hover)]" />
          </div>
          <div className="-mx-0.5 flex items-center gap-1.5 overflow-x-auto px-0.5 scrollbar-hide">
            {categories.map(tab => <button key={tab.id} onClick={() => setCategory(tab.id)} className={`shrink-0 rounded-full border px-3.5 py-2 text-[11px] font-semibold transition-all ${category === tab.id ? 'border-[#e8c85f]/70 bg-gradient-to-b from-[#f2d777] to-[#c49a2f] text-[#17130a] shadow-[0_3px_14px_rgba(201,162,39,.16)]' : 'border-white/[0.06] bg-[var(--surface)] text-[var(--text-secondary)] hover:border-white/15 hover:bg-white/[0.07] hover:text-[var(--text-primary)]'}`}>{tab.label}</button>)}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3 pt-3 sm:px-4">
          <div className="grid grid-cols-3 gap-2 min-[380px]:grid-cols-4 sm:grid-cols-5 sm:gap-2.5">
            {visible.map(gift => {
              const active = selected?.id === gift.id;
              return <button key={gift.id} aria-pressed={active} onClick={() => setSelected(gift)} className={`group relative flex min-w-0 flex-col items-center overflow-hidden rounded-xl border px-1 pb-2.5 pt-2 text-center transition-all duration-200 ease-out select-none ${active ? 'border-[var(--active-border)] bg-[var(--active-soft)]' : 'border-[var(--border-strong)] bg-[var(--surface)] hover:border-[var(--vanta-gold)]'}`}>
                <span className="relative mb-1 flex h-[74px] w-full items-center justify-center sm:h-[82px]">
                  <span className={`relative flex h-[62px] w-full items-center justify-center sm:h-[70px] `}>
                    <Visual gift={gift} size={80} />
                  </span>
                </span>
                <b className="flex min-h-[2.2em] w-full items-center justify-center break-words text-[11px] font-medium leading-tight text-[var(--text-primary)]">{gift.name}</b>
                <span className={`mt-1 flex max-w-full items-center justify-center gap-1 text-[11px] font-medium tabular-nums ${active ? 'text-[#f0d36d]' : 'text-[var(--text-secondary)]'}`}>
                  <VantaCoinIcon size={12} decorative />{number(gift.price)}
                </span>
              </button>;
            })}
            {!visible.length && <p className="col-span-full py-12 text-center text-sm text-[var(--text-muted)]">No gifts match your search.</p>}
          </div>
        </div>
        <footer className="shrink-0 border-t border-[var(--border)] bg-[var(--background-secondary)] px-3.5 pb-[calc(.75rem_+_env(safe-area-inset-bottom))] pt-3 sm:px-4">
          <label className="mb-2.5 block">
            <span className="sr-only">Optional gift message</span>
            <input value={message} maxLength={160} onChange={event => setMessage(event.target.value)} placeholder="Add a message (optional)" className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--gold-border-strong)]" />
          </label>
          <div className="mb-3 flex items-center gap-1.5" aria-label="Gift quantity">
            {[1, 5, 10].map(amount => <button key={amount} type="button" disabled={sending} onClick={() => setQuantity(amount)} aria-pressed={quantity === amount} className={`min-w-10 rounded-full px-3 py-1.5 text-[11px] font-bold transition ${quantity === amount ? 'bg-[#e7c65b] text-[#17130a]' : 'bg-[var(--surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>×{amount}</button>)}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5">
            <div className="min-w-0">
              {selected ? <>
                <p className={`truncate text-[13px] font-semibold ${insufficient ? 'text-rose-300' : 'text-[var(--text-primary)]'}`}>{selected.name}</p>
                <p className={`flex items-center gap-1 truncate text-[12px] font-bold tabular-nums ${insufficient ? 'text-rose-300/90' : 'text-[#f0d36d]'}`}><VantaCoinIcon size={12} />{number(totalCost)}</p>
              </> : <>
                <p className="truncate text-[13px] text-[var(--text-secondary)]">Select a gift</p>
              </>}
            </div>
            <button disabled={!selected || insufficient || sending || !validRecipient} onClick={() => void send()} className="h-11 min-w-[116px] max-w-[45vw] rounded-xl border border-[#f0d879]/50 bg-[#e7c65b] px-4 text-xs font-extrabold text-[#1a1507] transition hover:brightness-105 active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-45 sm:min-w-[132px] sm:px-5">
              <span className="flex min-w-0 items-center justify-center gap-1.5">{sending ? <><Loader2 size={16} className="shrink-0 animate-spin" /><span>Sending</span></> : <><Send size={15} className="shrink-0" /><span className="truncate">{selected ? `Send${quantity > 1 ? ` ×${quantity}` : ''}` : 'Send Gift'}</span></>}</span>
            </button>
          </div>
          {insufficient && <button onClick={() => router.push('/balance')} className="btn-gold-ghost mt-2.5 h-10 w-full text-xs">Add VANTA Coins</button>}
          {!validRecipient ? <p className="mt-2 text-center text-[11px] text-rose-300/90">Select a creator or stream before sending a gift.</p> : insufficient && <p className="mt-2 text-center text-[11px] text-rose-300/90">Not enough coins for this gift.</p>}
        </footer>
      </motion.div>}</AnimatePresence>
    </motion.section>
  </>;
}
