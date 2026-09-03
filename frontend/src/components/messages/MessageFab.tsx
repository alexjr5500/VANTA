'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, UserPlus, Users, Megaphone, X, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MessageFabProps {
  onNewMessage: () => void;
  onSearchPeople: () => void;
  onNewGroup: () => void;
  onNewChannel: () => void;
}

export default function MessageFab({ onNewMessage, onSearchPeople, onNewGroup, onNewChannel }: MessageFabProps) {
  const [open, setOpen] = useState(false);

  const actions = [
    { icon: MessageCircle, label: 'New Chat', color: 'from-[#f5f5f5] to-[#b8b8b8]', onClick: onNewMessage },
    { icon: Search, label: 'Search People', color: 'from-[#2a2a2a] to-[#101010]', onClick: onSearchPeople },
    { icon: Users, label: 'New Group', color: 'from-[#242424] to-[#101010]', onClick: onNewGroup },
    { icon: Megaphone, label: 'New Channel', color: 'from-[#303030] to-[#161616]', onClick: onNewChannel },
  ];

  const handleAction = (fn: () => void) => {
    setOpen(false);
    setTimeout(fn, 150);
  };

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {/* Action Menu */}
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40"
              onClick={() => setOpen(false)}
            />
            
            {/* Menu Items */}
            <div className="absolute bottom-20 right-0 z-50 flex flex-col items-end gap-3">
              {actions.map((action, i) => {
                const Icon = action.icon;
                return (
                  <motion.button
                    key={action.label}
                    initial={{ opacity: 0, y: 20, scale: 0.8 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.8 }}
                    transition={{ delay: i * 0.05, duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    onClick={() => handleAction(action.onClick)}
                    className="flex items-center gap-3 group"
                  >
                    <span className="text-xs font-medium text-white/70 bg-[#0e0e16]/90 backdrop-blur-xl px-3 py-1.5 rounded-xl border border-white/[0.08] shadow-2xl opacity-0 group-hover:opacity-100 transition-opacity mr-1">
                      {action.label}
                    </span>
                    <div className={cn(
                      'w-12 h-12 rounded-full bg-gradient-to-br flex items-center justify-center shadow-2xl hover:scale-110 transition-transform',
                      action.color
                    )}>
                      <Icon size={18} className="text-white" />
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </>
        )}
      </AnimatePresence>

      {/* Main FAB Button */}
      <motion.button
        onClick={() => setOpen(!open)}
        className="relative z-50 w-14 h-14 rounded-full border border-white/[0.16] bg-[#f5f5f5] flex items-center justify-center shadow-2xl transition-shadow duration-300"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.9 }}
        animate={{
          boxShadow: open
            ? '0 16px 40px rgba(0, 0, 0, 0.55)'
            : '0 10px 28px rgba(0, 0, 0, 0.4)',
        }}
        aria-label="New chat"
      >
        <motion.div
          animate={{ rotate: open ? 45 : 0 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          {open ? <X size={22} className="text-black" /> : <MessageCircle size={22} className="text-black" />}
        </motion.div>
      </motion.button>
    </div>
  );
}