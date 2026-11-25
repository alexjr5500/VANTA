'use client';

import BookmarkIcon from '@/components/ui/BookmarkIcon';

import { motion } from 'framer-motion';
import { Download, Flag, Link2, MessageCircle, Smartphone, Trash2, Users, X } from 'lucide-react';

type Item = Record<string, any>;

type Props = {
  item: Item;
  dropdown?: boolean;
  isOwn: boolean;
  close: () => void;
  openProfile: () => void;
  save: () => void;
  remove: () => void;
  /** Share actions (copy link / device share / VANTA chat) shown in this menu. */
  share?: (destination: 'COPY_LINK' | 'NATIVE' | 'MESSAGE') => void;
  /** Save a VANTA-watermarked copy of the post video. Omit to hide. */
  download?: () => void;
  downloading?: boolean;
  /** Renders the reel-flavoured labels + a Report action (used on Reel detail). */
  reel?: boolean;
  /** Show the report action (reels only). The caller submits the compliance report. */
  report?: () => void;
};

/**
 * FeedPostMoreSheet — the "more (•••)" menu that opens on every post rendered
 * with FeedPostCard, and on Post/Reel detail pages. Identical on Home and
 * Profile so the post menu interaction UI is consistent everywhere. Debounced
 * actions are supplied by the caller and operate against the real backend
 * (save/bookmark, open profile, report, delete).
 */
export default function FeedPostMoreSheet({ item, isOwn, close, openProfile, save, remove, share, download, downloading = false, reel = false, report, dropdown = false }: Props) {
  const saveLabel = item.saved ? 'Remove from saved' : reel ? 'Save reel' : 'Save post';
  if (dropdown) return <><motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} aria-label="Close post options" className="fixed inset-0 z-50 cursor-default bg-transparent"/><motion.section role="menu" aria-label="Post options" initial={{ opacity: 0, y: -5, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -5, scale: .98 }} className="fixed right-3 top-[calc(env(safe-area-inset-top)+3.25rem)] z-[60] w-64 overflow-hidden rounded-xl border border-white/[.1] bg-[#171b21] p-1.5 shadow-2xl shadow-black/40"><button type="button" role="menuitem" onClick={save} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-white/85 transition hover:bg-white/[.06]"><BookmarkIcon size={17} saved={Boolean(item.saved)} />{saveLabel}</button><button type="button" role="menuitem" onClick={openProfile} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-white/85 transition hover:bg-white/[.06]"><Users size={17}/>{isOwn ? 'Open your profile' : 'View creator profile'}</button>{share && <><button type="button" role="menuitem" onClick={() => share('COPY_LINK')} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-white/85 transition hover:bg-white/[.06]"><Link2 size={17}/>Copy link</button><button type="button" role="menuitem" onClick={() => share('NATIVE')} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-white/85 transition hover:bg-white/[.06]"><Smartphone size={17}/>Share with…</button><button type="button" role="menuitem" onClick={() => share('MESSAGE')} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-white/85 transition hover:bg-white/[.06]"><MessageCircle size={17}/>Send in VANTA chat</button></>}{download && <button type="button" disabled={downloading} onClick={download} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-[#d8d8d8] hover:bg-white/[.05] disabled:opacity-50"><Download size={18}/>{downloading ? 'Preparing video…' : 'Save video'}</button>}{reel && report && <button type="button" role="menuitem" onClick={report} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-amber-200/90 transition hover:bg-white/[.06]"><Flag size={17}/>Report {reel ? 'reel' : 'post'}</button>}{isOwn && <button type="button" role="menuitem" onClick={remove} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-rose-300 transition hover:bg-white/[.06]"><Trash2 size={17}/>Delete</button>}</motion.section></>;
  return <><motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} aria-label="Close post options" className="fixed inset-0 z-50 bg-black/70"/><motion.section role="dialog" aria-modal="true" aria-label="Post options" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 18 }} className="fixed bottom-[var(--vanta-kb,0px)] left-0 right-0 z-50 mx-auto max-h-[calc(var(--vanta-vh,100dvh)-8px)] max-w-md overflow-y-auto overscroll-contain rounded-t-xl border border-white/[.1] bg-[#161616] p-3"><button type="button" onClick={save} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-sm text-[#d8d8d8] hover:bg-white/[.05]"><BookmarkIcon size={18} saved={Boolean(item.saved)} />{saveLabel}</button><button type="button" onClick={openProfile} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-sm text-[#d8d8d8] hover:bg-white/[.05]"><Users size={18}/>{isOwn ? 'Open your profile' : 'View creator profile'}</button>{share && <><button type="button" onClick={() => share('COPY_LINK')} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-[#d8d8d8] hover:bg-white/[.05]"><Link2 size={18}/>Copy link</button><button type="button" onClick={() => share('NATIVE')} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-[#d8d8d8] hover:bg-white/[.05]"><Smartphone size={18}/>Share with…</button><button type="button" onClick={() => share('MESSAGE')} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-[#d8d8d8] hover:bg-white/[.05]"><MessageCircle size={18}/>Send in VANTA chat</button></>}{download && <button type="button" disabled={downloading} onClick={download} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-[#d8d8d8] hover:bg-white/[.05] disabled:opacity-50"><Download size={18}/>{downloading ? 'Preparing video…' : 'Save video'}</button>}{reel && report && <button type="button" onClick={report} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-sm text-amber-200/90 hover:bg-white/[.05]"><Flag size={18}/>Report {reel ? 'reel' : 'post'}</button>}{isOwn && <button type="button" onClick={remove} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-sm text-rose-300 hover:bg-white/[.05]"><Trash2 size={18}/>Delete</button>}<button type="button" onClick={close} className="mt-2 min-h-12 w-full rounded-lg border border-white/[.08] text-sm text-[#8a8a8a] hover:bg-white/[.05]">Cancel</button></motion.section></>;
}