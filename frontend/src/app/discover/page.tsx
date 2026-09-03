'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight, Bell, Bookmark, Check, ChevronRight, CircleAlert, Compass, Eye,
  Flame, Heart, Loader2, Menu, MessageCircle, Play, Radio, RefreshCw, Search,
  Share2, Users, X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useNotifications } from '@/context/NotificationContext';
import { useChatUnread } from '@/context/ChatUnreadContext';
import { apiDelete, apiGet, apiPost } from '@/lib/apiClient';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';
import CommentPanel from '@/components/social/CommentPanel';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import { openAppMenu } from '@/lib/openAppMenu';
import { resolveMediaUrl } from '@/lib/mediaUrl';

type Item = Record<string, any>;
type Category = 'forYou' | 'trending' | 'creators' | 'reels' | 'live' | 'communities';
type SearchFilter = 'all' | 'people' | 'posts' | 'reels' | 'live' | 'communities';

const CATEGORIES: Array<[Category, string]> = [
  ['forYou', 'For You'], ['trending', 'Trending'], ['creators', 'Creators'],
  ['reels', 'Reels'], ['live', 'Live'], ['communities', 'Communities'],
];
const SEARCH_FILTERS: Array<[SearchFilter, string]> = [
  ['all', 'All'], ['people', 'People'], ['posts', 'Posts'], ['reels', 'Reels'],
  ['live', 'Live'], ['communities', 'Communities'],
];
const unwrap = (data: any): Item[] => Array.isArray(data) ? data : data?.items || data?.data || data?.results || data?.profiles || data?.streams || data?.videos || data?.communities || [];
const creatorOf = (item: Item) => item.author || item.creator || item.user || item.host || item.owner || {};
const cleanId = (item: Item) => String(item.id || '').replace(/^(video-|live-|community-|creator-)/, '');
const mediaOf = (item: Item) => resolveMediaUrl(item.thumbnail || item.thumbnailUrl || item.coverUrl || item.image || item.media || item.mediaUrl || item.bannerUrl || item.previewUrl);
const count = (value: any) => { const number = Number(value) || 0; return number >= 1e6 ? `${(number / 1e6).toFixed(1)}M` : number >= 1e3 ? `${(number / 1e3).toFixed(1)}K` : String(number); };
const engagement = (item: Item) => Number(item.views || item.viewCount || 0) + Number(item.likes || item._count?.likes || 0) + Number(item.comments || item._count?.comments || 0);
const profileFollowers = (profile: Item) => Number(profile.followersCount ?? profile._count?.followers ?? 0);
const isVideo = (item: Item) => item.type === 'video' || item.type === 'reel' || Boolean(item.videoUrl || item.playbackUrl || item.duration);
const categoryName = (value: any) => typeof value === 'string' ? value : value?.name || '';
const scrollPageTop = (el: HTMLDivElement | null) => el?.scrollTo?.({ top: 0, behavior: 'smooth' });
function Badge({ value }: { value: number }) {
  if (!value || value <= 0) return null;
  return <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-[16px] place-items-center rounded-full bg-[#c9a227] px-1 text-[9px] font-bold leading-none text-black ring-2 ring-[#050505]">{value > 99 ? '99+' : value}</span>;
}

export default function DiscoverPage() {
  const { token, user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const { unreadCount: notificationUnread } = useNotifications();
  const { chatUnreadCount: chatUnread } = useChatUnread();
  const sentinel = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pageScrollRef = useRef<HTMLDivElement>(null);
  const [category, setCategory] = useState<Category>('forYou');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchFilter, setSearchFilter] = useState<SearchFilter>('all');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Record<string, Item[]>>({});
  const [posts, setPosts] = useState<Item[]>([]);
  const [trending, setTrending] = useState<Item[]>([]);
  const [creators, setCreators] = useState<Item[]>([]);
  const [reels, setReels] = useState<Item[]>([]);
  const [live, setLive] = useState<Item[]>([]);
  const [communities, setCommunities] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [commentsFor, setCommentsFor] = useState<Item>();
  const [shareFor, setShareFor] = useState<Item>();

  const loadDiscover = useCallback(async (append = false, nextCursor?: string) => {
    if (!token) return;
    append ? setLoadingMore(true) : setLoading(true);
    if (!append) setError('');
    const exploreQuery = new URLSearchParams({ limit: '12' });
    if (nextCursor) exploreQuery.set('cursor', nextCursor);
    try {
      if (append) {
        const data = await apiGet<any>(`/api/feed/explore?${exploreQuery}`, token, { skipCache: true });
        const next = unwrap(data);
        setPosts(current => [...current, ...next.filter(item => !current.some(existing => existing.id === item.id))]);
        setCursor(data?.nextCursor);
        return;
      }
      const results = await Promise.allSettled([
        apiGet<any>(`/api/feed/explore?${exploreQuery}`, token, { skipCache: true }),
        apiGet<any>('/api/feed/trending?limit=10', token, { skipCache: true }),
        apiGet<any>('/api/profiles/discover?limit=14', token, { skipCache: true }),
        apiGet<any>('/api/reels?limit=12', token, { skipCache: true }),
        apiGet<any>('/api/live/discover?limit=8&sort=viewerCount', token, { skipCache: true }),
        apiGet<any>('/api/communities?limit=10', token, { skipCache: true }),
      ]);
      const fulfilled = results.filter(result => result.status === 'fulfilled').length;
      if (!fulfilled) throw new Error('Discover services are unavailable');
      const value = (index: number) => results[index].status === 'fulfilled' ? (results[index] as PromiseFulfilledResult<any>).value : {};
      setPosts(unwrap(value(0))); setCursor(value(0)?.nextCursor);
      setTrending(unwrap(value(1))); setCreators(unwrap(value(2)));
      setReels(unwrap(value(3))); setLive(unwrap(value(4))); setCommunities(unwrap(value(5)));
    } catch { setError("Couldn't load Discover."); }
    finally { setLoading(false); setLoadingMore(false); }
  }, [token]);

  useEffect(() => { void loadDiscover(); }, [loadDiscover]);
  useEffect(() => { const timer = setTimeout(() => setDebouncedQuery(query.trim()), 350); return () => clearTimeout(timer); }, [query]);
  useEffect(() => {
    if (!debouncedQuery || !token) { setSearchResults({}); setSearching(false); return; }
    let current = true; setSearching(true);
    apiGet<any>(`/api/search?q=${encodeURIComponent(debouncedQuery)}&limit=8`, token, { skipCache: true })
      .then(data => { if (!current) return; setSearchResults({ people: unwrap(data?.users || data?.people), posts: unwrap(data?.posts), reels: unwrap(data?.videos || data?.reels), live: unwrap(data?.streams || data?.live), communities: unwrap(data?.communities), topics: unwrap(data?.hashtags || data?.topics) }); })
      .catch(() => { if (current) setSearchResults({}); })
      .finally(() => { if (current) setSearching(false); });
    return () => { current = false; };
  }, [debouncedQuery, token]);
  useEffect(() => {
    const element = sentinel.current;
    if (!element || !cursor || debouncedQuery || category !== 'forYou') return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting && !loadingMore) void loadDiscover(true, cursor); }, { rootMargin: '500px' });
    observer.observe(element); return () => observer.disconnect();
  }, [category, cursor, debouncedQuery, loadDiscover, loadingMore]);

  const featured = useMemo(() => live[0] || reels[0] || trending.find(mediaOf) || posts.find(mediaOf) || creators[0], [creators, live, posts, reels, trending]);
  const topics = useMemo(() => {
    const candidates = [...communities.map(item => categoryName(item.category)), ...live.map(item => categoryName(item.category)), ...posts.flatMap(item => Array.isArray(item.hashtags) ? item.hashtags : [])]
      .filter((topic): topic is string => Boolean(topic)).map(topic => topic.replace(/^#/, ''));
    return [...new Set(candidates)].slice(0, 10);
  }, [communities, live, posts]);
  const rising = useMemo(() => [...creators].sort((a, b) => new Date(b.lastActive || b.createdAt || 0).getTime() - new Date(a.lastActive || a.createdAt || 0).getTime()).slice(0, 6), [creators]);

  const follow = async (profile: Item) => {
    if (!token || !profile.username) return;
    const was = Boolean(profile.following || profile.isFollowing);
    const update = (rows: Item[]) => rows.map(item => item.id === profile.id ? { ...item, following: !was, isFollowing: !was, _count: { ...item._count, followers: Math.max(0, profileFollowers(item) + (was ? -1 : 1)) } } : item);
    setCreators(update); setSearchResults(current => ({ ...current, people: update(current.people || []) }));
    try { was ? await apiDelete(`/api/profiles/${profile.username}/follow`, token) : await apiPost(`/api/profiles/${profile.username}/follow`, {}, token); }
    catch (reason: any) { setCreators(rows => rows.map(item => item.id === profile.id ? { ...item, following: was, isFollowing: was } : item)); toast.error('Follow update failed', reason?.message); }
  };
  const joinCommunity = async (community: Item) => {
    if (!token || community.isPrivate) return;
    const was = Boolean(community.joined || community.isMember);
    const update = (value: boolean) => setCommunities(rows => rows.map(item => item.id === community.id ? { ...item, joined: value, isMember: value, _count: { ...item._count, members: Math.max(0, Number(item._count?.members || 0) + (value ? 1 : -1)) } } : item));
    update(!was);
    try { await apiPost(`/api/communities/${community.id}/${was ? 'leave' : 'join'}`, {}, token); }
    catch (reason: any) { update(was); toast.error('Community update failed', reason?.message); }
  };
  const mutatePost = async (post: Item, mode: 'like' | 'save') => {
    if (!token) return; const key = mode === 'like' ? 'liked' : 'saved'; const was = Boolean(post[key]);
    const update = (value: boolean) => { const apply = (rows: Item[]) => rows.map(item => item.id === post.id ? { ...item, [key]: value, ...(mode === 'like' ? { likes: Math.max(0, Number(item.likes || item._count?.likes || 0) + (value ? 1 : -1)) } : {}) } : item); setPosts(apply); setTrending(apply); setSearchResults(current => ({ ...current, posts: apply(current.posts || []) })); };
    update(!was);
    try { mode === 'like' ? await apiPost(`/api/feed/${cleanId(post)}/like`, {}, token) : was ? await apiDelete(`/api/feed/${cleanId(post)}/save`, token) : await apiPost(`/api/feed/${cleanId(post)}/save`, {}, token); }
    catch (reason: any) { update(was); toast.error('Could not update post', reason?.message); }
  };
  const share = async (destination: string) => {
    if (!shareFor || !token) return; const url = `${location.origin}/post/${cleanId(shareFor)}`;
    try { await apiPost(`/api/feed/${cleanId(shareFor)}/share`, { destination }, token); if (destination === 'COPY_LINK') await navigator.clipboard.writeText(url); else if (destination === 'NATIVE' && navigator.share) await navigator.share({ title: 'VANTA', text: shareFor.content, url }); else if (destination === 'MESSAGE') router.push(`/chat?share=${encodeURIComponent(url)}`); toast.success('Shared successfully'); setShareFor(undefined); }
    catch (reason: any) { toast.error('Share failed', reason?.message); }
  };
  const selectTopic = (topic: string) => { setQuery(topic); setSearchFilter('all'); searchRef.current?.focus(); scrollPageTop(pageScrollRef.current); };

  return <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-[#050505] text-[#f5f5f5]">
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-2.5 border-b border-white/[.08] bg-[#080808]/90 px-4 backdrop-blur-xl"><button type="button" onClick={openAppMenu} aria-label="Open menu" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[#8a8a8a] hover:bg-white/[.05] hover:text-white"><Menu size={20}/></button><div className="ml-auto flex min-w-0 items-center gap-1"><button type="button" onClick={() => { searchRef.current?.focus(); scrollPageTop(pageScrollRef.current); }} aria-label="Search VANTA" className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[#8a8a8a] hover:bg-white/[.05] hover:text-white"><Search size={18}/></button><button type="button" onClick={() => router.push('/notifications')} aria-label="Open notifications" className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[#8a8a8a] hover:bg-white/[.05] hover:text-white"><Bell size={18}/>{notificationUnread > 0 && <Badge value={notificationUnread}/>}</button><button type="button" onClick={() => router.push('/chat')} aria-label="Open chat" className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[#8a8a8a] hover:bg-white/[.05] hover:text-white"><MessageCircle size={18}/>{chatUnread > 0 && <Badge value={chatUnread}/>}</button><button type="button" onClick={() => router.push('/profile')} aria-label="Open your profile" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"><Avatar src={user?.avatar} alt="Your profile" size="sm" /></button></div></header>
    <div ref={pageScrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-hide [-webkit-overflow-scrolling:touch]">
    <div className="mx-auto w-full min-w-0 max-w-[520px] space-y-5 px-3 pb-24 pt-3">
      <main className="min-w-0">
        <section className="mb-6 flex items-center justify-between gap-4" aria-label="Discover"><p className="min-w-0 text-[11px] font-semibold uppercase tracking-[.2em] text-[#666]">There&apos;s always something new</p><button type="button" onClick={() => void loadDiscover()} aria-label="Refresh Discover" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/[.08] text-[#8a8a8a] transition hover:bg-white/[.05] hover:text-white"><RefreshCw size={16}/></button></section>
        <section className="relative z-20 mb-5" aria-label="Search VANTA"><div className="group flex min-h-12 items-center gap-3 rounded-lg border border-white/[.08] bg-[#101010]/95 px-4 transition focus-within:border-white/[.2] focus-within:bg-[#161616]"><Search size={18} className="shrink-0 text-[#8a8a8a]"/><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search VANTA..." aria-label="Search people, posts, reels, live streams, communities, and topics" className="h-12 min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-[#666]"/>{searching && <Loader2 size={17} className="animate-spin text-[#8a8a8a]"/>}{query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="flex h-9 w-9 items-center justify-center rounded-lg text-[#666] hover:bg-white/[.06] hover:text-white"><X size={17}/></button>}</div>
          <AnimatePresence>{debouncedQuery && <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} className="mt-2 overflow-hidden rounded-lg border border-white/[.1] bg-[#101010] shadow-2xl"><div className="flex overflow-x-auto border-b border-white/[.08] px-2 scrollbar-hide" role="tablist" aria-label="Search result filters">{SEARCH_FILTERS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={searchFilter === id} onClick={() => setSearchFilter(id)} className={cn('relative min-h-11 shrink-0 px-3 text-xs text-[#666] hover:text-white', searchFilter === id && 'text-white after:absolute after:inset-x-3 after:bottom-0 after:h-px after:bg-[#b8b8b8]')}>{label}</button>)}</div><SearchResults query={debouncedQuery} filter={searchFilter} results={searchResults} searching={searching} open={(item: Item) => openSearchResult(item, router)} follow={follow}/></motion.div>}</AnimatePresence>
        </section>
        {!debouncedQuery && <nav className="mb-7 flex overflow-x-auto border-b border-white/[.08] scrollbar-hide" aria-label="Discover categories">{CATEGORIES.map(([id, label]) => <button key={id} type="button" onClick={() => setCategory(id)} aria-current={category === id ? 'page' : undefined} className={cn('relative min-h-12 shrink-0 px-4 text-sm font-medium text-[#666] transition hover:text-[#b8b8b8]', category === id && 'text-white after:absolute after:inset-x-4 after:bottom-0 after:h-0.5 after:bg-[#c9a227]')}>{label}</button>)}</nav>}

        {loading ? <DiscoverSkeleton/> : error ? <ErrorState retry={() => void loadDiscover()}/> : !debouncedQuery && <div className="space-y-7">
          {category === 'forYou' && <>
            <Featured item={featured} open={() => openItem(featured, router)}/>
            <TrendingSection items={trending} open={(item: Item) => openItem(item, router)} setCategory={setCategory}/>
            <CreatorSection title="POPULAR CREATORS" subtitle="Creators people are connecting with now" profiles={[...creators].sort((a, b) => profileFollowers(b) - profileFollowers(a)).slice(0, 8)} follow={follow} open={(profile: Item) => router.push(`/profile/${profile.username}`)}/>
            <ReelSection items={reels} open={(item: Item) => openItem({ ...item, type: 'video' }, router)} setCategory={setCategory}/>
            <LiveSection items={live} open={(item: Item) => openItem({ ...item, type: 'live' }, router)} setCategory={setCategory}/>
            <CommunitySection items={communities} join={joinCommunity} open={(item: Item) => router.push(`/communities/${item.id}`)} setCategory={setCategory}/>
            <PostSection title="POPULAR POSTS" items={posts.slice(0, 6)} mutate={mutatePost} comment={setCommentsFor} share={setShareFor} openProfile={(name: string) => router.push(`/profile/${name}`)}/>
          </>}
          {category === 'trending' && <><TrendingSection items={trending} open={(item: Item) => openItem(item, router)}/><PostSection title="TRENDING POSTS" items={trending.filter(item => item.type === 'post' || Boolean(item.content))} mutate={mutatePost} comment={setCommentsFor} share={setShareFor} openProfile={(name: string) => router.push(`/profile/${name}`)}/></>}
          {category === 'creators' && <><CreatorSection title="POPULAR CREATORS" subtitle="Established voices across VANTA" profiles={[...creators].sort((a, b) => profileFollowers(b) - profileFollowers(a))} follow={follow} open={(profile: Item) => router.push(`/profile/${profile.username}`)}/><CreatorSection title="RISING CREATORS" subtitle="Recently active creators building momentum" profiles={rising} follow={follow} open={(profile: Item) => router.push(`/profile/${profile.username}`)}/></>}
          {category === 'reels' && <ReelSection items={reels} open={(item: Item) => openItem({ ...item, type: 'video' }, router)}/>} 
          {category === 'live' && <LiveSection items={live} open={(item: Item) => openItem({ ...item, type: 'live' }, router)}/>} 
          {category === 'communities' && <CommunitySection items={communities} join={joinCommunity} open={(item: Item) => router.push(`/communities/${item.id}`)}/>} 
          {category === 'forYou' && <div ref={sentinel} className="flex min-h-10 items-center justify-center">{loadingMore && <Loader2 className="animate-spin text-[#666]"/>}</div>}
        </div>}
      </main>
      </div>
    </div>
    <AnimatePresence>{commentsFor && token && <CommentPanel postId={cleanId(commentsFor)} postAuthor={creatorOf(commentsFor)} initialCount={Number(commentsFor.comments || commentsFor._count?.comments || 0)} token={token} currentUser={user} onClose={() => setCommentsFor(undefined)} onCountChange={value => setPosts(rows => rows.map(item => item.id === commentsFor.id ? { ...item, comments: value } : item))}/>} {shareFor && <ShareSheet close={() => setShareFor(undefined)} share={share}/>}</AnimatePresence>
  </div>;
}

function openItem(item: Item | undefined, router: ReturnType<typeof useRouter>) { if (!item) return; const creator = creatorOf(item); if (item.type === 'live' || item.viewerCount !== undefined || item.status === 'LIVE') router.push(`/live/${cleanId(item)}`); else if (isVideo(item)) router.push(`/reels?reel=${cleanId(item)}`); else if (item.content || item.mediaUrl) router.push(`/post/${cleanId(item)}`); else if (creator.username || item.username) router.push(`/profile/${creator.username || item.username}`); }
function openSearchResult(item: Item, router: ReturnType<typeof useRouter>) { if (item.__kind === 'community') router.push(`/communities/${item.id}`); else if (item.__kind === 'live') router.push(`/live/${cleanId(item)}`); else if (item.__kind === 'reel') router.push(`/reels?reel=${cleanId(item)}`); else if (item.__kind === 'post') router.push(`/post/${cleanId(item)}`); else router.push(`/profile/${item.username || creatorOf(item).username}`); }

function SearchResults({ query, filter, results, searching, open, follow }: any) {
  const groups = [['people', 'People'], ['posts', 'Posts'], ['reels', 'Reels'], ['live', 'Live'], ['communities', 'Communities']] as const;
  const visible = groups.filter(([id]) => filter === 'all' || filter === id).map(([id, label]) => ({ id, label, rows: (results[id] || []).map((item: Item) => ({ ...item, __kind: id === 'people' ? 'person' : id === 'posts' ? 'post' : id === 'reels' ? 'reel' : id })) })).filter(group => group.rows.length);
  if (searching) return <div className="space-y-3 p-4">{[1,2,3].map(item => <div key={item} className="h-12 animate-pulse rounded-lg bg-white/[.045]"/>)}</div>;
  if (!visible.length) return <div className="px-5 py-10 text-center"><Search className="mx-auto text-[#666]"/><p className="mt-3 text-sm font-medium">No results for &quot;{query}&quot;</p><p className="mt-1 text-xs text-[#666]">Try another name, topic, or keyword.</p></div>;
  return <div className="max-h-[60vh] overflow-y-auto p-2">{visible.map(group => <section key={group.id}><h2 className="px-2 pb-1 pt-3 text-[10px] font-semibold tracking-[.18em] text-[#666]">{group.label.toUpperCase()}</h2>{group.rows.slice(0, filter === 'all' ? 4 : 12).map((item: Item) => <SearchRow key={`${group.id}-${item.id}`} item={item} open={() => open(item)} follow={group.id === 'people' ? () => follow(item) : undefined}/>)}</section>)}</div>;
}
function SearchRow({ item, open, follow }: any) { const person = item.__kind === 'person' ? item : creatorOf(item); const image = item.__kind === 'person' ? item.avatar : mediaOf(item) || person.avatar; return <div className="flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-white/[.04]"><button type="button" onClick={open} className="flex min-w-0 flex-1 items-center gap-3 text-left">{item.__kind === 'person' ? <Avatar src={image} alt={item.username || 'Person'} size="md"/> : <span className="flex h-11 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#1c1c1c]">{image ? <img src={resolveMediaUrl(image)} alt="" className="h-full w-full object-cover"/> : item.__kind === 'live' ? <Radio size={17} className="text-[#8a8a8a]"/> : item.__kind === 'community' ? <Users size={17} className="text-[#8a8a8a]"/> : <Compass size={17} className="text-[#8a8a8a]"/>}</span>}<span className="min-w-0"><b className="block truncate text-sm font-medium text-[#e8e8e8]">{item.fullName || item.name || item.title || item.content || person.fullName || person.username || 'VANTA content'}</b><small className="block truncate text-[#666]">{item.username ? `@${item.username}` : categoryName(item.category) || (person.username ? `@${person.username}` : item.__kind)}</small></span></button>{follow && <FollowButton active={Boolean(item.following || item.isFollowing)} onClick={follow}/>}</div>; }

function Featured({ item, open }: { item?: Item; open: () => void }) { if (!item) return <EmptyState title="Nothing featured yet." description="Check back soon as new VANTA content arrives."/>; const creator = creatorOf(item); const image = mediaOf(item) || creator.avatar || item.avatar; return <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} aria-labelledby="featured-heading"><button type="button" onClick={open} className="group relative block aspect-[16/9] min-h-[220px] w-full overflow-hidden rounded-lg border border-white/[.08] bg-[#101010] text-left shadow-lg shadow-black/40">{image && <img src={resolveMediaUrl(image)} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70 transition duration-500 group-hover:scale-[1.02]"/>}<div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,5,5,.95)_0%,rgba(5,5,5,.62)_52%,rgba(5,5,5,.10)_100%)]"/><div className="absolute inset-0 flex max-w-xl flex-col justify-end p-5"><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[#c9a227]">Featured · VANTA</p><h2 id="featured-heading" className="mt-2 line-clamp-2 text-xl font-semibold text-white">{item.title || item.content || item.fullName || creator.fullName || creator.username || 'Discover what is happening now'}</h2><p className="mt-1.5 line-clamp-2 text-sm leading-6 text-[#b8b8b8]">{item.description || item.bio || creator.fullName || (creator.username && `@${creator.username}`) || 'A new perspective from the VANTA community.'}</p><span className="mt-4 flex w-fit items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-black transition group-hover:bg-[#f5f5f5]">Explore <ArrowRight size={14}/></span></div></button></motion.section>; }
function SectionHeading({ title, subtitle, action, onAction }: any) { return <div className="mb-4 flex items-end justify-between gap-4"><div><h2 className="text-xs font-semibold tracking-[.17em] text-[#b8b8b8]">{title}</h2>{subtitle && <p className="mt-1 text-xs text-[#666]">{subtitle}</p>}</div>{action && <button type="button" onClick={onAction} className="flex min-h-9 items-center gap-1 text-xs text-[#8a8a8a] hover:text-white">{action}<ChevronRight size={14}/></button>}</div>; }
function TrendingSection({ items, open, setCategory }: any) { if (!items.length) return <EmptyState title="Nothing is trending yet." description="Check back soon as engagement builds across VANTA."/>; return <section><SectionHeading title="TRENDING NOW" subtitle="What is moving across VANTA" action={setCategory && 'View all'} onAction={() => setCategory?.('trending')}/><div className="divide-y divide-white/[.06] overflow-hidden rounded-lg border border-white/[.08] bg-[#101010]">{items.slice(0, 6).map((item: Item, index: number) => { const creator = creatorOf(item); const top = index < 3; return <button key={item.id} type="button" onClick={() => open(item)} className="group flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-white/[.03]"><span className={cn('w-5 shrink-0 text-center text-[11px] font-semibold tabular-nums', top ? 'text-[#c9a227]' : 'text-[#666]')}>{String(index + 1).padStart(2, '0')}</span><span className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-white/[.06] bg-[#1c1c1c]">{mediaOf(item) ? <img src={mediaOf(item)} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-[1.03]"/> : <span className="flex h-full items-center justify-center text-[#666]"><Flame size={17}/></span>}</span><span className="min-w-0 flex-1"><b className="line-clamp-1 text-sm font-medium text-[#e8e8e8]">{item.title || item.content || item.description || 'Trending on VANTA'}</b><small className="mt-0.5 block truncate text-xs text-[#666]">{creator.fullName || creator.username || item.category || 'VANTA'} · {count(engagement(item))} interactions</small></span><ChevronRight size={15} className="shrink-0 text-[#666] transition group-hover:translate-x-0.5 group-hover:text-white"/></button>; })}</div></section>; }
function CreatorSection({ title, subtitle, profiles, follow, open }: any) { if (!profiles.length) return <EmptyState title="No creators to show yet." description="New creator recommendations will appear here."/>; return <section><SectionHeading title={title} subtitle={subtitle}/><div className="grid gap-3  ">{profiles.map((profile: Item) => <article key={profile.id} className="group flex min-h-44 flex-col rounded-lg border border-white/[.08] bg-[#101010] p-4 transition hover:-translate-y-0.5 hover:border-white/[.16] hover:bg-[#161616]"><div className="flex items-start justify-between gap-3"><button type="button" onClick={() => open(profile)}><Avatar src={profile.avatar} alt={profile.username || 'Creator'} size="lg"/></button><FollowButton active={Boolean(profile.following || profile.isFollowing)} onClick={() => follow(profile)}/></div><button type="button" onClick={() => open(profile)} className="mt-3 min-w-0 text-left"><b className="flex items-center gap-1 truncate text-sm font-semibold text-[#f5f5f5]">{profile.fullName || profile.username}{profile.verified && <Verified/>}</b><small className="mt-0.5 block truncate text-[#666]">@{profile.username} · {count(profileFollowers(profile))} followers</small><p className="mt-2 line-clamp-2 text-xs leading-5 text-[#8a8a8a]">{profile.bio || 'Creating and connecting on VANTA.'}</p></button></article>)}</div></section>; }
function ReelSection({ items, open, setCategory }: any) { if (!items.length) return <EmptyState title="No Reels to discover yet." description="Check back as creators publish new short videos."/>; return <section><SectionHeading title="TRENDING REELS" subtitle="Short stories with momentum" action={setCategory && 'View all'} onAction={() => setCategory?.('reels')}/><div className="grid grid-cols-2 gap-3  ">{items.slice(0, setCategory ? 8 : items.length).map((item: Item) => { const creator = creatorOf(item); return <button key={item.id} type="button" onClick={() => open(item)} className="group relative aspect-[9/16] overflow-hidden rounded-lg border border-white/[.08] bg-[#101010] text-left">{mediaOf(item) ? <img src={mediaOf(item)} alt={item.title || item.caption || 'Reel'} loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.025]"/> : <span className="flex h-full items-center justify-center text-[#666]"><Play size={25}/></span>}<div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_45%,rgba(0,0,0,.92)_100%)]"/><span className="absolute left-3 top-3 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white backdrop-blur"><Play size={14} fill="currentColor"/></span><span className="absolute inset-x-3 bottom-3"><b className="line-clamp-2 text-xs font-semibold leading-4 text-white">{item.title || item.caption || item.description || 'VANTA Reel'}</b><small className="mt-1 flex items-center justify-between text-[10px] text-[#b8b8b8]"><span className="truncate">@{creator.username || 'creator'}</span><span className="flex items-center gap-1"><Eye size={10}/>{count(item.views || item.viewCount)}</span></small></span></button>; })}</div></section>; }
function LiveSection({ items, open, setCategory }: any) { if (!items.length) return <EmptyState icon={Radio} title="No one is live right now." description="Check back soon or explore another category."/>; return <section><SectionHeading title="LIVE NOW" subtitle="Join conversations as they happen" action={setCategory && 'View all'} onAction={() => setCategory?.('live')}/><div className="grid gap-4  ">{items.slice(0, setCategory ? 6 : items.length).map((item: Item) => { const creator = creatorOf(item); const category = categoryName(item.category); return <button key={item.id} type="button" onClick={() => open(item)} className="group text-left"><span className="relative block aspect-video overflow-hidden rounded-lg border border-white/[.08] bg-[#101010]">{mediaOf(item) ? <img src={mediaOf(item)} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-[1.02]"/> : <span className="flex h-full items-center justify-center text-[#666]"><Radio size={22}/></span>}<span className="absolute left-2 top-2 flex items-center gap-1.5 rounded bg-[#921f2a] px-2 py-1 text-[9px] font-bold tracking-[.12em] text-white"><i className="h-1.5 w-1.5 animate-pulse rounded-full bg-white"/>LIVE</span><span className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-black/75 px-2 py-1 text-[9px] text-white"><Eye size={10}/>{count(item.viewerCount || item.viewers)}</span></span><span className="mt-2.5 flex items-center gap-2"><Avatar src={creator.avatar} alt={creator.username || 'Creator'} size="sm"/><span className="min-w-0"><b className="block truncate text-sm font-medium text-[#e8e8e8]">{item.title || 'Live on VANTA'}</b><small className="block truncate text-[#666]">{creator.fullName || creator.username}{category ? ` · ${category}` : ''}</small></span></span></button>; })}</div></section>; }
function CommunitySection({ items, join, open, setCategory }: any) { if (!items.length) return <EmptyState icon={Users} title="Nothing here yet." description="Communities will appear here as people create them."/>; return <section><SectionHeading title="COMMUNITIES TO EXPLORE" subtitle="Find people around shared interests" action={setCategory && 'View all'} onAction={() => setCategory?.('communities')}/><div className="grid gap-3 ">{items.slice(0, setCategory ? 6 : items.length).map((item: Item) => { const active = Boolean(item.joined || item.isMember); return <article key={item.id} className="flex gap-4 rounded-lg border border-white/[.08] bg-[#101010] p-4 transition hover:border-white/[.16] hover:bg-[#161616]"><button type="button" onClick={() => open(item)}><CommunityAvatar item={item}/></button><div className="min-w-0 flex-1"><button type="button" onClick={() => open(item)} className="block w-full text-left"><b className="block truncate text-sm font-semibold text-[#f5f5f5]">{item.name}</b><small className="mt-0.5 block text-[#666]">{count(item._count?.members)} members · {count(item._count?.posts)} posts</small><p className="mt-2 line-clamp-2 text-xs leading-5 text-[#8a8a8a]">{item.description || item.category || 'A community on VANTA.'}</p></button><button type="button" disabled={item.isPrivate} onClick={() => join(item)} className={cn('mt-3 min-h-9 rounded-lg px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-45', active ? 'border border-white/[.12] text-[#b8b8b8]' : 'bg-[#f5f5f5] text-black hover:bg-white')}>{item.isPrivate ? 'Private' : active ? 'Joined' : 'Join'}</button></div></article>; })}</div></section>; }
function PostSection({ title, items, mutate, comment, share, openProfile }: any) { if (!items.length) return <EmptyState title="No posts to show yet." description="Popular posts will appear as the community interacts."/>; return <section><SectionHeading title={title} subtitle="Conversations getting strong engagement"/><div className="grid gap-4 ">{items.map((item: Item) => { const creator = creatorOf(item); return <article key={item.id} className="overflow-hidden rounded-lg border border-white/[.08] bg-[#101010]"><header className="flex items-center gap-3 p-3"><button type="button" onClick={() => openProfile(creator.username)}><Avatar src={creator.avatar} alt={creator.username || 'Creator'} size="sm"/></button><button type="button" onClick={() => openProfile(creator.username)} className="min-w-0 text-left"><b className="block truncate text-xs font-semibold text-[#e8e8e8]">{creator.fullName || creator.username || 'VANTA creator'}</b><small className="block truncate text-[#666]">@{creator.username}</small></button></header>{(item.content || item.description) && <p className="line-clamp-3 px-3 pb-3 text-sm leading-5 text-[#c8c8c8]">{item.content || item.description}</p>}{mediaOf(item) && <button type="button" onClick={() => location.assign(`/post/${cleanId(item)}`)} className="block aspect-[4/3] w-full overflow-hidden bg-[#080808]"><img src={mediaOf(item)} alt={item.content || 'Post'} loading="lazy" className="h-full w-full object-cover"/></button>}<footer className="flex items-center border-t border-white/[.06] p-1"><Action icon={Heart} label={item.liked ? 'Unlike post' : 'Like post'} active={item.liked} value={count(item.likes || item._count?.likes)} onClick={() => mutate(item, 'like')}/><Action icon={MessageCircle} label="Open comments" value={count(item.comments || item._count?.comments)} onClick={() => comment(item)}/><Action icon={Share2} label="Share post" value={count(item.shares)} onClick={() => share(item)}/><Action icon={Bookmark} label={item.saved ? 'Remove saved post' : 'Save post'} active={item.saved} onClick={() => mutate(item, 'save')}/></footer></article>; })}</div></section>; }

function Action({ icon: Icon, label, value, active, onClick }: any) { return <button type="button" onClick={onClick} aria-label={label} aria-pressed={active} className={cn('flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-md text-[11px] text-[#666] transition hover:bg-white/[.045] hover:text-white', active && 'text-white')}><Icon size={16} className={active ? 'fill-current' : ''}/>{value && <span>{value}</span>}</button>; }
function FollowButton({ active, onClick }: { active: boolean; onClick: () => void }) { return <button type="button" onClick={onClick} aria-pressed={active} className={cn('min-h-9 shrink-0 rounded-lg px-3 text-xs font-semibold transition active:scale-[.97]', active ? 'border border-white/[.12] text-[#b8b8b8] hover:bg-white/[.04]' : 'bg-[#f5f5f5] text-black hover:bg-white')}>{active ? 'Following' : 'Follow'}</button>; }
function Verified() { return <VerificationBadge verified size="sm" />; }
function CommunityAvatar({ item, small = false }: { item: Item; small?: boolean }) { const className = small ? 'h-10 w-10' : 'h-14 w-14'; return <span className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/[.08] bg-[#1c1c1c] text-[#8a8a8a]', className)}>{item.avatar || item.bannerUrl ? <img src={resolveMediaUrl(item.avatar || item.bannerUrl)} alt="" loading="lazy" className="h-full w-full object-cover"/> : <Users size={small ? 16 : 20}/>}</span>; }
function SidebarPanel({ title, children }: any) { return <section className="border-b border-white/[.08] pb-5"><h2 className="mb-2 text-[10px] font-semibold tracking-[.18em] text-[#8a8a8a]">{title}</h2>{children}</section>; }
function CreatorRow({ profile, open, follow }: any) { return <div className="flex items-center gap-3 py-2.5"><button type="button" onClick={open}><Avatar src={profile.avatar} alt={profile.username || 'Creator'} size="md"/></button><button type="button" onClick={open} className="min-w-0 flex-1 text-left"><b className="flex items-center gap-1 truncate text-sm font-medium text-[#d8d8d8]">{profile.fullName || profile.username}{profile.verified && <Verified/>}</b><small className="block truncate text-[#666]">@{profile.username}</small></button><FollowButton active={Boolean(profile.following || profile.isFollowing)} onClick={follow}/></div>; }
function LiveRow({ stream, open }: any) { const creator = creatorOf(stream); return <button type="button" onClick={open} className="flex w-full items-center gap-3 rounded-lg py-2.5 text-left"><span className="relative"><Avatar src={creator.avatar} alt={creator.username || 'Creator'} size="md"/><i className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-[#a42330] ring-2 ring-[#050505]"/></span><span className="min-w-0"><b className="block truncate text-sm font-medium text-[#d8d8d8]">{creator.fullName || creator.username || stream.title}</b><small className="flex items-center gap-1 text-[#666]"><Eye size={11}/>{count(stream.viewerCount || stream.viewers)} watching</small></span></button>; }
function SmallEmpty({ text }: { text: string }) { return <p className="py-4 text-xs leading-5 text-[#666]">{text}</p>; }
function EmptyState({ icon: Icon = Compass, title, description = 'Check back soon or explore another category.' }: any) { return <div className="rounded-lg border border-white/[.08] bg-[#101010] px-5 py-14 text-center"><Icon className="mx-auto text-[#666]"/><h2 className="mt-4 text-base font-semibold">{title}</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#666]">{description}</p></div>; }
function ErrorState({ retry }: { retry: () => void }) { return <div className="rounded-lg border border-white/[.08] bg-[#101010] px-5 py-16 text-center"><CircleAlert className="mx-auto text-[#8a8a8a]"/><h2 className="mt-4 text-lg font-semibold">Couldn&apos;t load Discover.</h2><p className="mt-2 text-sm text-[#666]">VANTA could not reach the discovery services.</p><button type="button" onClick={retry} className="mt-5 rounded-lg bg-[#f5f5f5] px-4 py-2.5 text-sm font-semibold text-black">Try Again</button></div>; }
function DiscoverSkeleton() { return <div className="space-y-9" aria-label="Loading Discover"><div className="aspect-[16/9] min-h-[220px] animate-pulse rounded-lg bg-white/[.045]"/><div><div className="mb-4 h-3 w-28 animate-pulse rounded bg-white/[.06]"/><div className="grid gap-px overflow-hidden rounded-lg ">{[1,2,3,4].map(item => <div key={item} className="h-14 animate-pulse bg-white/[.04]"/>)}</div></div><div><div className="mb-4 h-3 w-36 animate-pulse rounded bg-white/[.06]"/><div className="grid gap-3 ">{[1,2,3].map(item => <div key={item} className="h-44 animate-pulse rounded-lg bg-white/[.04]"/>)}</div></div></div>; }
function ShareSheet({ close, share }: any) { return <><motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} aria-label="Close share options" className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"/><motion.section role="dialog" aria-modal="true" aria-label="Share post" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 18 }} className="fixed bottom-0 left-0 right-0 z-50 mx-auto max-w-lg rounded-t-lg border border-white/[.1] bg-[#161616] p-5 shadow-2xl    "><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Share post</h2><button type="button" onClick={close} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-lg text-[#8a8a8a] hover:bg-white/[.05] hover:text-white"><X size={18}/></button></div><div className="grid grid-cols-3 gap-2">{[['COPY_LINK', 'Copy link'], ['NATIVE', 'Share'], ['MESSAGE', 'Message']].map(([id, label]) => <button key={id} type="button" onClick={() => share(id)} className="rounded-lg border border-white/[.08] p-4 text-xs text-[#b8b8b8] hover:bg-white/[.05]"><Share2 size={19} className="mx-auto mb-2 text-white"/>{label}</button>)}</div></motion.section></>; }