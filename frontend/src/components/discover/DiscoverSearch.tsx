'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Mic, X, Clock, TrendingUp, Sparkles, Hash, Users, Radio, Camera, ArrowRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SearchSuggestion {
  type: 'trending' | 'recent' | 'creator' | 'hashtag' | 'community' | 'ai';
  label: string;
  sublabel?: string;
  icon?: any;
}

interface DiscoverSearchProps {
  onSearch: (query: string) => void;
  className?: string;
}

export default function DiscoverSearch({ onSearch, className }: DiscoverSearchProps) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [isListening, setIsListening] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const trendingSuggestions: SearchSuggestion[] = [
    { type: 'trending', label: 'Summer Vibes', sublabel: '12.4K watching', icon: TrendingUp },
    { type: 'trending', label: 'Music Festival', sublabel: '8.7K watching', icon: TrendingUp },
    { type: 'trending', label: 'Art Stream', sublabel: '5.2K watching', icon: TrendingUp },
    { type: 'hashtag', label: '#gaming', sublabel: '45.2K posts', icon: Hash },
    { type: 'hashtag', label: '#music', sublabel: '32.1K posts', icon: Hash },
    { type: 'creator', label: 'Sarah Chen', sublabel: '2.4M followers', icon: Users },
    { type: 'community', label: 'Tech Innovators', sublabel: '18.5K members', icon: Radio },
  ];

  const aiSuggestions: SearchSuggestion[] = [
    { type: 'ai', label: 'Trending gaming streams near you', icon: Sparkles },
    { type: 'ai', label: 'Music creators with similar taste', icon: Sparkles },
    { type: 'ai', label: 'Upcoming events this weekend', icon: Sparkles },
  ];

  useEffect(() => {
    // Accept search history saved under the legacy pre-VANTA key as a fallback.
    const stored = localStorage.getItem('vanta_recent_searches') || localStorage.getItem('sparklive_recent_searches');
    if (stored) setRecentSearches(JSON.parse(stored));
  }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const saveRecentSearch = (q: string) => {
    const updated = [q, ...recentSearches.filter(s => s !== q)].slice(0, 5);
    setRecentSearches(updated);
    localStorage.setItem('vanta_recent_searches', JSON.stringify(updated));
  };

  const handleSubmit = (q?: string) => {
    const searchTerm = q || query;
    if (!searchTerm.trim()) return;
    saveRecentSearch(searchTerm);
    onSearch(searchTerm);
    setShowSuggestions(false);
  };

  const clearRecent = () => {
    setRecentSearches([]);
    localStorage.removeItem('vanta_recent_searches');
    localStorage.removeItem('sparklive_recent_searches'); // Also clear the legacy pre-VANTA key.
  };

  const handleVoiceSearch = useCallback(() => {
    if (!('webkitSpeechRecognition' in window)) return;
    setIsListening(true);
    const recognition = new (window as any).webkitSpeechRecognition();
    recognition.lang = 'en-US';
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setQuery(transcript);
      handleSubmit(transcript);
      setIsListening(false);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.start();
  }, []);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* Main Search Bar */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          'relative group transition-all duration-300',
          focused && 'scale-[1.01]'
        )}
      >
        <div className={cn(
          'relative flex items-center rounded-3xl border transition-all duration-300 bg-white/[0.03] backdrop-blur-xl',
          focused
            ? 'border-[#d6a83f]/30 bg-white/[0.06] shadow-lg shadow-[#d6a83f]/10'
            : 'border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.05]'
        )}>
          {/* Search Icon */}
          <div className="absolute left-5 top-1/2 -translate-y-1/2">
            <Search size={18} className={cn(
              'transition-colors duration-300',
              focused ? 'text-[#d6a83f]' : 'text-gray-500 group-hover:text-gray-400'
            )} />
          </div>

          {/* Input */}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => { setFocused(true); setShowSuggestions(true); }}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            placeholder="Search creators, streams, communities, hashtags..."
            className="w-full bg-transparent pl-12 pr-24 py-4  text-sm  text-white placeholder-gray-600 outline-none rounded-3xl"
            aria-label="Search"
          />

          {/* Right Actions */}
          <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
            {/* Image Search */}
            <button
              className="p-2 rounded-xl text-gray-500 hover:text-white hover:bg-white/[0.08] transition-all"
              aria-label="Image search"
            >
              <Camera size={16} />
            </button>

            {/* Voice Search */}
            <motion.button
              onClick={handleVoiceSearch}
              whileTap={{ scale: 0.9 }}
              className={cn(
                'p-2 rounded-xl transition-all',
                isListening
                  ? 'bg-red-500/20 text-red-400 animate-pulse'
                  : 'text-gray-500 hover:text-white hover:bg-white/[0.08]'
              )}
              aria-label="Voice search"
            >
              <Mic size={16} />
            </motion.button>

            {/* Clear / Submit */}
            {query ? (
              <button
                onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                className="p-2 rounded-xl text-gray-500 hover:text-white hover:bg-white/[0.08] transition-all"
                aria-label="Clear search"
              >
                <X size={16} />
              </button>
            ) : (
              <kbd className="hidden  items-center gap-1 px-2 py-1 rounded-lg bg-white/[0.05] text-[10px] text-gray-600 font-mono">
                <span>⌘</span>K
              </kbd>
            )}
          </div>
        </div>

        {/* Animated Gradient Line */}
        <motion.div
          className="absolute -bottom-px left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#d6a83f]/50 to-transparent rounded-full"
          initial={{ scaleX: 0, opacity: 0 }}
          animate={focused ? { scaleX: 1, opacity: 1 } : { scaleX: 0, opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        />
      </motion.div>

      {/* Suggestions Dropdown */}
      <AnimatePresence>
        {showSuggestions && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="absolute top-full mt-2 left-0 right-0 z-50 rounded-3xl border border-white/[0.08] bg-[#0e0e16]/98 backdrop-blur-2xl shadow-2xl overflow-hidden"
          >
            <div className="max-h-[70vh] overflow-y-auto scrollbar-hide p-2 space-y-1">
              {/* Recent Searches */}
              {recentSearches.length > 0 && (
                <div className="p-2">
                  <div className="flex items-center justify-between mb-2 px-2">
                    <span className="text-[10px] uppercase tracking-[0.2em] text-gray-500 font-semibold">Recent</span>
                    <button onClick={clearRecent} className="text-[10px] text-gray-500 hover:text-white transition">Clear</button>
                  </div>
                  <div className="space-y-0.5">
                    {recentSearches.map((search, i) => (
                      <button
                        key={i}
                        onClick={() => { setQuery(search); handleSubmit(search); }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-300 hover:text-white hover:bg-white/[0.04] transition-all"
                      >
                        <Clock size={14} className="text-gray-600 shrink-0" />
                        <span className="truncate">{search}</span>
                        <span className="ml-auto text-[10px] text-gray-600">History</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* AI Suggestions */}
              <div className="p-2">
                <div className="flex items-center gap-2 mb-2 px-2">
                  <Sparkles size={12} className="text-[#d6a83f]" />
                  <span className="text-[10px] uppercase tracking-[0.2em] text-[#d6a83f]/60 font-semibold">AI Suggestions</span>
                </div>
                <div className="space-y-0.5">
                  {aiSuggestions.map((suggestion, i) => (
                    <button
                      key={i}
                      onClick={() => { setQuery(suggestion.label); handleSubmit(suggestion.label); }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-300 hover:text-white hover:bg-white/[0.04] transition-all"
                    >
                      <Sparkles size={14} className="text-[#d6a83f]/50 shrink-0" />
                      <span className="truncate">{suggestion.label}</span>
                      <ArrowRight size={12} className="text-gray-600 ml-auto shrink-0" />
                    </button>
                  ))}
                </div>
              </div>

              {/* Trending */}
              <div className="p-2">
                <div className="flex items-center gap-2 mb-2 px-2">
                  <TrendingUp size={12} className="text-emerald-400" />
                  <span className="text-[10px] uppercase tracking-[0.2em] text-gray-500 font-semibold">Trending</span>
                </div>
                <div className="space-y-0.5">
                  {trendingSuggestions.map((suggestion, i) => {
                    const Icon = suggestion.icon;
                    return (
                      <button
                        key={i}
                        onClick={() => { setQuery(suggestion.label); handleSubmit(suggestion.label); }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-300 hover:text-white hover:bg-white/[0.04] transition-all group"
                      >
                        <Icon size={14} className={cn(
                          'shrink-0',
                          suggestion.type === 'trending' && 'text-emerald-400',
                          suggestion.type === 'hashtag' && 'text-[#c8c8cc]',
                          suggestion.type === 'creator' && 'text-[#d6a83f]',
                          suggestion.type === 'community' && 'text-[#c8c8cc]',
                        )} />
                        <span className="truncate">{suggestion.label}</span>
                        {suggestion.sublabel && (
                          <span className="text-[10px] text-gray-600 ml-auto shrink-0">{suggestion.sublabel}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}