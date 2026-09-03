'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/apiClient';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import StoryCircle from '@/components/ui/StoryCircle';

interface StoryGroup {
  user: { id: string; username: string; fullName?: string; avatar?: string };
  stories: Array<{ id: string; userId: string; viewed?: boolean; mediaUrl?: string }>;
  hasUnviewed: boolean;
}

/**
 * Story tray keyed by USER - each user gets exactly one circle regardless of how
 * many stories they posted. Tapping opens the grouped viewer for that user.
 */
function buildGroups(raw: any[]): StoryGroup[] {
  const groups: StoryGroup[] = [];
  const byUser = new Map<string, StoryGroup>();
  for (const entry of raw || []) {
    if (Array.isArray(entry?.stories)) {
      const user = entry.user || entry.author || {};
      const id = user.id || entry.userId || entry.ownerId;
      const key = String(id || JSON.stringify(user));
      let group = byUser.get(key);
      if (!group) { group = { user, stories: [], hasUnviewed: Boolean(entry.hasUnviewed) }; byUser.set(key, group); groups.push(group); }
      for (const story of entry.stories || []) {
        group.stories.push(story);
        if (story && !story.viewed) group.hasUnviewed = true;
      }
    } else if (entry?.id && entry?.mediaUrl) {
      const user = entry.user || entry.author || {};
      const id = user.id || entry.userId;
      const key = String(id || entry.id);
      let group = byUser.get(key);
      if (!group) { group = { user, stories: [], hasUnviewed: Boolean(!entry.viewed) }; byUser.set(key, group); groups.push(group); }
      group.stories.push(entry);
      if (entry && !entry.viewed) group.hasUnviewed = true;
    }
  }
  return groups;
}

export default function DiscoverStories() {
  const { token } = useAuth();
  const router = useRouter();
  const [stories, setStories] = useState<StoryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchStories = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await apiGet<any>('/api/stories', token).catch(() => ({ stories: [] }));
      setStories(buildGroups(Array.isArray(data) ? data : data?.stories ?? data?.data ?? []));
    } catch {
      setStories([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchStories();
  }, [fetchStories]);

  const scroll = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction === 'left' ? -240 : 240, behavior: 'smooth' });
  };

  if (loading) {
    return (
      <div className="flex items-center gap-3 overflow-x-auto scrollbar-hide py-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex flex-col items-center gap-1.5 shrink-0">
            <div className="w-16 h-16 rounded-full bg-white/[0.03] animate-pulse" />
            <div className="w-10 h-2 rounded-full bg-white/[0.03] animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (stories.length === 0) {
    return null;
  }

  return (
    <div className="relative">
      {stories.length > 4 && (
        <>
          <button
            onClick={() => scroll('left')}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-black/60 backdrop-blur-sm border border-white/[0.08] flex items-center justify-center text-white/70 hover:text-white transition-all"
            aria-label="Scroll stories left"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={() => scroll('right')}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-black/60 backdrop-blur-sm border border-white/[0.08] flex items-center justify-center text-white/70 hover:text-white transition-all"
            aria-label="Scroll stories right"
          >
            <ChevronRight size={14} />
          </button>
        </>
      )}

      <div ref={scrollRef} className="flex gap-3 overflow-x-auto scrollbar-hide pb-2 px-1">
        {stories.slice(0, 10).map((group, i) => {
          const user = group.user || {};
          const opener = group.hasUnviewed
            ? (group.stories.find(story => !story.viewed) || group.stories[0])
            : group.stories[0];
          if (!user.id || !opener) return null;
          return (
            <motion.button
              key={user.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.03 }}
              type="button"
              onClick={() => router.push(`/stories/${encodeURIComponent(user.id)}?start=${encodeURIComponent(opener.id)}`)}
              className="flex flex-col items-center gap-1.5 shrink-0 group"
            >
              <StoryCircle src={user.avatar} alt={user.username || 'Story'} active={group.hasUnviewed} showDot />
              <span className="text-[10px] text-white/50 truncate max-w-[64px]">{user.username}</span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
