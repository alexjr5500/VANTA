'use client';

import { motion } from 'framer-motion';
import { Bookmark, Flag, Trash2, Users, X } from 'lucide-react';

type Item = Record<string, any>;

type Props = {
  item: Item;
  isOwn: boolean;
  close: () => void;
  openProfile: () => void;
  save: () => void;
  remove: () => void;
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
export default function FeedPostMoreSheet({ item, isOwn, close, openProfile, save, remove, reel = false, report }: Props) {
  const saveLabel = item.saved ? 'Remove from saved' : reel ? 'Save reel' : 'Save post';
  return <><motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} aria-label="Close post options" className="fixed inset-0 z-50 bg-black/70"/><motion.section role="dialog" aria-modal="true" aria-label="Post options" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 18 }} className="fixed bottom-[var(--vanta-kb,0px)] left-0 right-0 z-50 mx-auto max-h-[calc(var(--vanta-vh,100dvh)-8px)] max-w-md overflow-y-auto overscroll-contain rounded-t-xl border border-white/[.1] bg-[#161616] p-3"><button type="button" onClick={save} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-sm text-[#d8d8d8] hover:bg-white/[.05]"><Bookmark size={18}/>{saveLabel}</button><button type="button" onClick={openProfile} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-sm text-[#d8d8d8] hover:bg-white/[.05]"><Users size={18}/>{isOwn ? 'Open your profile' : 'View creator profile'}</button>{reel && report && <button type="button" onClick={report} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-sm text-amber-200/90 hover:bg-white/[.05]"><Flag size={18}/>Report {reel ? 'reel' : 'post'}</button>}{isOwn && <button type="button" onClick={remove} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-sm text-rose-300 hover:bg-white/[.05]"><Trash2 size={18}/>Delete</button>}<button type="button" onClick={close} className="mt-2 min-h-12 w-full rounded-lg border border-white/[.08] text-sm text-[#8a8a8a] hover:bg-white/[.05]">Cancel</button></motion.section></>;
}