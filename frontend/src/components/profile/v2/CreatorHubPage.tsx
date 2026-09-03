'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence } from 'framer-motion';
import { Film, Heart, Image as ImageIcon, Info, MessageCircle, Radio, RefreshCw, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useContentCreation } from '@/components/create/ContentCreationContext';
import { apiDelete, apiGet, apiPost } from '@/lib/apiClient';
import CommentPanel from '@/components/social/CommentPanel';
import GiftPicker, { type GiftCatalogItem } from '@/components/social/GiftPicker';
import { useToast } from '@/components/ui/Toast';
import PeopleDialog from './PeopleDialog';
import ProfileContent from './ProfileContent';
import ProfileHeader from './ProfileHeader';
import ActiveFundraiserSection from '@/components/give/ActiveFundraiserSection';
import type { ProfileData, ProfileItem, ProfileTab } from './profileTypes';
import { cleanPostId, finite, postOnly, unwrap } from './profileTypes';

const TABS: Array<{ id: ProfileTab; label: string; icon: typeof Film; ownOnly?: boolean }> = [
  { id: 'posts', label: 'Posts', icon: MessageCircle },
  { id: 'reels', label: 'Reels', icon: Film },
  { id: 'live', label: 'Live', icon: Radio },
  { id: 'media', label: 'Media', icon: ImageIcon },
  { id: 'likes', label: 'Liked', icon: Heart, ownOnly: true },
];

const emptyContent = (): Record<ProfileTab, ProfileItem[]> => ({ posts: [], reels: [], live: [], media: [], likes: [], about: [] });
const errorStatus = (reason: any) => Number(reason?.statusCode ?? reason?.status ?? reason?.response?.status) || 0;

