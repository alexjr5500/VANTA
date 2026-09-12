'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, Hash, MessageCircle, Plus, Search, Users, X } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';

interface MessagesCreateButtonProps {
  search: string;
  results: any[];
  onSearch: (value: string) => void;
  onSelectUser: (person: any) => void | Promise<void>;
  onNewGroup: () => void;
  onNewChannel: () => void;
}

export default function MessagesCreateButton({
  search,
  results,
  onSearch,
  onSelectUser,
  onNewGroup,
  onNewChannel,
}: MessagesCreateButtonProps) {
  const [open, setOpen] = useState(false);

  const runAndClose = (action: () => void | Promise<void>) => {
    setOpen(false);
    void action();
  };

  return (
    <div className="fixed bottom-[max(4.75rem,calc(env(safe-area-inset-bottom)+4rem))] right-4 z-50">
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
              onClick={() => setOpen(false)}
              aria-label="Close create menu"
            />

            {/* Bottom sheet — mobile: slides up with safe-area support and
                rounded top corners. Desktop: centered modal panel. */}
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Create a new chat, group or channel"
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1, transition: { type: 'spring', damping: 30, stiffness: 320 } }}
              exit={{ y: '100%', opacity: 0, transition: { duration: 0.2, ease: 'easeIn' } }}
              className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[80dvh] w-full max-w-[520px] flex-col overflow-hidden rounded-t-[24px] border-x border-t border-white/[0.08] bg-[#0d0d0f]/98 pb-[env(safe-area-inset-bottom)] shadow-2xl backdrop-blur-2xl md:max-h-[min(640px,calc(100dvh-120px))] md:rounded-2xl md:inset-y-0 md:my-auto md:left-1/2 md:-translate-x-1/2"
            >
              {/* Grab handle (mobile) */}
              <div aria-hidden="true" className="mx-auto mt-1.5 h-1 w-10 shrink-0 rounded-full bg-white/15 md:hidden" />

              {/* Header */}
              <div className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] px-4 pt-2 pb-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#d6a83f]/25 bg-[#d6a83f]/10">
                  <MessageCircle size={18} className="text-[#f2c75c]" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">VANTA</p>
                  <h2 className="truncate text-base font-semibold text-white">Start something new</h2>
                </div>
                <button type="button" onClick={() => setOpen(false)} aria-label="Close create menu" className="grid h-9 w-9 place-items-center rounded-full text-[#c8c8cc] transition hover:bg-white/[0.06] hover:text-white"><X size={18} /></button>
              </div>

              {/* Search people */}
              <div className="shrink-0 px-3 pb-1 pt-2">
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#666]" />
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => onSearch(event.target.value)}
                    placeholder="Search people"
                    autoFocus
                    className="h-11 w-full rounded-xl border border-white/[0.08] bg-[#161616] pl-9 pr-4 text-sm text-white outline-none placeholder:text-[#666] focus:border-white/20"
                  />
                </div>
              </div>

              {/* Results + actions */}
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-hide px-3 py-1">
                <p className="mb-1 px-1 text-[10px] font-medium uppercase tracking-[0.14em] text-white/30">Direct message</p>
              {results.map((person) => (
                <button
                  key={person.id}
                  type="button"
                  onClick={() => runAndClose(() => onSelectUser(person))}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-white/[0.05]"
                >
                  <Avatar src={person.avatar} alt={person.username || person.fullName} size="md" />
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white">{person.fullName || person.username}</p>
                    <p className="truncate text-[11px] text-white/45">@{person.username}</p>
                  </div>
                </button>
              ))}
              {search.length >= 2 && results.length === 0 && (
                <p className="px-3 py-3 text-xs text-white/35">No matching users found.</p>
              )}

              <p className="mb-2 mt-3 px-1 text-[10px] font-medium uppercase tracking-[0.14em] text-white/30">Create conversation</p>
              <button type="button" onClick={() => runAndClose(onNewGroup)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-white/[0.05]">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/[0.1] bg-[#161616]">
                  <Users size={19} className="text-[#d6a83f]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-white">New Group</span>
                  <span className="block truncate text-[11px] text-white/45">Create a group conversation</span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-white/35" />
              </button>

              <button type="button" onClick={() => runAndClose(onNewChannel)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-white/[0.05]">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/[0.1] bg-[#161616]">
                  <Hash size={19} className="text-[#d6a83f]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-white">New Channel</span>
                  <span className="block truncate text-[11px] text-white/45">Broadcast to your audience</span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-white/35" />
              </button>
            </div>
          </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main FAB Button */}
      <motion.button
        type="button"
        onClick={() => setOpen((current) => !current)}
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.9 }}
        className="relative z-50 grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-[#f2c75c] via-[#d6a83f] to-[#a8842c] text-black shadow-[0_12px_28px_rgba(0,0,0,.45)] transition-transform"
        aria-label={open ? 'Close new chat menu' : 'New chat'}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <motion.span
          animate={{ rotate: open ? 45 : 0 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          <Plus size={26} strokeWidth={2.5} />
        </motion.span>
      </motion.button>
    </div>
  );
}