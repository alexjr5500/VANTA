'use client';
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { AlertCircle, Check, ChevronLeft, Gift, Loader2, RefreshCw, Search, Send, X } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import GiftArtwork from '@/components/gifts/GiftArtwork';
import VantaCoinIcon from '@/components/ui/VantaCoinIcon';
import { apiPost } from '@/lib/apiClient';
import { giftRecipientCoins } from '@/lib/wallet';

import { useToast } from '@/components/ui/Toast';
import { filterGiftCatalog, visibleGiftCategories, giftCategoryCount, type GiftCatalogItem, type GiftCategoryId } from '@/lib/giftCatalog';
export type { GiftCatalogItem } from '@/lib/giftCatalog';

interface Recipient { id: string; username: string; fullName?: string; avatar?: string }
const number = (value: number) => new Intl.NumberFormat().format(value);

function Visual({ gift, preview = false }: { gift: GiftCatalogItem; preview?: boolean }) {
  const [failed, setFailed] = useState(false);
  const asset = preview ? gift.previewAssetUrl || gift.animationUrl || gift.image || gift.thumbnailUrl : gift.thumbnailUrl || gift.image;
  if (asset && !failed) return /\.(mp4|webm)(\?|$)/i.test(asset)
    ? <video src={asset} autoPlay={preview} loop muted playsInline preload={preview ? 'metadata' : 'none'} onError={() => setFailed(true)} className="h-full w-full object-contain" />
    : <img src={asset} alt="" loading={preview ? 'eager' : 'lazy'} onError={() => setFailed(true)} className="h-full w-full object-contain" />;
  return <GiftArtwork slug={gift.slug} name={gift.name} artworkType={gift.artworkType} assetUrl={asset} size={preview ? 168 : 68} animate={preview} />;
}