export default function CreatorHubPage({ username }: { username?: string }) {
  const { token, refreshToken, user, isLoading: authLoading } = useAuth(); const router = useRouter(); const toast = useToast();
  const { openPostModal } = useContentCreation();
  const normalized = username && username !== 'me' ? decodeURIComponent(username).replace(/^@/, '') : '';
  const own = !normalized || (!!user?.username && normalized.toLowerCase() === user.username.toLowerCase());
  const [profile, setProfile] = useState<ProfileData | null>(null); const [tab, setTab] = useState<ProfileTab>('posts');
  const [content, setContent] = useState(emptyContent); const [loading, setLoading] = useState(true); const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState(''); const [contentRetry, setContentRetry] = useState(0);
  const [error, setError] = useState<string | null>(null); const [menuOpen, setMenuOpen] = useState(false); const menuRef = useRef<HTMLDivElement>(null);
  const [unfollowOpen, setUnfollowOpen] = useState(false);
  const [deletePostFor, setDeletePostFor] = useState<ProfileItem>();
  const [followPending, setFollowPending] = useState(false);
  const [people, setPeople] = useState<'followers' | 'following' | null>(null); const [commentFor, setCommentFor] = useState<ProfileItem>();
  const [giftFor, setGiftFor] = useState<ProfileItem>(); const [gifts, setGifts] = useState<GiftCatalogItem[]>([]); const [balance, setBalance] = useState(0);
  const profileRequest = useRef(0);

  const loadProfile = useCallback(async () => {
    if (authLoading) return;
    if (own && !token && refreshToken) return;
    if (own && !token) { setLoading(false); router.replace('/login?next=/profile'); return; }
    const requestId = ++profileRequest.current;
    setLoading(true); setError(null);
    try {
      const nextProfile = await apiGet<ProfileData>(own ? '/api/profiles/me' : `/api/profiles/public/${encodeURIComponent(normalized)}`, token || undefined, { skipCache: true });
      if (requestId === profileRequest.current) setProfile(nextProfile);
    }
    catch (reason: any) {
      if (requestId !== profileRequest.current || reason?.statusCode === 499) return;
      const status = errorStatus(reason);
      setError(status === 404 ? 'not-found' : status === 401 || status === 403 ? 'unauthorized' : reason?.message || 'This profile could not be loaded.');
    }
    finally { if (requestId === profileRequest.current) setLoading(false); }
  }, [authLoading, normalized, own, refreshToken, router, token]);

  useEffect(() => { void loadProfile(); }, [loadProfile]);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close);
  }, []);

  const endpoint = useMemo(() => {
    const prefix = own ? '/api/profiles/me' : `/api/profiles/public/${encodeURIComponent(normalized)}`;
    if (tab === 'posts' || tab === 'media' || tab === 'reels') return `${prefix}/${tab}`;
    if (tab === 'live') return `${prefix}/livestreams`;
    if (tab === 'likes' && own) return '/api/profiles/me/likes';
    return '';
  }, [normalized, own, tab]);

  useEffect(() => {
    if (!profile || tab === 'about') return;
    if (!endpoint) { setContent(current => ({ ...current, [tab]: [] })); return; }
    let active = true; setContentLoading(true); setContentError('');
    apiGet<any>(`${endpoint}?limit=24`, token || undefined, { skipCache: true })
      .then(result => active && setContent(current => ({ ...current, [tab]: postOnly(unwrap(result)).map(item => tab === 'likes' && item.post ? { ...item.post, liked: true } : item) })))
      .catch((reason: any) => {
        if (!active || reason?.statusCode === 499) return;
        setContent(current => ({ ...current, [tab]: [] }));
        const status = errorStatus(reason);
        setContentError(status === 401 || status === 403 ? 'This content is not available to your account.' : reason?.message || `Unable to load ${tab}.`);
      })
      .finally(() => active && setContentLoading(false));
    return () => { active = false; };
  }, [contentRetry, endpoint, profile, tab, token]);

  const copyProfile = async () => {
    try { await navigator.clipboard.writeText(`${location.origin}/profile/${profile?.username}`); toast.success('Profile link copied'); }
    catch { toast.error('Unable to copy profile link'); }
    setMenuOpen(false);
  };
  const messageProfile = async () => {
    if (!profile) return;
    if (!token) { router.push(`/login?next=${encodeURIComponent(`/profile/${profile.username}`)}`); return; }
    try {
      const result = await apiPost<any>('/api/messages/start', { participantIds: [profile.id] }, token);
      const conversationId = result?.conversation?.id || result?.id;
      if (!conversationId) throw new Error('Conversation could not be opened.');
      router.push(`/chat?conversation=${encodeURIComponent(conversationId)}`);
    } catch (reason: any) { toast.error('Could not start chat', reason?.message); }
  };
  const follow = async () => {
    if (!profile || followPending) return;
    if (!token) return router.push(`/login?next=${encodeURIComponent(`/profile/${profile.username}`)}`);
    const wasFollowing = !!profile.isFollowing;
    if (wasFollowing && !unfollowOpen) { setUnfollowOpen(true); return; }
    setUnfollowOpen(false);
    setFollowPending(true);
    setProfile(current => current ? { ...current, isFollowing: !wasFollowing, stats: { ...current.stats, followers: Math.max(0, finite(current.stats?.followers ?? current._count?.followers) + (wasFollowing ? -1 : 1)) } } : current);
    try {
      const result: any = wasFollowing ? await apiDelete(`/api/profiles/${profile.username}/follow`, token) : await apiPost(`/api/profiles/${profile.username}/follow`, {}, token);
      setProfile(current => current ? { ...current, isFollowing: !!result?.isFollowing, stats: { ...current.stats, followers: finite(result?.counts?.target?.followers ?? current.stats?.followers) } } : current);
      if (own === false && result?.counts?.currentUser) {
        window.dispatchEvent(new CustomEvent('vanta:profile-counts-updated', {
          detail: { userId: user?.id, counts: result.counts.currentUser },
        }));
      }
      window.dispatchEvent(new CustomEvent('vanta:follow-updated', { detail: result }));
    }
    catch (reason: any) { void loadProfile(); toast.error('Follow update failed', reason?.message); }
    finally { setFollowPending(false); }
  };
  const updatePost = (id: string, patch: ProfileItem) => setContent(current => ({ ...current, [tab]: current[tab].map(item => cleanPostId(item) === id ? { ...item, ...patch } : item) }));
  const togglePost = async (item: ProfileItem, mode: 'like' | 'save') => {
    if (!token) return; const id = cleanPostId(item); const key = mode === 'like' ? 'liked' : 'saved'; const was = !!item[key];
    updatePost(id, { [key]: !was, ...(mode === 'like' ? { likes: Math.max(0, finite(item.likes ?? item._count?.likes) + (was ? -1 : 1)) } : {}) });
    try { if (mode === 'like') await apiPost(`/api/feed/${id}/like`, {}, token); else was ? await apiDelete(`/api/feed/${id}/save`, token) : await apiPost(`/api/feed/${id}/save`, {}, token); }
    catch (reason: any) { updatePost(id, { [key]: was }); toast.error('Post update failed', reason?.message); }
  };
  const deletePost = async (item: ProfileItem) => {
    if (!token) return;
    setDeletePostFor(item);
  };
  const confirmDeletePost = async () => {
    if (!token || !deletePostFor) return;
    const item = deletePostFor;
    setDeletePostFor(undefined);
    try {
      await apiDelete(`/api/feed/${cleanPostId(item)}`, token);
      setContent(current => ({ ...current, posts: current.posts.filter(post => cleanPostId(post) !== cleanPostId(item)) }));
      setProfile(current => current ? {
        ...current,
        counts: { ...current.counts, posts: Math.max(0, finite(current.counts?.posts ?? current.stats?.totalPosts) - 1) },
        stats: { ...current.stats, totalPosts: Math.max(0, finite(current.stats?.totalPosts ?? current.counts?.posts) - 1) },
      } : current);
      window.dispatchEvent(new CustomEvent('vanta:profile-counts-updated', { detail: { userId: profile?.id, delta: { posts: -1 } } }));
      toast.success('Post deleted');
    }
    catch (reason: any) { toast.error('Post not deleted', reason?.message); }
  };
  const openGift = async (item: ProfileItem) => {
    if (!token) return; setGiftFor(item);
    try { const [catalog, wallet] = await Promise.all([apiGet<any>('/api/monetization/gifts', token), apiGet<any>('/api/monetization/wallet', token, { skipCache: true })]); setGifts(unwrap(catalog) as GiftCatalogItem[]); setBalance(finite(wallet?.coinBalance)); }
    catch (reason: any) { setGiftFor(undefined); toast.error('Gift picker unavailable', reason?.message); }
  };

  if (authLoading || loading) return <ProfileSkeleton />;
  if (error || !profile) return <ProfileFailure kind={error || 'error'} retry={() => void loadProfile()} />;
  const avatar = profile.avatarUrl || profile.profile?.avatarUrl || profile.avatar || '';

  return <main className="profile-page">
    <ProfileHeader profile={profile} own={own} menuOpen={menuOpen} menuRef={menuRef} onMenu={() => setMenuOpen(value => !value)} onFollow={() => { void follow(); }} onMessage={() => { void messageProfile(); }} onGift={() => { void openGift(profile); }} onCopy={() => { void copyProfile(); }} onPeople={setPeople} followPending={followPending} />
    <ActiveFundraiserSection own={own} />
    <nav className="profile-tabs" aria-label="Profile content">{TABS.filter(item => !item.ownOnly || own).map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}><Icon size={16} strokeWidth={tab === id ? 2.4 : 1.9} /><span className="tab-label">{label}</span></button>)}</nav>
    <section className="profile-content" aria-live="polite">{contentLoading ? <ContentSkeleton /> : contentError ? <ContentError message={contentError} retry={() => setContentRetry(value => value + 1)} /> : <ProfileContent tab={tab} rows={content[tab]} profile={profile} own={own} router={router} onLike={item => void togglePost(item, 'like')} onSave={item => void togglePost(item, 'save')} onComment={setCommentFor} onGift={item => void openGift(item)} onDelete={item => void deletePost(item)} onShare={async item => { await navigator.clipboard.writeText(`${location.origin}/post/${cleanPostId(item)}`); toast.success('Post link copied'); }} onCreate={own ? openPostModal : undefined} />}</section>
    <AnimatePresence>{commentFor && token && <CommentPanel postId={cleanPostId(commentFor)} initialCount={finite(commentFor.comments ?? commentFor._count?.comments)} token={token} currentUser={user} onClose={() => setCommentFor(undefined)} onCountChange={value => updatePost(cleanPostId(commentFor), { comments: value })} />}{giftFor && token && <GiftPicker gifts={gifts} balance={balance} recipient={{ id: profile.id, username: profile.username, fullName: profile.fullName || profile.displayName || profile.username, avatar }} token={token} initialGift={null} onClose={() => setGiftFor(undefined)} onSent={remaining => { setBalance(remaining); setGiftFor(undefined); toast.success('Gift sent'); }} />}</AnimatePresence>
    {people && <PeopleDialog kind={people} own={own} username={profile.username} token={token || undefined} currentUserId={user?.id} close={() => setPeople(null)} />}
    {unfollowOpen && <ConfirmDialog username={profile.username} onCancel={() => setUnfollowOpen(false)} onConfirm={() => { void follow(); }} />}
    {deletePostFor && <DeleteDialog onCancel={() => setDeletePostFor(undefined)} onConfirm={() => { void confirmDeletePost(); }} />}
  </main>;
}

