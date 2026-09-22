'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '@/context/AuthContext';
import { apiDelete, apiGet } from '@/lib/apiClient';
import { createSocket } from '@/lib/socketClient';
import { Bookmark, Search, Loader2, FileText, FolderOpen, ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Avatar from '@/components/ui/Avatar';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { formatTimeAgo } from '@/lib/utils';

export default function BookmarksPage() {
  const router = useRouter();
  const { token } = useAuth();
  const [bookmarks, setBookmarks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchBookmarks = useCallback(async (cursor?: string) => {
    if (!token) return;
    cursor ? setLoadingMore(true) : setLoading(true);
    setError(null);
    try {
      const data = await apiGet<any>(`/api/feed/saved?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, token, { skipCache: true });
      const list = Array.isArray(data) ? data : data?.items ?? [];
      const normalized = list.map((post: any) => ({
        ...post, type: 'post', title: post.content || 'Post', description: post.content,
        thumbnailUrl: post.mediaUrl, createdAt: post.savedAt || post.createdAt,
        author: { ...post.author, name: post.author?.fullName || post.author?.username },
      }));
      setBookmarks(previous => cursor ? [...previous, ...normalized] : normalized);
      setNextCursor(data?.nextCursor);
    } catch (err: any) {
      setError(err.message || 'Failed to load bookmarks');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [token]);

  useEffect(() => { void fetchBookmarks(); }, [fetchBookmarks]);
  useEffect(() => {
    if (!token) return;
    const socket = createSocket(token, 'bookmarks');
    socket.on('social:bookmark-updated', (event: { postId: string; saved: boolean }) => {
      if (!event.saved) setBookmarks(previous => previous.filter(item => item.id !== event.postId));
      else void fetchBookmarks();
    });
    socket.connect();
    return () => { socket.off('social:bookmark-updated'); };
  }, [token, fetchBookmarks]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return bookmarks.filter(bookmark => {
      const haystack = `${bookmark.title || ''} ${bookmark.description || ''} ${bookmark.author?.username || ''} ${bookmark.author?.name || ''}`.toLowerCase();
      return !needle || haystack.includes(needle);
    });
  }, [bookmarks, query]);

  const removeBookmark = async (postId: string) => {
    if (!token) return;
    const removed = bookmarks.find(item => item.id === postId);
    setBookmarks(previous => previous.filter(item => item.id !== postId));
    try { await apiDelete(`/api/feed/${postId}/save`, token); }
    catch { if (removed) setBookmarks(previous => [removed, ...previous]); }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="mx-auto min-h-0 w-full min-w-0 max-w-[480px] pb-[calc(5rem+env(safe-area-inset-bottom))]"
    >
      {/* Header — always visible across loading, error and content states so
          navigation and spacing stay stable while bookmarks are fetched. */}
      <header className="sticky top-0 z-30 relative -mx-4 flex h-14 w-[calc(100%+2rem)] shrink-0 items-center gap-2.5 border-b border-white/[.08] bg-[#080808]/90 px-4 backdrop-blur-xl">
        <button type="button" onClick={() => router.back()} aria-label="Go back" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[#8a8a8a] hover:bg-white/[.05] hover:text-white"><ArrowLeft size={20} /></button>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-[#f5f5f5]">Bookmarks</h1>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {bookmarks.length > 0 && <span className="px-1 text-xs text-white/30">{bookmarks.length} items</span>}
        </div>
      </header>

      <div className="mt-4 space-y-4">
        {loading ? (
          <div className="space-y-4">
            <div className="skeleton h-10 w-full rounded-lg" />
            <div className="grid grid-cols-1 gap-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="skeleton h-64 rounded-lg" />
              ))}
            </div>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10">
              <Loader2 size={24} className="text-red-400" />
            </div>
            <h2 className="mb-2 text-base font-semibold text-white/80">Failed to load bookmarks</h2>
            <p className="mb-6 max-w-sm text-sm leading-5 text-white/40">{error}</p>
            <button onClick={() => void fetchBookmarks()} className="min-h-11 rounded-lg bg-[#f5f5f5] px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-white">
              Try Again
            </button>
          </div>
        ) : (
          <>
            {/* Search */}
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search saved posts or creators" className="h-11 w-full rounded-lg border border-white/[0.08] bg-[#0D0D0F] py-2.5 pl-10 pr-3 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-white/20" />
            </div>

      {/* Bookmarks Grid */}
      {bookmarks.length === 0 ? (
        <div className="flex flex-col items-center justify-center border-y border-white/[.06] py-20 px-4 text-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-lg bg-[#151517]">
            <Bookmark size={28} className="text-[#8a8a8f]" />
          </div>
          <h3 className="text-lg font-semibold text-white mb-1">Nothing saved yet</h3>
          <p className="text-sm text-white/30 max-w-sm">
            Bookmark posts to find them here later.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <FolderOpen size={32} className="text-white/10 mb-3" />
          <p className="text-sm text-white/30">No saved posts match your search</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filtered.map((bookmark: any, i: number) => (
            <motion.div
              key={bookmark.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              role="button"
              tabIndex={0}
              onClick={() => router.push(`/post/${bookmark.id}`)}
              onKeyDown={event => { if (event.key === 'Enter') router.push(`/post/${bookmark.id}`); }}
              className="group relative cursor-pointer overflow-hidden rounded-lg border border-white/[.07] bg-[#0d0d0f]"
            >
              {/* Thumbnail */}
              <div className="relative aspect-[4/3] bg-[#080808]">
                {bookmark.thumbnailUrl ? (
                  <img src={resolveMediaUrl(bookmark.thumbnailUrl)} alt={bookmark.title || 'Saved post'} loading="lazy" className="w-full h-full object-cover" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <FileText size={28} className="text-white/10" />
                  </div>
                )}
                
                {/* Remove Button */}
                <button aria-label="Remove bookmark" onClick={(event) => { event.stopPropagation(); void removeBookmark(bookmark.id); }} className="absolute top-2 right-2 flex h-9 w-9 items-center justify-center rounded-lg bg-black/75 text-white">
                  <Bookmark size={17} className="fill-current" />
                </button>
              </div>

              {/* Content */}
              <div className="p-3">
                <p className="line-clamp-2 text-sm font-semibold text-white">
                  {bookmark.title || 'Untitled'}
                </p>
                {bookmark.description && (
                  <p className="text-xs text-white/40 mt-1 line-clamp-2">{bookmark.description}</p>
                )}
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-2">
                    <Avatar src={bookmark.author?.avatar} alt={bookmark.author?.name || 'User'} size="xs" />
                    <span className="text-[10px] text-white/40">{bookmark.author?.name || 'Unknown'}</span>
                  </div>
                  <span className="text-[10px] text-white/20">
                    {bookmark.createdAt ? formatTimeAgo(bookmark.createdAt) : ''}
                  </span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
            {nextCursor && <button disabled={loadingMore} onClick={() => void fetchBookmarks(nextCursor)} className="mx-auto flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-5 py-2.5 text-xs font-semibold text-white/70 transition hover:bg-white/10 disabled:opacity-50">{loadingMore && <Loader2 size={14} className="animate-spin" />}Load more</button>}
          </>
        )}
      </div>
    </motion.div>
  );
}