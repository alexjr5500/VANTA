'use client';
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { AlertCircle, Check, Gift, Loader2, RefreshCw, Search, Send, X } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import GiftArtwork from '@/components/gifts/GiftArtwork';
import VantaCoinIcon from '@/components/ui/VantaCoinIcon';
import { apiPost } from '@/lib/apiClient';
import { giftRecipientCoins } from '@/lib/wallet';

import { useToast } from '@/components/ui/Toast';
import { filterGiftCatalog, visibleGiftCategories, giftCategoryCount, giftVisualQuality, type GiftCatalogItem, type GiftCategoryId } from '@/lib/giftCatalog';
export type { GiftCatalogItem } from '@/lib/giftCatalog';

interface Recipient { id: string; username: string; fullName?: string; avatar?: string }
const number = (value: number) => new Intl.NumberFormat().format(value);

function Visual({ gift, preview = false, size = 68 }: { gift: GiftCatalogItem; preview?: boolean; size?: number }) {
  const [failed, setFailed] = useState(false);
  const asset = preview ? gift.previewAssetUrl || gift.animationUrl || gift.image || gift.thumbnailUrl : gift.thumbnailUrl || gift.image;
  if (asset && !failed) return /\.(mp4|webm)(\?|$)/i.test(asset)
    ? <video src={asset} autoPlay={preview} loop muted playsInline preload={preview ? 'metadata' : 'none'} onError={() => setFailed(true)} className="h-full w-full object-contain" />
    : <img src={asset} alt="" loading={preview ? 'eager' : 'lazy'} onError={() => setFailed(true)} className="h-full w-full object-contain" />;
  return <GiftArtwork slug={gift.slug} name={gift.name} artworkType={gift.artworkType} assetUrl={asset} size={preview ? 168 : size} animate={preview} quality={giftVisualQuality(gift)} />;
}