function ProfileSkeleton() { return <main className="profile-page" aria-label="Loading profile"><div className="profile-loading cover" /><div className="profile-loading identity"><i /><span /><span /><b /></div><div className="profile-loading tabs" /><ContentSkeleton /></main>; }
function ContentSkeleton() { return <div className="content-skeleton" aria-label="Loading profile content">{[1, 2, 3, 4, 5, 6, 7, 8].map(value => <i key={value} />)}</div>; }
function ContentError({ message, retry }: { message: string; retry: () => void }) { return <div className="profile-empty local-error"><span><Info /></span><h2>This content could not be loaded.</h2><p>{message}</p><button className="profile-button" onClick={retry}><RefreshCw size={15} />Try again</button></div>; }

function ProfileFailure({ kind, retry }: { kind: string; retry: () => void }) {
  const notFound = kind === 'not-found';
  const unauthorized = kind === 'unauthorized';
  return <main className="profile-page"><div className="profile-state full-page" role="alert">
    <span className="profile-state-code">{notFound ? '404' : unauthorized ? 'PRIVATE' : 'PROFILE ERROR'}</span>
    <Info size={28} />
    <h1>{notFound ? 'Profile not found' : unauthorized ? 'This profile is unavailable' : 'Couldn\'t load this profile'}</h1>
    <p>{notFound ? 'The account may have been removed or the username has changed.' : unauthorized ? 'Sign in with an account that has permission to view this profile.' : kind}</p>
    {!notFound && <button className="profile-button" onClick={retry}><RefreshCw size={15} />Try again</button>}
  </div></main>;
}

function ConfirmDialog({ username, onCancel, onConfirm }: { username: string; onCancel: () => void; onConfirm: () => void }) {
  return <><button className="dialog-backdrop" aria-label="Cancel unfollow" onClick={onCancel} /><section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="unfollow-title"><header><h2 id="unfollow-title">Unfollow @{username}?</h2><button className="profile-icon" aria-label="Close" onClick={onCancel}><X size={18} /></button></header><p>Their posts will no longer appear in your following feed.</p><footer><button className="profile-button" onClick={onCancel}>Cancel</button><button className="profile-button danger-action" onClick={onConfirm}>Unfollow</button></footer></section></>;
}

function DeleteDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return <><button className="dialog-backdrop" aria-label="Cancel delete" onClick={onCancel} /><section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title"><header><h2 id="delete-title">Delete this post?</h2><button className="profile-icon" aria-label="Close" onClick={onCancel}><X size={18} /></button></header><p>This cannot be undone. The post will be removed from your profile.</p><footer><button className="profile-button" onClick={onCancel}>Cancel</button><button className="profile-button danger-action" onClick={onConfirm}>Delete post</button></footer></section></>;
}