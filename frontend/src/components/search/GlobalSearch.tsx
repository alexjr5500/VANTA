'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import {
  Search, X, Users, User, Hash, Radio, Video, MessageCircle,
  TrendingUp, Clock, Loader2, ArrowRight, ExternalLink,
  Sparkles, Zap, Flame, Crown, Check, ChevronRight, Compass
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/apiClient';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';

interface SearchUser {
  id: string;
  username: string;
  fullName?: string;
  avatar?: string;
  bio?: string;
  verified?: boolean;
  premium?: boolean;
  _count?: { followers: number };
}

interface SearchPost {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; username: string; avatar?: string; verified?: boolean };
  _count?: { likes: number; comments: number };
}

interface SearchCommunity {
  id: string;
  name: string;
  description?: string;
  owner?: { id: string; username: string };
  _count?: { members: number; posts: number };
}

interface SearchStream {
  id: string;
  title: string;
  description?: string;
  viewerCount?: number;
  host: { id: string; username: string; avatar?: string };
  category?: { name: string };
}

interface SearchResults {
  users?: SearchUser[];
  posts?: SearchPost[];
  communities?: SearchCommunity[];
  streams?: SearchStream[];
  channels?: any[];
  videos?: any[];
}

export default function GlobalSearch() {
  const { token } = useAuth();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load recent searches from localStorage
  useEffect(() => {
    try {
      // Accept search history saved under the legacy pre-VANTA key as a fallback.
      const stored = localStorage.getItem('vanta_recent_searches') || localStorage.getItem('sparklive_recent_searches');
      if (stored) setRecentSearches(JSON.parse(stored));
    } catch {}
  }, []);

  // Save recent search
  const saveRecentSearch = useCallback((q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    const updated = [trimmed, ...recentSearches.filter(s => s !== trimmed)].slice(0, 8);
    setRecentSearches(updated);
    try {
      localStorage.setItem('vanta_recent_searches', JSON.stringify(updated));
    } catch {}
  }, [recentSearches]);

  // Clear recent searches
  const clearRecentSearches = useCallback(() => {
    setRecentSearches([]);
    try {
      localStorage.removeItem('vanta_recent_searches');
      localStorage.removeItem('sparklive_recent_searches'); // Also clear the legacy pre-VANTA key.
    } catch {}
  }, []);

  // Perform search
  const performSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 1) {
      setResults(null);
      setLoading(false);
      return;
    }

    // Cancel previous request
    if (abortRef.current) {
      abortRef.current.abort();
    }
    abortRef.current = new AbortController();

    setLoading(true);
    try {
      const data = await apiGet<SearchResults>(
        `/api/search?q=${encodeURIComponent(trimmed)}`,
        token || undefined,
        { signal: abortRef.current.signal, cacheTTL: 15000 }
      );
      setResults(data);
    } catch (err: any) {
      console.error('[Search] API Error:', err?.message || err);
      if (err?.statusCode !== 499) { // Not aborted
        setResults(null);
        // Show error state for debugging
        setSearchError(err?.message || 'Search request failed');
        setTimeout(() => setSearchError(null), 5000);
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Debounced search on query change
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setResults(null);
      setLoading(false);
      return;
    }

    if (trimmed.length < 1) return;

    debounceRef.current = setTimeout(() => {
      performSearch(query);
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, performSearch]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const totalItems = getTotalResultsCount();

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev < totalItems - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : totalItems - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0) {
        handleSelectIndex(selectedIndex);
      } else if (query.trim()) {
        saveRecentSearch(query);
        router.push(`/explore?q=${encodeURIComponent(query.trim())}`);
        setShowDropdown(false);
        inputRef.current?.blur();
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
      inputRef.current?.blur();
    }
  };

  // Get total count of all results
  const getTotalResultsCount = () => {
    if (!results) return 0;
    let count = 0;
    if (results.users?.length) count += results.users.length;
    if (results.posts?.length) count += results.posts.length;
    if (results.communities?.length) count += results.communities.length;
    if (results.streams?.length) count += results.streams.length;
    if (results.channels?.length) count += results.channels.length;
    if (results.videos?.length) count += results.videos.length;
    return count;
  };

  // Handle selection by index
  const handleSelectIndex = (index: number) => {
    if (!results) return;
    let current = 0;

    if (results.users) {
      for (const user of results.users) {
        if (current === index) {
          saveRecentSearch(user.username);
          router.push(`/profile/${user.username}`);
          setShowDropdown(false);
          setQuery('');
          inputRef.current?.blur();
          return;
        }
        current++;
      }
    }

    if (results.streams) {
      for (const stream of results.streams) {
        if (current === index) {
          saveRecentSearch(stream.title);
          router.push(`/live/${stream.id}`);
          setShowDropdown(false);
          setQuery('');
          inputRef.current?.blur();
          return;
        }
        current++;
      }
    }

    if (results.communities) {
      for (const community of results.communities) {
        if (current === index) {
          saveRecentSearch(community.name);
          router.push(`/communities/${community.id}`);
          setShowDropdown(false);
          setQuery('');
          inputRef.current?.blur();
          return;
        }
        current++;
      }
    }

    if (results.posts) {
      for (const post of results.posts) {
        if (current === index) {
          saveRecentSearch(post.content.slice(0, 30));
          router.push(`/post/${post.id}`);
          setShowDropdown(false);
          setQuery('');
          inputRef.current?.blur();
          return;
        }
        current++;
      }
    }
  };

  // Navigate to search results page
  const navigateToSearchPage = () => {
    if (query.trim()) {
      saveRecentSearch(query.trim());
      router.push(`/explore?q=${encodeURIComponent(query.trim())}`);
      setShowDropdown(false);
      inputRef.current?.blur();
    }
  };

  // Click on a recent search
  const handleRecentSearchClick = (q: string) => {
    setQuery(q);
    setShowDropdown(true);
    performSearch(q);
  };

  const hasResults = results && getTotalResultsCount() > 0;
  const showRecent = !query.trim() && recentSearches.length > 0 && !loading;

  return (
    <div className="relative">
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" size={15} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowDropdown(true);
            setSelectedIndex(-1);
          }}
          onFocus={() => setShowDropdown(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search users, streams, posts..."
          className="w-full rounded-xl border border-white/[0.06] bg-white/[0.04] py-2.5 pl-10 pr-10 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#d6a83f]/30 focus:bg-white/[0.06] transition-all"
          aria-label="Global search"
          autoComplete="off"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls="search-results"
        />
        {/* Clear button */}
        {query && (
          <button
            onClick={() => {
              setQuery('');
              setResults(null);
              setShowDropdown(false);
              inputRef.current?.focus();
            }}
            className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-gray-500 transition-all hover:bg-white/[0.06] hover:text-white"
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        )}
        {/* Loading spinner */}
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <Loader2 size={14} className="text-[#d6a83f] animate-spin" />
          </div>
        )}
      </div>

      {/* Dropdown */}
      <AnimatePresence>
        {showDropdown && (
          <motion.div
            ref={dropdownRef}
            id="search-results"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-0 right-0 top-full z-[100] mt-2 max-h-[min(560px,calc(100dvh-24px))] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0e0e16]/95 shadow-2xl backdrop-blur-2xl"
            role="listbox"
          >
            {/* Recent Searches */}
            {showRecent && (
              <div className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-semibold text-white/40 uppercase tracking-wider flex items-center gap-1.5">
                    <Clock size={10} />
                    Recent Searches
                  </span>
                  <button
                    onClick={clearRecentSearches}
                    className="text-[9px] text-white/30 hover:text-white/50 transition-colors"
                  >
                    Clear all
                  </button>
                </div>
                <div className="space-y-0.5">
                  {recentSearches.map((search, i) => (
                    <button
                      key={i}
                      onClick={() => handleRecentSearchClick(search)}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-white/50 hover:text-white hover:bg-white/[0.04] transition-all text-left"
                    >
                      <Clock size={13} className="text-white/20 shrink-0" />
                      <span className="truncate flex-1">{search}</span>
                      <ArrowRight size={12} className="text-white/20 shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Loading State */}
            {loading && !hasResults && (
              <div className="flex items-center justify-center py-8">
                <div className="flex flex-col items-center gap-2">
                  <Loader2 size={20} className="text-[#d6a83f] animate-spin" />
                  <p className="text-xs text-white/40">Searching...</p>
                </div>
              </div>
            )}

            {/* Results */}
            {hasResults && (
              <div className="max-h-[70vh] overflow-y-auto scrollbar-hide">
                {/* Users */}
                {results.users && results.users.length > 0 && (
                  <div className="p-2">
                    <div className="flex items-center gap-1.5 px-3 py-1.5">
                      <Users size={11} className="text-white/30" />
                      <span className="text-[9px] font-semibold text-white/30 uppercase tracking-wider">Users</span>
                    </div>
                    {results.users.map((user, i) => {
                      const globalIndex = getIndexOfUser(results, i);
                      return (
                        <button
                          key={user.id}
                          onClick={() => {
                            saveRecentSearch(user.username);
                            router.push(`/profile/${user.username}`);
                            setShowDropdown(false);
                            setQuery('');
                          }}
                          onMouseEnter={() => setSelectedIndex(globalIndex)}
                          className={cn(
                            'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left',
                            selectedIndex === globalIndex ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
                          )}
                          role="option"
                          aria-selected={selectedIndex === globalIndex}
                        >
                          <Avatar src={user.avatar} alt={user.username} size="sm" className="shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-medium text-white truncate">
                                {user.fullName || user.username}
                              </span>
                              {user.verified && <VerificationBadge verified size="sm" />}
                              {user.premium && (
                                <Crown size={10} className="text-amber-400 shrink-0" />
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-white/40">@{user.username}</span>
                              {user._count && (
                                <span className="text-[10px] text-white/20">
                                  {user._count.followers.toLocaleString()} followers
                                </span>
                              )}
                            </div>
                            {user.bio && (
                              <p className="text-[10px] text-white/30 mt-0.5 line-clamp-1">{user.bio}</p>
                            )}
                          </div>
                          <ChevronRight size={14} className="text-white/20 shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Live Streams */}
                {results.streams && results.streams.length > 0 && (
                  <div className="p-2 border-t border-white/[0.04]">
                    <div className="flex items-center gap-1.5 px-3 py-1.5">
                      <Radio size={11} className="text-red-400" />
                      <span className="text-[9px] font-semibold text-white/30 uppercase tracking-wider">Live Streams</span>
                    </div>
                    {results.streams.map((stream, i) => {
                      const userCount = results.users?.length || 0;
                      const globalIndex = userCount + i;
                      return (
                        <button
                          key={stream.id}
                          onClick={() => {
                            saveRecentSearch(stream.title);
                            router.push(`/live/${stream.id}`);
                            setShowDropdown(false);
                            setQuery('');
                          }}
                          onMouseEnter={() => setSelectedIndex(globalIndex)}
                          className={cn(
                            'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left',
                            selectedIndex === globalIndex ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
                          )}
                          role="option"
                          aria-selected={selectedIndex === globalIndex}
                        >
                          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500/20 to-[#b78929]/20 border border-red-500/20 flex items-center justify-center shrink-0">
                            <Radio size={14} className="text-red-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-white truncate">{stream.title}</span>
                              <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-red-500/20 text-[8px] font-bold text-red-400 uppercase">Live</span>
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-white/40">
                              <span>@{stream.host.username}</span>
                              {stream.viewerCount !== undefined && (
                                <span>{stream.viewerCount.toLocaleString()} watching</span>
                              )}
                              {stream.category?.name && (
                                <span>{stream.category.name}</span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Communities */}
                {results.communities && results.communities.length > 0 && (
                  <div className="p-2 border-t border-white/[0.04]">
                    <div className="flex items-center gap-1.5 px-3 py-1.5">
                      <Users size={11} className="text-[#c8c8cc]" />
                      <span className="text-[9px] font-semibold text-white/30 uppercase tracking-wider">Communities</span>
                    </div>
                    {results.communities.map((community, i) => {
                      const userCount = results.users?.length || 0;
                      const streamCount = results.streams?.length || 0;
                      const globalIndex = userCount + streamCount + i;
                      return (
                        <button
                          key={community.id}
                          onClick={() => {
                            saveRecentSearch(community.name);
                            router.push(`/communities/${community.id}`);
                            setShowDropdown(false);
                            setQuery('');
                          }}
                          onMouseEnter={() => setSelectedIndex(globalIndex)}
                          className={cn(
                            'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left',
                            selectedIndex === globalIndex ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
                          )}
                          role="option"
                          aria-selected={selectedIndex === globalIndex}
                        >
                          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#c8c8cc]/20 to-[#c8c8cc]/20 border border-[#c8c8cc]/20 flex items-center justify-center shrink-0">
                            <Users size={14} className="text-[#c8c8cc]" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium text-white truncate block">{community.name}</span>
                            <div className="flex items-center gap-2 text-[11px] text-white/40">
                              {community._count && (
                                <span>{community._count.members.toLocaleString()} members</span>
                              )}
                              {community.owner && (
                                <span>· @{community.owner.username}</span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Posts */}
                {results.posts && results.posts.length > 0 && (
                  <div className="p-2 border-t border-white/[0.04]">
                    <div className="flex items-center gap-1.5 px-3 py-1.5">
                      <MessageCircle size={11} className="text-[#c8c8cc]" />
                      <span className="text-[9px] font-semibold text-white/30 uppercase tracking-wider">Posts</span>
                    </div>
                    {results.posts.map((post, i) => {
                      const userCount = results.users?.length || 0;
                      const streamCount = results.streams?.length || 0;
                      const communityCount = results.communities?.length || 0;
                      const globalIndex = userCount + streamCount + communityCount + i;
                      return (
                        <button
                          key={post.id}
                          onClick={() => {
                            saveRecentSearch(post.content.slice(0, 30));
                            router.push(`/post/${post.id}`);
                            setShowDropdown(false);
                            setQuery('');
                          }}
                          onMouseEnter={() => setSelectedIndex(globalIndex)}
                          className={cn(
                            'w-full flex items-start gap-3 px-3 py-2.5 rounded-xl transition-all text-left',
                            selectedIndex === globalIndex ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
                          )}
                          role="option"
                          aria-selected={selectedIndex === globalIndex}
                        >
                          <Avatar src={post.author.avatar} alt={post.author.username} size="sm" className="shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-medium text-white truncate">@{post.author.username}</span>
                              {post.author.verified && <VerificationBadge verified size="sm" />}
                            </div>
                            <p className="text-[11px] text-white/50 mt-0.5 line-clamp-2">{post.content}</p>
                            {post._count && (
                              <div className="flex items-center gap-3 mt-1 text-[9px] text-white/30">
                                <span>{post._count.likes} likes</span>
                                <span>{post._count.comments} comments</span>
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* View all results */}
                <div className="border-t border-white/[0.04] p-2">
                  <button
                    onClick={navigateToSearchPage}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs text-[#c8c8cc] hover:bg-white/[0.04] transition-all font-medium"
                  >
                    <Search size={13} />
                    View all results for &ldquo;{query}&rdquo;
                    <ArrowRight size={13} />
                  </button>
                </div>
              </div>
            )}

            {/* Empty State */}
            {!loading && query.trim().length > 0 && !hasResults && (
              <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                <div className="w-12 h-12 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-3">
                  <Search size={20} className="text-white/20" />
                </div>
                <p className="text-sm text-white/50 font-medium">No results found</p>
                <p className="text-[11px] text-white/30 mt-1 max-w-[250px]">
                  No users, creators, communities, or streams match &ldquo;{query}&rdquo;
                </p>
                <button
                  onClick={navigateToSearchPage}
                  className="mt-3 flex items-center gap-1.5 text-[11px] text-[#c8c8cc] hover:text-[#f5f5f5] transition-colors font-medium"
                >
                  <Search size={12} />
                  Search all results
                </button>
              </div>
            )}

            {/* Initial state - type to search */}
            {!loading && !query.trim() && recentSearches.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                <div className="w-12 h-12 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-3">
                  <Sparkles size={20} className="text-white/20" />
                </div>
                <p className="text-sm text-white/50 font-medium">Search VANTA</p>
                <p className="text-[11px] text-white/30 mt-1 max-w-[250px]">
                  Find users, live streams, communities, and posts
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Helper to get global index of a user result
function getIndexOfUser(results: SearchResults, userIndex: number): number {
  return userIndex; // Users come first
}