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
              className="fixed inset-0 z-40 bg-black/40"
              onClick={() => setOpen(false)}
            />

            <motion.div
              role="menu"
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.16 }}
              className="absolute right-0 bottom-16 z-50 w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#101010]/95 shadow-2xl backdrop-blur-2xl"
            >
            <div className="border-b border-white/[0.06] p-3">
              <div className="mb-2 flex items-center gap-2 px-1">
                <MessageCircle size={14} className="text-white/60" />
                <p className="text-xs font-semibold text-white">New Direct Chat</p>
              </div>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => onSearch(event.target.value)}
                  placeholder="Search people"
                  className="w-full rounded-lg border border-white/[0.08] bg-[#161616] py-2 pl-9 pr-4 text-xs text-white outline-none placeholder:text-gray-500 focus:border-white/20"
                  autoFocus
                />
              </div>
            </div>

            <div className="space-y-0.5 p-2">
              {results.map((person) => (
                <button
                  key={person.id}
                  type="button"
                  role="menuitem"
                  onClick={() => runAndClose(() => onSelectUser(person))}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.04]"
                >
                  <Avatar src={person.avatar} alt={person.username || person.fullName} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white">{person.fullName || person.username}</p>
                    <p className="text-[10px] text-white/40">@{person.username}</p>
                  </div>
                </button>
              ))}
              {search.length >= 2 && results.length === 0 && (
                <p className="px-3 py-2 text-xs text-white/30">No matching users found.</p>
              )}

              <button type="button" role="menuitem" onClick={() => runAndClose(onNewGroup)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.04]">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10">
                  <Users size={16} className="text-emerald-400" />
                </span>
                <span>
                  <span className="block text-sm font-medium text-white">New Group</span>
                  <span className="block text-[10px] text-white/40">Create a group conversation</span>
                </span>
              </button>

              <button type="button" role="menuitem" onClick={() => runAndClose(onNewChannel)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.04]">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-amber-500/20 bg-amber-500/10">
                  <Hash size={16} className="text-amber-400" />
                </span>
                <span>
                  <span className="block text-sm font-medium text-white">New Channel</span>
                  <span className="block text-[10px] text-white/40">Broadcast to your audience</span>
                </span>
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