export default function GiftPicker({ gifts, balance, recipient, token, streamId, initialGift, loading = false, loadError, onRetry, onClose, onSent }: { gifts: GiftCatalogItem[]; balance: number; recipient: Recipient; token: string; streamId?: string; initialGift?: GiftCatalogItem | null; loading?: boolean; loadError?: string; onRetry?: () => void; onClose: () => void; onSent: (_balance: number, _amount: number, _gift: GiftCatalogItem) => void }) {
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
  const visualTier = selected ? giftVisualQuality(selected) : 0;
  const tierLabel = visualTier >= 5 ? 'MYTHIC' : visualTier >= 4 ? 'LEGENDARY' : visualTier >= 3 ? 'PREMIUM' : visualTier >= 2 ? 'SPECIAL' : 'GIFT';
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
    try { const response = await apiPost<any>('/api/monetization/gifts/send', { receiverId: recipient.id, giftId: selected.id, streamId, quantity, message: message.trim() || undefined, requestId }, token); const result = response.transaction || response; onSent(response.remainingBalance ?? result.remainingBalance ?? balance, response.amount ?? result.amount ?? selected.price, selected); setSent(true); setTimeout(onClose, 2100); }
    catch (error: any) { toast.error('Gift not sent', error?.message || 'The transaction could not be completed.'); setSending(false); }
  };
  return <>
    <motion.button aria-label="Close gift picker" disabled={sending} onClick={onClose} className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-sm" initial={{opacity:0}} animate={{opacity:1}} />
    <motion.section
      role="dialog"
      aria-modal="true"
      aria-labelledby="gift-title"
      initial={{ opacity: 0, y: '24%' }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: '24%' }}
      className="fixed inset-x-0 bottom-[var(--vanta-kb,0px)] z-[80] mx-auto flex h-[min(690px,var(--vanta-vh,100dvh))] max-h-[calc(var(--vanta-vh,100dvh)_-_20px)] w-full max-w-[520px] flex-col overflow-hidden rounded-t-[28px] border-x border-t border-white/[0.1] bg-[#08090d] shadow-[0_-24px_90px_rgba(0,0,0,.6)] sm:max-w-[540px] md:inset-y-0 md:left-1/2 md:my-auto md:h-[min(740px,calc(var(--vanta-vh,100dvh)_-_100px))] md:max-h-none md:max-w-[580px] md:-translate-x-1/2 md:rounded-[28px]"
    >
      <header className="relative flex shrink-0 items-center gap-2.5 border-b border-white/[0.07] bg-[radial-gradient(ellipse_at_top_left,rgba(201,162,39,.13),transparent_55%),#101116] px-3.5 py-3.5 backdrop-blur-xl sm:px-4">
        <Avatar src={recipient.avatar} alt={recipient.username} size="sm" />
        <div className="min-w-0 flex-1">
          <h2 id="gift-title" className="truncate text-[15px] font-bold leading-tight tracking-tight text-white">Send a Gift</h2>
          <p className="mt-0.5 truncate text-[11px] leading-tight text-white/50">
            to {recipient.fullName || recipient.username} <span className="text-white/30">· @{recipient.username}</span>
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-[#e5c35a]/25 bg-[#d8b44b]/[0.09] px-3 py-1.5 text-sm font-bold tabular-nums text-white shadow-[0_0_22px_rgba(201,162,39,.08)]">
          <VantaCoinIcon size={14} className="text-[var(--vanta-gold)]" />{number(balance)}
        </span>
        <button aria-label="Close gift picker" disabled={sending} onClick={onClose} className="-mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"><X size={19} /></button>
      </header>
      <AnimatePresence mode="wait">{sent && selected ? <motion.div key="success" initial={{ opacity: 0, scale: .9 }} animate={{ opacity: 1, scale: 1 }} className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden p-8 text-center">
        <motion.div initial={{ y: 30, scale: .5 }} animate={{ y: [0, -6, 0], scale: 1 }} className="relative flex h-44 w-44 items-center justify-center"><Visual gift={selected} preview /></motion.div>
        <span className="relative grid h-10 w-10 place-items-center rounded-full bg-white text-black"><Check size={22} /></span>
        <h3 className="relative mt-3 text-xl font-bold text-white">Gift sent</h3>
        <p className="relative mt-1 text-sm text-white/60">You sent a {selected.name} to {recipient.fullName || recipient.username}</p>
      </motion.div> : loading ?
      <div className="flex min-h-64 flex-1 flex-col items-center justify-center gap-3 text-sm text-white/55"><Loader2 className="animate-spin text-[#d8d8d8]" /><span>Loading gifts and balance...</span></div> : loadError ?
      <div className="flex min-h-64 flex-1 flex-col items-center justify-center p-6 text-center"><AlertCircle className="text-rose-300" /><h3 className="mt-3 font-semibold">Unable to load gifts. Please try again.</h3><p className="mt-1 max-w-sm text-xs text-white/45">{loadError}</p>{onRetry && <button onClick={onRetry} className="mt-5 flex h-10 items-center gap-2 rounded-lg bg-white/10 px-4 text-sm hover:bg-white/15"><RefreshCw size={15} />Retry</button>}</div> : !gifts.length ?
      <div className="flex min-h-64 flex-1 flex-col items-center justify-center p-6 text-center"><Gift className="text-white/25" /><h3 className="mt-3 font-semibold">No gifts available right now</h3><p className="mt-1 text-xs text-white/45">The gift catalog is currently empty.</p>{onRetry && <button onClick={onRetry} className="mt-5 flex h-10 items-center gap-2 rounded-lg bg-white/10 px-4 text-sm hover:bg-white/15"><RefreshCw size={15} />Retry</button>}</div> :
      <motion.div key="catalog" className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 space-y-3 border-b border-white/[0.07] bg-[#101116] px-3.5 py-3.5 sm:px-4">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search gifts..." className="h-10 w-full rounded-xl border border-white/[0.08] bg-white/[0.035] pl-9 pr-3 text-[13px] text-white outline-none placeholder:text-white/30 transition focus:border-[#d6b34f]/50 focus:bg-white/[0.055]" />
          </div>
          <div className="-mx-0.5 flex items-center gap-1.5 overflow-x-auto px-0.5 scrollbar-hide">
            {categories.map(tab => <button key={tab.id} onClick={() => setCategory(tab.id)} className={`shrink-0 rounded-full border px-3.5 py-2 text-[11px] font-semibold transition-all ${category === tab.id ? 'border-[#e8c85f]/70 bg-gradient-to-b from-[#f2d777] to-[#c49a2f] text-[#17130a] shadow-[0_3px_14px_rgba(201,162,39,.16)]' : 'border-white/[0.06] bg-white/[0.035] text-white/55 hover:border-white/15 hover:bg-white/[0.07] hover:text-white/85'}`}>{tab.label} <span className={category === tab.id ? 'opacity-60' : 'opacity-50'}>{giftCategoryCount(gifts, tab.id)}</span></button>)}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3 pt-3 sm:px-4">
          {selected && <motion.div key={selected.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="relative mb-3.5 overflow-hidden rounded-2xl border border-[#d8b54b]/20 bg-[radial-gradient(ellipse_at_50%_25%,rgba(209,169,61,.2),transparent_60%),linear-gradient(135deg,#171720,#0d0d12_65%,#17140d)] px-3 py-2.5">
            <div className="pointer-events-none absolute inset-0 opacity-30" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px)', backgroundSize: '22px 22px' }} />
            <div className="relative flex items-center gap-3">
              <div className="relative flex h-[86px] w-[86px] shrink-0 items-center justify-center">
                <span className="absolute inset-1 rounded-full bg-[#e6c45b]/20 blur-2xl" />
                <Visual gift={selected} preview size={86} />
              </div>
              <div className="min-w-0 flex-1 py-1">
                <span className="inline-flex items-center gap-1 rounded-full border border-[#e7c75d]/30 bg-[#d5ad3b]/10 px-2 py-0.5 text-[9px] font-black tracking-[.18em] text-[#f0d779]">{visualTier >= 4 ? '✦ ' : ''}{tierLabel}</span>
                <h3 className="mt-1.5 truncate text-[15px] font-extrabold tracking-tight text-white">{selected.name}</h3>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-white/50">{selected.description || (visualTier >= 4 ? 'A signature moment. Make the whole live feel it.' : 'Send a little love and light up the moment.')}</p>
                <p className="mt-1.5 flex items-center gap-1 text-[11px] font-bold text-[#f0d36d]"><VantaCoinIcon size={12} />{number(selected.price)} <span className="font-medium text-white/40">coins each</span></p>
              </div>
            </div>
          </motion.div>}
          <div className="grid grid-cols-5 gap-x-1.5 gap-y-2.5 sm:gap-x-2 sm:gap-y-3">
            {visible.map(gift => {
              const active = selected?.id === gift.id;
              return <button key={gift.id} aria-pressed={active} onClick={() => setSelected(gift)} className={`group relative flex min-w-0 flex-col items-center rounded-2xl border px-1 pb-2 pt-2 text-center transition-all duration-200 ease-out select-none ${active ? 'border-[#e2bf4d]/65 bg-[linear-gradient(180deg,rgba(213,176,65,.16),rgba(213,176,65,.045))] shadow-[inset_0_0_0_1px_rgba(228,195,94,.08),0_6px_20px_rgba(201,162,39,.08)]' : 'border-transparent bg-white/[0.018] hover:border-white/[0.09] hover:bg-white/[0.045] active:scale-[0.97]'}`}>
                {active && <span className="absolute right-0 top-0 z-20 grid h-5 w-5 place-items-center rounded-full bg-gradient-to-br from-[#dfbd55] to-[#9d7d1e] text-black shadow-[0_2px_10px_rgba(201,162,39,0.55)]"><Check size={11} strokeWidth={3} /></span>}
                <span className="relative mb-1 flex h-[62px] w-full items-center justify-center sm:h-[70px]">
                  {active && <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 z-0 h-[52px] w-[52px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#c9a227]/20 blur-xl" />}
                  <span className={`relative z-10 flex h-[62px] w-full items-center justify-center sm:h-[70px] ${active ? 'drop-shadow-[0_0_15px_rgba(231,195,80,.55)]' : 'group-hover:drop-shadow-[0_0_10px_rgba(255,255,255,.14)]'}`}>
                    <Visual gift={gift} size={62} />
                  </span>
                </span>
                <b className="max-w-full truncate text-[10px] font-bold leading-tight text-white sm:text-[11px]">{gift.name}</b>
                <span className={`mt-1 flex max-w-full items-center justify-center gap-0.5 whitespace-nowrap text-[9px] font-semibold tabular-nums sm:text-[10px] ${active ? 'text-[#f0d36d]' : 'text-white/50'}`}>
                  <VantaCoinIcon size={10} className={active ? 'text-[var(--vanta-gold-bright)]' : 'text-[#d8d8d8]'} />{number(gift.price)}
                </span>
              </button>;
            })}
            {!visible.length && <p className="col-span-full py-12 text-center text-sm text-white/40">No gifts match your search.</p>}
          </div>
        </div>
        <footer className="shrink-0 border-t border-white/[0.08] bg-[linear-gradient(180deg,#111116,#09090c)] px-3.5 pb-[calc(.75rem_+_env(safe-area-inset-bottom))] pt-3 sm:px-4">
          <label className="mb-2.5 block">
            <span className="sr-only">Optional gift message</span>
            <input value={message} maxLength={160} onChange={event => setMessage(event.target.value)} placeholder="Add a message (optional)" className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#161616] px-3.5 text-[13px] text-white outline-none placeholder:text-white/35 focus:border-[var(--gold-border-strong)]" />
          </label>
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.035] p-1" aria-label="Gift quantity">
              {[1, 5, 10].map(amount => <button key={amount} type="button" disabled={sending} onClick={() => setQuantity(amount)} aria-pressed={quantity === amount} className={`min-w-9 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition ${quantity === amount ? 'bg-[#e7c65b] text-[#17130a] shadow-[0_2px_10px_rgba(201,162,39,.18)]' : 'text-white/50 hover:bg-white/[0.07] hover:text-white'}`}>{amount === 1 ? '×1' : `×${amount}`}</button>)}
            </div>
            <div className="min-w-0 text-right"><p className={`text-[11px] font-semibold ${insufficient ? 'text-rose-300' : 'text-white/60'}`}>Total</p><p className={`flex items-center justify-end gap-1 text-sm font-extrabold tabular-nums ${insufficient ? 'text-rose-300' : 'text-white'}`}><VantaCoinIcon size={13} className="text-[#e8c75d]" />{number(totalCost)}</p></div>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5">
            <div className="min-w-0">
              {selected ? <>
                <p className={`truncate text-[13px] font-semibold ${insufficient ? 'text-rose-300' : 'text-white'}`}>{selected.name}</p>
                <p className={`truncate text-[11px] ${insufficient ? 'text-rose-300/90' : 'text-white/50'}`}>{number(selected.price)} coins each · {quantity} {quantity === 1 ? 'gift' : 'gifts'}</p>
                {!insufficient && <p className="truncate text-[10px] text-white/35">Creator receives about {number(giftRecipientCoins(totalCost))} coins</p>}
              </> : <>
                <p className="truncate text-[13px] text-white/60">Select a gift</p>
                <p className="truncate text-[11px] text-white/40">Balance {number(balance)} VANTA Coins</p>
              </>}
            </div>
            <button disabled={!selected || insufficient || sending || !validRecipient} onClick={() => void send()} className="h-11 min-w-[116px] max-w-[45vw] rounded-xl border border-[#f0d879]/50 bg-gradient-to-b from-[#f5dc7e] via-[#e0bd52] to-[#bf912b] px-4 text-xs font-extrabold text-[#1a1507] shadow-[0_5px_20px_rgba(201,162,39,.17)] transition hover:brightness-105 active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-45 sm:min-w-[132px] sm:px-5">
              <span className="flex min-w-0 items-center justify-center gap-1.5">{sending ? <><Loader2 size={16} className="shrink-0 animate-spin" /><span>Sending</span></> : <><Send size={15} className="shrink-0" /><span className="truncate">{selected ? `Send${quantity > 1 ? ` ×${quantity}` : ''}` : 'Send Gift'}</span></>}</span>
            </button>
          </div>
          {insufficient && <button onClick={() => router.push('/balance')} className="btn-gold-ghost mt-2.5 h-10 w-full text-xs">Add VANTA Coins</button>}
          {!validRecipient ? <p className="mt-2 text-center text-[11px] text-rose-300/90">Select a creator or stream before sending a gift.</p> : insufficient && <p className="mt-2 text-center text-[11px] text-rose-300/90">Not enough VANTA Coins. You need {number(totalCost)} VANTA Coins for this gift selection.</p>}
        </footer>
      </motion.div>}</AnimatePresence>
    </motion.section>
  </>;
}
