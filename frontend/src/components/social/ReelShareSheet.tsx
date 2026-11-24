'use client';

import BookmarkIcon from '@/components/ui/BookmarkIcon';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Check, Download, Flag, Link2, RefreshCw, Search, Send, Share2, X } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import { apiGet } from '@/lib/apiClient';
import { cn } from '@/lib/utils';

type Recipient = { id: string; name: string; avatar?: string | null };

type Props = {
  token?: string | null;
  url: string;
  title: string;
  reposted?: boolean;
  saved: boolean;
  close: () => void;
  onRepost?: () => void;
  onCopy: () => void;
  onNative: () => void;
  onSave: () => void;
  /** Export + save a VANTA-branded copy. Omit to hide (browser can't export). */
  onDownload?: () => void;
  /** 0..1 while exporting, null when idle. */
  downloadProgress?: number | null;
  onReport: () => void;
  /** Sends the reel link into an existing VANTA conversation. */
  onSend: (conversationId: string) => Promise<void>;
};

/**
 * ReelShareSheet: TikTok-style share sheet for the Reel page. Header with
 * recipient search, a horizontal row of recent VANTA conversations, a row of
 * share targets (Repost, Copy link, apps) and a row of secondary actions.
 */
export default function ReelShareSheet({ token, url, title, reposted, saved, close, onRepost, onCopy, onNative, onSave, onDownload, downloadProgress = null, onReport, onSend }: Props) {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(Boolean(token));
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [sent, setSent] = useState<Record<string, 'sending' | 'sent'>>({});

  useEffect(() => {
    if (!token) return;
    let active = true;
    void apiGet<any>('/api/messages?limit=25', token, { skipCache: true })
      .then(data => {
        if (!active) return;
        const list = Array.isArray(data) ? data : data?.conversations ?? data?.data ?? [];
        setRecipients(list.map((conv: any) => ({
          id: String(conv.id),
          name: conv.name || conv.partner?.fullName || conv.partner?.username || 'Chat',
          avatar: conv.partner?.avatar || conv.avatar || null,
        })));
      })
      .catch(() => { if (active) setRecipients([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? recipients.filter(item => item.name.toLowerCase().includes(needle)) : recipients;
  }, [recipients, query]);

  const send = async (recipient: Recipient) => {
    if (sent[recipient.id]) return;
    setSent(current => ({ ...current, [recipient.id]: 'sending' }));
    try {
      await onSend(recipient.id);
      setSent(current => ({ ...current, [recipient.id]: 'sent' }));
    } catch {
      setSent(current => { const next = { ...current }; delete next[recipient.id]; return next; });
    }
  };

  const enc = encodeURIComponent(url);
  const text = encodeURIComponent(title);
  const external = [
    { label: 'WhatsApp', href: `https://wa.me/?text=${text}%20${enc}`, color: 'bg-[#25D366]', glyph: 'W' },
    { label: 'X', href: `https://twitter.com/intent/tweet?text=${text}&url=${enc}`, color: 'bg-black ring-1 ring-white/20', glyph: 'X' },
    { label: 'Telegram', href: `https://t.me/share/url?url=${enc}&text=${text}`, color: 'bg-[#229ED9]', glyph: 'T' },
    { label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${enc}`, color: 'bg-[#1877F2]', glyph: 'f' },
  ];

  return <>
    <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} aria-label="Close share options" className="fixed inset-0 z-[89] bg-black/60" />
    <motion.section role="dialog" aria-modal="true" aria-label="Share reel" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'tween', duration: 0.22 }} className="fixed bottom-[var(--vanta-kb,0px)] left-0 right-0 z-[90] mx-auto max-h-[calc(var(--vanta-vh,100dvh)-8px)] max-w-lg overflow-y-auto overscroll-contain rounded-t-2xl bg-[#1b2028] pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl">
      <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/20" />
      <header className="flex h-12 items-center gap-2 px-3">
        {searching ? (
          <input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search" aria-label="Search conversations" className="min-w-0 flex-1 rounded-full bg-white/[.08] px-4 py-2 text-sm text-white outline-none placeholder:text-white/40" />
        ) : (
          <>
            <button type="button" onClick={() => setSearching(true)} aria-label="Search conversations" className="grid h-9 w-9 place-items-center rounded-full text-white/70 hover:bg-white/[.06]"><Search size={20} /></button>
            <h2 className="flex-1 text-center text-[15px] font-semibold text-white">Send to</h2>
          </>
        )}
        <button type="button" onClick={searching ? () => { setSearching(false); setQuery(''); } : close} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full text-white/70 hover:bg-white/[.06]"><X size={20} /></button>
      </header>

      {token && (
        <div className="flex gap-4 overflow-x-auto px-4 pb-4 pt-1 [scrollbar-width:none]">
          {loading ? [0, 1, 2, 3, 4].map(i => <div key={i} className="flex w-16 shrink-0 flex-col items-center gap-2"><div className="skeleton h-14 w-14 rounded-full" /><div className="skeleton h-2.5 w-12 rounded" /></div>)
            : visible.length === 0 ? <p className="py-4 text-xs text-white/40">{query ? 'No matching conversations.' : 'No conversations yet.'}</p>
            : visible.map(item => {
              const state = sent[item.id];
              return <button key={item.id} type="button" onClick={() => void send(item)} disabled={Boolean(state)} className="flex w-16 shrink-0 flex-col items-center gap-1.5 text-center">
                <span className="relative">
                  <Avatar src={item.avatar} alt={item.name} fallback={item.name} wrapperClassName="!h-14 !w-14" className="!h-14 !w-14" />
                  {state && <span className="absolute inset-0 grid place-items-center rounded-full bg-black/60 text-white">{state === 'sent' ? <Check size={20} /> : <Send size={16} className="animate-pulse" />}</span>}
                </span>
                <span className="line-clamp-2 w-full break-words text-[11px] leading-tight text-white/70">{state === 'sent' ? 'Sent' : item.name}</span>
              </button>;
            })}
        </div>
      )}

      <div className="flex gap-4 overflow-x-auto border-t border-white/[.07] px-4 py-4 [scrollbar-width:none]">
        {token && onRepost && <Target label={reposted ? 'Remove repost' : 'Repost'} color="bg-[#e0bb4f] text-black" onClick={onRepost}><RefreshCw size={22} /></Target>}
        <Target label="Copy link" color="bg-[#2f6bff] text-white" onClick={onCopy}><Link2 size={22} /></Target>
        {external.map(item => <a key={item.label} href={item.href} target="_blank" rel="noopener noreferrer" onClick={close} className="flex w-16 shrink-0 flex-col items-center gap-1.5"><span className={cn('grid h-14 w-14 place-items-center rounded-full text-xl font-bold text-white', item.color)}>{item.glyph}</span><span className="text-[11px] text-white/70">{item.label}</span></a>)}
        <Target label="More" color="bg-white/10 text-white" onClick={onNative}><Share2 size={22} /></Target>
      </div>

      {token && (
        <div className="flex gap-4 overflow-x-auto border-t border-white/[.07] px-4 pt-4 [scrollbar-width:none]">
          {onDownload && <Target label={downloadProgress !== null ? `${Math.round(downloadProgress * 100)}%` : 'Save video'} color="bg-white/10 text-white/80" onClick={downloadProgress !== null ? () => undefined : onDownload}><Download size={21} className={downloadProgress !== null ? 'animate-pulse' : ''} /></Target>}
          <Target label={saved ? 'Unsave' : 'Save'} color={saved ? 'bg-[#dfbd55]/10 text-[#dfbd55]' : 'bg-white/10 text-white/80'} onClick={onSave}><BookmarkIcon size={21} saved={saved} /></Target>
          <Target label="Report" color="bg-white/10 text-white/80" onClick={onReport}><Flag size={21} /></Target>
        </div>
      )}
    </motion.section>
  </>;
}

function Target({ label, color, onClick, children }: { label: string; color: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} className="flex w-16 shrink-0 flex-col items-center gap-1.5"><span className={cn('grid h-14 w-14 place-items-center rounded-full', color)}>{children}</span><span className="text-center text-[11px] leading-tight text-white/70">{label}</span></button>;
}