export default function GiftPicker({ gifts, balance, recipient, token, streamId, initialGift, loading = false, loadError, onRetry, onClose, onSent }: { gifts: GiftCatalogItem[]; balance: number; recipient: Recipient; token: string; streamId?: string; initialGift?: GiftCatalogItem | null; loading?: boolean; loadError?: string; onRetry?: () => void; onClose: () => void; onSent: (_balance: number, _amount: number, _gift: GiftCatalogItem) => void }) {
  const router = useRouter(), toast = useToast();
  const [query, setQuery] = useState(''), [category, setCategory] = useState<GiftCategoryId>('all');
  const [selected, setSelected] = useState<GiftCatalogItem | null>(initialGift || null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false), [sent, setSent] = useState(false);
  const visible = useMemo(() => filterGiftCatalog(gifts, category, query), [gifts, category, query]);
  const categories = useMemo(() => visibleGiftCategories(gifts), [gifts]);
  const insufficient = !!selected && selected.price > balance;
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
    try { const response = await apiPost<any>('/api/monetization/gifts/send', { receiverId: recipient.id, giftId: selected.id, streamId, quantity: 1, message: message.trim() || undefined, requestId }, token); const result = response.transaction || response; onSent(response.remainingBalance ?? result.remainingBalance ?? balance, response.amount ?? result.amount ?? selected.price, selected); setSent(true); setTimeout(onClose, 2100); }
    catch (error: any) { toast.error('Gift not sent', error?.message || 'The transaction could not be completed.'); setSending(false); }
  };
  return <>
    <motion.button aria-label="Close gift picker" disabled={sending} onClick={onClose} className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-xl" initial={{opacity:0}} animate={{opacity:1}} />
    <motion.section role="dialog" aria-modal="true" aria-labelledby="gift-title" initial={{opacity:0,y:24,scale:.97}} animate={{opacity:1,y:0,scale:1}} className="fixed inset-x-0 bottom-0 top-[max(8px,env(safe-area-inset-top))] z-[80] flex min-h-0 w-full flex-col overflow-hidden rounded-t-xl border-t border-white/[0.08] bg-[#101010] shadow-2xl sm:left-1/2 sm:top-[5dvh] sm:max-w-2xl sm:-translate-x-1/2 sm:rounded-xl sm:border">
      <header className="flex shrink-0 items-center gap-2 border-b border-white/10 bg-[#161616]/95 px-3 py-2.5 backdrop-blur-xl "><button aria-label="Back" disabled={sending} onClick={onClose} className="flex h-9 items-center gap-1 rounded-lg px-1.5 text-xs text-white/70 hover:bg-white/10"><ChevronLeft size={19}/><span className="hidden ">Back</span></button><Avatar src={recipient.avatar} alt={recipient.username} size="sm"/><div className="min-w-0 flex-1"><h2 id="gift-title" className="truncate text-sm font-semibold text-white ">Send a Gift</h2><p className="truncate text-[11px] text-white/45">{recipient.fullName || recipient.username} · @{recipient.username}</p></div><span className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[.04] px-2.5 py-1.5 text-sm font-semibold text-white"><VantaCoinIcon size={14} className="text-[var(--vanta-gold)]"/>{number(balance)}</span><button aria-label="Close" disabled={sending} onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg text-white/55 hover:bg-white/10"><X size={19}/></button></header>
      <AnimatePresence mode="wait">{sent && selected ? <motion.div key="success" initial={{opacity:0,scale:.9}} animate={{opacity:1,scale:1}} className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden p-8 text-center"><motion.div initial={{y:30,scale:.5}} animate={{y:[0,-6,0],scale:1}} className="relative flex h-44 w-44 items-center justify-center"><Visual gift={selected} preview/></motion.div><span className="relative grid h-10 w-10 place-items-center rounded-full bg-white text-black"><Check size={22}/></span><h3 className="relative mt-3 text-xl font-bold text-white">Gift sent</h3><p className="relative mt-1 text-sm text-white/60">You sent a {selected.name} to {recipient.fullName || recipient.username}</p></motion.div> : loading ?
      <div className="flex min-h-72 flex-1 flex-col items-center justify-center gap-3 text-sm text-white/55"><Loader2 className="animate-spin text-[#d8d8d8]"/><span>Loading gifts and balance...</span></div> : loadError ?
      <div className="flex min-h-72 flex-1 flex-col items-center justify-center p-6 text-center"><AlertCircle className="text-rose-300"/><h3 className="mt-3 font-semibold">Unable to load gifts. Please try again.</h3><p className="mt-1 max-w-sm text-xs text-white/45">{loadError}</p>{onRetry&&<button onClick={onRetry} className="mt-5 flex h-10 items-center gap-2 rounded-lg bg-white/10 px-4 text-sm hover:bg-white/15"><RefreshCw size={15}/>Retry</button>}</div> : !gifts.length ?
      <div className="flex min-h-72 flex-1 flex-col items-center justify-center p-6 text-center"><Gift className="text-white/25"/><h3 className="mt-3 font-semibold">No gifts available right now</h3><p className="mt-1 text-xs text-white/45">The gift catalog is currently empty.</p>{onRetry&&<button onClick={onRetry} className="mt-5 flex h-10 items-center gap-2 rounded-lg bg-white/10 px-4 text-sm hover:bg-white/15"><RefreshCw size={15}/>Retry</button>}</div> :
      <motion.div key="catalog" className="flex min-h-0 flex-1 flex-col">{selected && <div className="relative flex h-[150px] shrink-0 items-center justify-center overflow-hidden border-b border-white/[.07] bg-[#0c0c0c] "><motion.div key={selected.id} initial={{opacity:0,y:12,scale:.82}} animate={{opacity:1,y:0,scale:1}} className="relative flex h-[120px] w-[180px] items-center justify-center "><Visual gift={selected} preview/></motion.div><div className="absolute bottom-2 text-center"><h3 className="text-sm font-bold text-white">{selected.name}</h3><p className="flex items-center justify-center gap-1 text-[11px] text-[#b8b8b8]"><VantaCoinIcon size={11} className="text-[var(--vanta-gold)]"/>{number(selected.price)} VANTA Coins</p></div></div>}
        <div className="shrink-0 space-y-2 border-b border-white/10 bg-[#161616]/95 px-3 py-2.5 "><div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search gifts..." className="h-9 w-full rounded-lg border border-white/10 bg-white/[.045] pl-9 pr-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/30"/></div><div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">{categories.map(tab=><button key={tab.id} onClick={()=>setCategory(tab.id)} className={`shrink-0 rounded-full px-2.5 py-1.5 text-[11px] font-medium ${category===tab.id?'bg-white text-black':'bg-white/[.05] text-white/55'}`}>{tab.label} <span className="opacity-65">{giftCategoryCount(gifts,tab.id)}</span></button>)}</div></div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2  "><div className="grid grid-cols-3 gap-1.5  ">{visible.map(gift=>{const active=selected?.id===gift.id;return <button key={gift.id} aria-pressed={active} onClick={()=>setSelected(gift)} className={`relative flex min-h-[102px] flex-col items-center rounded-xl border px-1 py-2 text-center transition ${active?'scale-[1.02] border-white/30 bg-white/[0.08]':'border-transparent bg-white/[.018] hover:bg-white/[.05]'}`}>{active&&<span className="absolute right-1.5 top-1.5 z-10 grid h-4 w-4 place-items-center rounded-full bg-white text-black"><Check size={10}/></span>}<div className="flex h-[58px] w-full items-center justify-center"><Visual gift={gift}/></div><b className="w-full truncate text-[11px] text-white">{gift.name}</b><span className="flex items-center gap-0.5 text-[10px] text-white/60"><VantaCoinIcon size={10} className="text-[#d8d8d8]"/>{number(gift.price)}</span></button>})}{!visible.length&&<p className="col-span-full py-12 text-center text-sm text-white/40">No gifts match your search.</p>}</div></div>
        <footer className="shrink-0 border-t border-white/[0.08] bg-[#0e0e0e]/95 px-3 py-2.5 pb-[calc(.625rem+env(safe-area-inset-bottom))]"><label className="mb-2 block"><span className="sr-only">Optional gift message</span><input value={message} maxLength={160} onChange={event=>setMessage(event.target.value)} placeholder="Add a message (optional)" className="h-9 w-full rounded-md border border-white/[0.1] bg-[#161616] px-3 text-xs text-white outline-none placeholder:text-white/30 focus:border-white/25"/></label><div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"><div className="min-w-0"><p className="truncate text-xs font-semibold text-white">{selected?.name||'Select a gift'}</p><p className={`truncate text-[11px] ${insufficient?'text-rose-300':'text-white/60'}`}>{selected?`${number(selected.price)} VANTA Coins`:`Balance ${number(balance)} VANTA Coins`}</p>{selected&&!insufficient&&<p className="truncate text-[10px] text-white/40">Recipient receives {number(giftRecipientCoins(selected.price))} coins</p>}</div><button disabled={!selected||insufficient||sending||!validRecipient} onClick={()=>void send()} className="btn-gold h-10 min-w-[104px] max-w-[46vw] px-3 text-xs"><span className="flex min-w-0 items-center gap-1.5">{sending?<><Loader2 size={16} className="shrink-0 animate-spin"/><span>Sending</span></>:<><Send size={15} className="shrink-0"/><span className="truncate">{selected?`Send ${selected.name}`:'Send Gift'}</span></>}</span></button></div>{insufficient&&<button onClick={()=>router.push('/balance')} className="mt-2 h-9 w-full rounded-md border border-[var(--gold-border)] text-xs text-[var(--vanta-gold-bright)]">Add VANTA Coins</button>}{!validRecipient?<p className="mt-1 text-[10px] text-rose-300">Select a creator or stream before sending a gift.</p>:insufficient&&<p className="mt-1 text-[10px] text-rose-300">Not enough VANTA Coins. You need {number(selected!.price)} VANTA Coins to send this gift.</p>}</footer>
      </motion.div>}</AnimatePresence>
    </motion.section>
  </>;
}
