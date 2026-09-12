'use client';

import { motion } from 'framer-motion';
import { Share2, X } from 'lucide-react';

type FeedShareDestination = 'COPY_LINK' | 'NATIVE' | 'MESSAGE';

type Props = {
  close: () => void;
  share: (destination: FeedShareDestination) => void;
};

/**
 * FeedPostShareSheet — the bottom sheet for sharing a post. Identical on Home and
 * Profile so the share action interaction UI is consistent. Each destination is
 * a real backend action supplied by the caller (copy link, native share, message).
 */
export default function FeedPostShareSheet({ close, share }: Props) {
  const destinations: Array<[FeedShareDestination, string]> = [
    ['COPY_LINK', 'Copy link'],
    ['NATIVE', 'Share'],
    ['MESSAGE', 'Message'],
  ];
  return <><motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} aria-label="Close share options" className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"/><motion.section role="dialog" aria-modal="true" aria-label="Share post" initial={{ opacity: 0, y: 18, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18, scale: .98 }} className="fixed bottom-0 left-0 right-0 z-50 mx-auto max-w-lg rounded-t-xl border border-white/[.1] bg-[#161616] p-5 shadow-2xl    "><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Share post</h2><button type="button" onClick={close} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-lg text-[#8a8a8a] hover:bg-white/[.05] hover:text-white"><X size={18}/></button></div><div className="grid grid-cols-3 gap-2">{destinations.map(([id, label]) => <button key={id} type="button" onClick={() => share(id)} className="rounded-lg border border-white/[.08] p-4 text-xs text-[#b8b8b8] hover:bg-white/[.05]"><Share2 size={19} className="mx-auto mb-2 text-white"/>{label}</button>)}</div></motion.section></>;
}