'use client';

import { motion } from 'framer-motion';
import { Bookmark, Trash2, Users, X } from 'lucide-react';

type Item = Record<string, any>;

type Props = {
  item: Item;
  isOwn: boolean;
  close: () => void;
  openProfile: () => void;
  save: () => void;
  remove: () => void;
};

/**
 * FeedPostMoreSheet — the "more (•••)" menu that opens on every post rendered
 * with FeedPostCard. Identical on Home and Profile so the post menu interaction
 * UI is consistent everywhere. Debounced actions are supplied by the caller and
 * operate against the real backend (save/bookmark, open profile, delete).
 */
export default function FeedPostMoreSheet({ item, isOwn, close, openProfile, save, remove }: Props) {
  return <><motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} aria-label="Close post options" className="fixed inset-0 z-50 bg-black/70"/><motion.section role="dialog" aria-modal="true" aria-label="Post options" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 18 }} className="fixed bottom-0 left-0 right-0 z-50 mx-auto max-w-md rounded-t-xl border border-white/[.1] bg-[#161616] p-3    "><button type="button" onClick={save} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-sm text-[#d8d8d8] hover:bg-white/[.05]"><Bookmark size={18}/>{item.saved ? 'Remove from saved' : 'Save post'}</button><button type="button" onClick={openProfile} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-sm text-[#d8d8d8] hover:bg-white/[.05]"><Users size={18}/>{isOwn ? 'Open your profile' : 'View creator profile'}</button>{isOwn && <button type="button" onClick={remove} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-sm text-rose-300 hover:bg-white/[.05]"><Trash2 size={18}/>Delete</button>}<button type="button" onClick={close} className="mt-2 min-h-12 w-full rounded-lg border border-white/[.08] text-sm text-[#8a8a8a] hover:bg-white/[.05]">Cancel</button></motion.section></>;
}