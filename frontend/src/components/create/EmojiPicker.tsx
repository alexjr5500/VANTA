'use client';

import React, { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';


const EMOJI_CATEGORIES = [
  {
    name: 'Faces',
    emojis: ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🫢', '🫣', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '🫥', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🥴', '😵', '🤯', '🤠', '🥳', '🥸', '😎'],
  },
  {
    name: 'Gestures',
    emojis: ['👍', '👎', '👊', '✊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✌️', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '👍🏽', '👎🏽', '👊🏽', '✊🏽'],
  },
  {
    name: 'Hearts',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '♥️'],
  },
  {
    name: 'Objects',
    emojis: ['🎉', '🎊', '🎈', '🎁', '🏆', '🥇', '🥈', '🥉', '⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏓', '🎯', '🎮', '🎲', '🎸', '🎹', '🎺', '🎵', '🎶', '📸', '📷', '🎥', '📽️', '💻', '📱', '⌚', '🎧'],
  },
  {
    name: 'Nature',
    emojis: ['🌍', '🌎', '🌏', '🌐', '🌈', '☀️', '🌤️', '⛅', '🌦️', '🌧️', '⛈️', '🌩️', '🌨️', '❄️', '🔥', '💫', '⭐', '🌟', '✨', '⚡', '💥', '🌸', '🌺', '🌻', '🌹', '🍀', '🌿', '🌴', '🌵', '🎄'],
  },
];

interface EmojiPickerProps {
  onEmojiSelect: (emoji: string) => void;
  onClose?: () => void;
  className?: string;
}

export default function EmojiPicker({ onEmojiSelect, onClose, className }: EmojiPickerProps) {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('Faces');

  const filteredEmojis = useCallback(() => {
    if (!search.trim()) return null;
    const all = EMOJI_CATEGORIES.flatMap((c) => c.emojis);
    return all.filter((e) => e.includes(search));
  }, [search]);

  const displayEmojis = filteredEmojis();
  const searchResults = displayEmojis ? displayEmojis : null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 10 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className={cn(
        'w-[320px] rounded-2xl border border-white/[0.08] bg-[#0e0e16]/95 backdrop-blur-2xl shadow-2xl overflow-hidden',
        className
      )}
      role="dialog"
      aria-label="Emoji picker"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search emoji..."
            className="w-full rounded-lg border border-white/[0.06] bg-white/[0.04] py-1.5 pl-8 pr-3 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-[#d6a83f]/30 transition-all"
            aria-label="Search emojis"
          />
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="ml-2 rounded-lg p-1.5 text-gray-400 hover:text-white hover:bg-white/[0.05] transition"
            aria-label="Close emoji picker"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Category tabs */}
      <div className="flex gap-0.5 px-2 py-1.5 overflow-x-auto scrollbar-hide border-b border-white/[0.04]">
        {EMOJI_CATEGORIES.map((cat) => (
          <button
            key={cat.name}
            onClick={() => { setActiveCategory(cat.name); setSearch(''); }}
            className={cn(
              'shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all',
              activeCategory === cat.name && !search
                ? 'bg-[#d6a83f]/15 text-[#d6a83f]'
                : 'text-gray-500 hover:text-white hover:bg-white/[0.04]'
            )}
            aria-label={`${cat.name} emojis`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Emoji grid */}
      <div className="p-2 max-h-[200px] overflow-y-auto scrollbar-hide">
        {searchResults && searchResults.length > 0 ? (
          <div className="grid grid-cols-8 gap-0.5">
            {searchResults.map((emoji, i) => (
              <button
                key={`search-${i}`}
                onClick={() => onEmojiSelect(emoji)}
                className="aspect-square flex items-center justify-center text-lg hover:bg-white/[0.06] rounded-lg transition-colors"
                aria-label={`Select emoji ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : searchResults && searchResults.length === 0 ? (
          <p className="text-center text-gray-500 text-xs py-6">No emojis found</p>
        ) : (
          EMOJI_CATEGORIES.filter((c) => c.name === activeCategory).map((cat) => (
            <div key={cat.name}>
              <div className="grid grid-cols-8 gap-0.5">
                {cat.emojis.map((emoji, i) => (
                  <button
                    key={i}
                    onClick={() => onEmojiSelect(emoji)}
                    className="aspect-square flex items-center justify-center text-lg hover:bg-white/[0.06] rounded-lg transition-colors"
                    aria-label={`Select emoji ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </motion.div>
  );
}