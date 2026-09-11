'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Eye, Heart, Link2, Loader2, MessageCircle, Repeat, Send, Share2, Trash2, X } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';
import { useAuth } from '@/context/AuthContext';
import { apiDelete, apiGet, apiPost } from '@/lib/apiClient';
import { useToast } from '@/components/ui/Toast';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { openStoryLayer, closeStoryLayer, longPressStartStory, longPressEndStory, resetStoryPlayback, startStoryPlayback, tapZone, type StoryPlaybackSnapshot } from '@/lib/storyPlayback';

type ViewerUser = { id: string; username: string; fullName?: string; avatar?: string; verified?: boolean };
type Story = { id: string; userId: string; mediaUrl: string; mediaType?: string; caption?: string; views?: number; viewed?: boolean; duration?: number; likeCount?: number; reshareCount?: number; commentCount?: number; likedByMe?: boolean; resharedFromUsername?: string; user?: ViewerUser; author?: ViewerUser };
type StoryGroup = { user: ViewerUser; stories: Story[]; hasUnviewed: boolean };
type Viewer = { id: string; viewedAt: string; user: ViewerUser };
type StoryComment = { id: string; content: string; createdAt: string; user: ViewerUser };

const compact = (value = 0) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : value >= 1_000 ? `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K` : String(value);
const DEFAULT_DURATION = 5000;

/**
 * Group stories by USER/OWNER — one tray entry per user regardless of how many
 * stories they posted. The viewer then walks the flat, user-ordered sequence so
 * a user's stories play automatically, one after the other, before advancing to
 * the next user's stories.
 */
function buildStoryGroups(raw: any[]): StoryGroup[] {
  const groups: StoryGroup[] = [];
  const byUser = new Map<string, StoryGroup>();
  for (const entry of raw || []) {
    if (Array.isArray(entry?.stories)) {
      const user: ViewerUser = entry.user || entry.author || {};
      const id = user.id || entry.userId || entry.ownerId;
      const key = String(id || JSON.stringify(user));
      let group = byUser.get(key);
      if (!group) { group = { user, stories: [], hasUnviewed: Boolean(entry.hasUnviewed) }; byUser.set(key, group); groups.push(group); }
      for (const story of entry.stories || []) {
        group.stories.push(story);
        if (story && !story.viewed) group.hasUnviewed = true;
      }
    } else if (entry?.id && entry?.mediaUrl) {
      const user: ViewerUser = entry.user || entry.author || {};
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

export default function StoryViewerPage({ params }: { params: { id: string } }) {
  const { token, user } = useAuth();
  const router = useRouter();
  const userId = useMemo(() => decodeURIComponent(params.id).trim(), [params.id]);

  const [groups, setGroups] = useState<StoryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [position, setPosition] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [tick, setTick] = useState(0);
  const [viewers, setViewers] = useState<Viewer[] | null>(null);
  const viewedRef = useRef<Set<string>>(new Set());
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const requestedFromRef = useRef<string | null>(null);
  // Story actions — Like / Comment / Reshare. Likes and comments are persisted
  // through the story API; each story payload carries likeCount / reshareCount /
  // commentCount / likedByMe so the owner sees real engagement numbers.
  const [shareOpen, setShareOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [reshareOpen, setReshareOpen] = useState(false);
  const [reshareText, setReshareText] = useState('');
  const [reshareSending, setReshareSending] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<StoryComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentSending, setCommentSending] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replySending, setReplySending] = useState(false);
  // Own-story deletion + comment deletion. Deletion removes the story/comment on
  // the server and then pops it out of the local viewer state.
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteSending, setDeleteSending] = useState(false);
  // Where to resume an IMAGE story's progress after the comment/reply composer
  // pauses it — keeps the "resume from where it stopped" behavior smooth.
  const resumeOffsetRef = useRef(0);
  // Centralized playback state machine (#11): every control (tap nav, long press,
  // reshare/comment/reply/share/delete overlays) drives this single state instead
  // of fighting over separate pause flags. Only one controller owns the active
  // story's progress.
  const [playbackState, setPlaybackState] = useState<'playing' | 'paused' | 'interaction'>('playing');
  const interactionLayersRef = useRef<Set<string>>(new Set());
  const longPressRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapSuppressedRef = useRef(false);
  const playbackSnapshotRef = useRef<StoryPlaybackSnapshot>(startStoryPlayback());
  const toast = useToast();

  // Read the ?start=<storyId> hint once on mount (client side, avoids SSR params).
  useEffect(() => {
    try {
      const paramsObj = new URLSearchParams(window.location.search);
      requestedFromRef.current = paramsObj.get('start');
    } catch { /* ignore */ }
  }, []);
const flat = useMemo(
    () => groups.flatMap(group => group.stories.map(story => ({ group, story }))),
    [groups]
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);
    void apiGet<any>('/api/stories', token || undefined, { skipCache: true })
      .then(raw => { if (active) setGroups(buildStoryGroups(Array.isArray(raw) ? raw : raw?.stories ?? raw?.data ?? [])); })
      .catch(() => { if (active) setLoadError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, userId]);

  // Choose the starting story: the one the tray asked for (opener), otherwise the
  // first unviewed story of the requested user, otherwise their newest story.
  useEffect(() => {
    if (loading || flat.length === 0 || position !== null) return;
    const requested = requestedFromRef.current;
    let index = -1;
    if (requested) index = flat.findIndex(item => item.story.id === requested);
    if (index < 0) index = flat.findIndex(item => item.group.user.id === userId && !item.story.viewed);
    if (index < 0) index = flat.findIndex(item => item.group.user.id === userId);
    if (index < 0) index = flat.findIndex(item => !item.story.viewed);
    setPosition(index < 0 ? 0 : index);
  }, [flat, loading, position, userId]);

  const current = position !== null && flat[position] ? flat[position] : null;
  const currentGroup = current?.group;
  const groupIndex = currentGroup ? groups.findIndex(group => group.user.id === currentGroup.user.id) : -1;
  const groupStories = groupIndex >= 0 ? groups[groupIndex].stories : [];
  const storyIndexInGroup = current && groupStories ? groupStories.findIndex(item => item.id === current.story.id) : -1;
  const isOwner = Boolean(current && user && current.story.userId === user.id);

  const advance = useCallback(() => {
    resumeOffsetRef.current = 0;
    playbackSnapshotRef.current = resetStoryPlayback();
    interactionLayersRef.current.clear();
    longPressRef.current = false;
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
    setPlaybackState('playing');
    setPosition(prev => {
      if (prev === null) return prev;
      if (prev + 1 >= flat.length) {
        router.replace('/home');
        return prev;
      }
      setTick(0);
      setPaused(false);
      return prev + 1;
    });
  }, [flat.length, router]);

  const retreat = useCallback(() => {
    resumeOffsetRef.current = 0;
    playbackSnapshotRef.current = resetStoryPlayback();
    interactionLayersRef.current.clear();
    longPressRef.current = false;
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
    setPlaybackState('playing');
    setPosition(prev => (prev === null || prev <= 0 ? prev : prev - 1));
    setTick(0);
    setPaused(false);
  }, []);

  // Mark each story viewed as it becomes the current story (once per session).
  useEffect(() => {
    if (!token || !current || viewedRef.current.has(current.story.id)) return;
    viewedRef.current.add(current.story.id);
    const storyId = current.story.id;
    void apiPost<{ views: number }>(`/api/stories/${encodeURIComponent(storyId)}/view`, {}, token)
      .then(result => setGroups(groups => groups.map(group => ({
        ...group,
        stories: group.stories.map(story => story.id === storyId ? { ...story, viewed: true, views: result?.views ?? story.views } : story),
      }))))
      .catch(() => undefined);
  }, [current, token]);

  // Automatic progression for IMAGE stories. When the story resumes after the
  // comment/reply composer paused it, the timer seeds from the saved offset so
  // playback continues from where it stopped instead of restarting.
  useEffect(() => {
    if (paused || !current) return;
    if (current.story.mediaType?.toUpperCase() === 'VIDEO') return;
    const duration = Number(current.story.duration) > 0 ? Number(current.story.duration) : DEFAULT_DURATION;
    const seed = Math.min(Math.max(0, resumeOffsetRef.current), duration);
    resumeOffsetRef.current = 0;
    const startedAt = Date.now() - seed;
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setTick(elapsed);
      if (elapsed >= duration) {
        window.clearInterval(timer);
        advance();
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [advance, current, paused]);

  // Pause the current story — used automatically when the comment/reply composer
  // opens. Videos stop in-place; image stories remember their elapsed progress.
  const applyPauseEffects = () => {
    if (!current) return;
    const media = videoRef.current;
    if (media && !media.paused) media.pause();
    if (!isVideo) {
      const duration = Number(current.story.duration) > 0 ? Number(current.story.duration) : DEFAULT_DURATION;
      resumeOffsetRef.current = Math.min(Math.max(0, tick), duration);
    }
    setPaused(true);
  };

  const commitPlaybackSnapshot = (next: StoryPlaybackSnapshot) => {
    playbackSnapshotRef.current = next;
    // Keep the runtime layer set in sync so the video guards below stay correct.
    interactionLayersRef.current = new Set(next.layers);
    setPlaybackState(next.state);
  };

  // Pause because an interaction (modal/action) opened. The story stops progressing
  // and preserves its position until every opened layer is released.
  const pauseStory = (reason: string) => {
    applyPauseEffects();
    commitPlaybackSnapshot(openStoryLayer(playbackSnapshotRef.current, reason));
  };

  const resumeStory = (reason?: string) => {
    let next = playbackSnapshotRef.current;
    if (reason) next = closeStoryLayer(next, reason);
    // Still held open by another overlay, or still being long-pressed -> stay paused.
    if (next.state !== 'playing') { commitPlaybackSnapshot(next); return; }
    commitPlaybackSnapshot(next);
    if (!current) return;
    if (isVideo) {
      const video = videoRef.current;
      if (video && video.paused) void video.play().catch(() => undefined);
    }
    setPaused(false);
  };

  // Long-press anywhere on the story pauses it (WhatsApp-style). Release resumes
  // from exactly where it stopped without restarting the story.
  const LONG_PRESS_MS = 600;
  const handleMediaPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button, input, textarea, a, [role="button"]')) return;
    if (!current) return;
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      longPressRef.current = true;
      tapSuppressedRef.current = true;
      applyPauseEffects();
      commitPlaybackSnapshot(longPressStartStory(playbackSnapshotRef.current));
    }, LONG_PRESS_MS);
  };

  const releaseLongPress = () => {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
    longPressRef.current = false;
    const next = longPressEndStory(playbackSnapshotRef.current);
    commitPlaybackSnapshot(next);
    // No overlay is holding the story open anymore -> resume from where it paused.
    if (next.state === 'playing' && current) {
      if (isVideo) {
        const video = videoRef.current;
        if (video && video.paused) void video.play().catch(() => undefined);
      }
      setPaused(false);
    }
  };

  const handleMediaTap = (event: React.MouseEvent<HTMLDivElement>) => {
    // A finished long-press must not also count as a navigation tap.
    if (tapSuppressedRef.current) { tapSuppressedRef.current = false; return; }
    // Never navigate when a button/control underneath handled the interaction.
    if ((event.target as HTMLElement).closest('button, input, textarea, a, [role="button"]')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    // Divide the viewing area into left (previous) and right (next) tap zones.
    if (tapZone(rect.width, x) === 'next') advance();
    else retreat();
  };

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      if (videoRef.current) videoRef.current.pause();
    };
  }, []);

  // Keyboard navigation.

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') advance();
      else if (event.key === 'ArrowLeft') retreat();
      else if (event.key === 'Escape') router.replace('/home');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [advance, retreat, router]);

  const openViewers = async () => {
    if (!token || !current || !isOwner) return;
    const items = await apiGet<Viewer[]>(`/api/stories/${current.story.id}/viewers`, token, { skipCache: true }).catch(() => []);
    setViewers(items);
    pauseStory('viewers');
  };

  if (loading) return <main className="grid min-h-[100dvh] place-items-center bg-[#050505] text-white"><Loader2 className="animate-spin text-white/50"/></main>;

  if (loadError) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-[#050505] px-6 text-center text-white">
        <div>
          <h1 className="text-xl font-semibold">Story unavailable</h1>
          <p className="mt-2 text-sm text-white/50">It may have expired or been removed.</p>
          <Link href="/home" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-white px-5 text-sm font-semibold text-black">Back home</Link>
        </div>
      </main>
    );
  }

  if (!current) {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-[#050505] px-6 text-center text-white">
        <div>
          <h1 className="text-xl font-semibold">No stories to show</h1>
          <p className="mt-2 text-sm text-white/50">This user has no active stories right now.</p>
          <Link href="/home" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-white px-5 text-sm font-semibold text-black">Back home</Link>
        </div>
      </main>
    );
  }
const creator = current.group.user || {};
  const isVideo = current.story.mediaType?.toUpperCase() === 'VIDEO';

// ─── Story actions: Like / Comment / Reshare ───────────────────────────
  const toggleLike = async () => {
    if (!current || !token) return;
    const storyId = current.story.id;
    const liked = Boolean(current.story.likedByMe);
    // Optimistic update so the rail responds instantly.
    setGroups(groups => groups.map(group => ({
      ...group,
      stories: group.stories.map(story => story.id === storyId ? {
        ...story,
        likedByMe: !liked,
        likeCount: Math.max(0, (story.likeCount || 0) + (liked ? -1 : 1)),
      } : story),
    })));
    try {
      const result = liked
        ? await apiDelete<{ liked: boolean; likeCount: number }>(`/api/stories/${encodeURIComponent(storyId)}/like`, token)
        : await apiPost<{ liked: boolean; likeCount: number }>(`/api/stories/${encodeURIComponent(storyId)}/like`, {}, token);
      setGroups(groups => groups.map(group => ({
        ...group,
        stories: group.stories.map(story => story.id === storyId ? {
          ...story,
          likedByMe: result?.liked ?? !liked,
          likeCount: result?.likeCount ?? story.likeCount,
        } : story),
      })));
    } catch (reason: any) {
      // Roll back the optimistic update.
      setGroups(groups => groups.map(group => ({
        ...group,
        stories: group.stories.map(story => story.id === storyId ? {
          ...story,
          likedByMe: liked,
          likeCount: story.likeCount,
        } : story),
      })));
      toast.error('Could not update like', reason?.message);
    }
  };

  const openComments = async () => {
    if (!current || !token) return;
    setCommentsOpen(true);
    pauseStory('comments');
    setCommentsLoading(true);
    try {
      const items = await apiGet<StoryComment[]>(`/api/stories/${encodeURIComponent(current.story.id)}/comments`, token, { skipCache: true });
      setComments(Array.isArray(items) ? items : []);
    } catch {
      setComments([]);
    } finally {
      setCommentsLoading(false);
    }
  };

  const deleteStoryComment = async (comment: StoryComment) => {
    if (!current || !token || !comment?.id) return;
    const storyId = current.story.id;
    try {
      const result = await apiDelete<{ deleted: boolean; commentCount: number }>(`/api/stories/${encodeURIComponent(storyId)}/comments/${encodeURIComponent(comment.id)}`, token);
      setComments(items => items.filter(item => item.id !== comment.id));
      if (typeof result?.commentCount === 'number') {
        setGroups(groups => groups.map(group => ({
          ...group,
          stories: group.stories.map(story => story.id === storyId ? { ...story, commentCount: result.commentCount } : story),
        })));
      }
    } catch (reason: any) {
      toast.error('Comment not deleted', reason?.message);
    }
  };

  const sendComment = async () => {
    if (!current || !token || !commentText.trim() || commentSending) return;
    const storyId = current.story.id;
    setCommentSending(true);
    try {
      const comment = await apiPost<StoryComment>(`/api/stories/${encodeURIComponent(storyId)}/comments`, { content: commentText.trim() }, token);
      setComments(prev => [...prev, comment]);
      setCommentText('');
      setGroups(groups => groups.map(group => ({
        ...group,
        stories: group.stories.map(story => story.id === storyId ? { ...story, commentCount: (story.commentCount || 0) + 1 } : story),
      })));
      resumeStory('comments');
    } catch (reason: any) {
      toast.error('Could not add comment', reason?.message);
    } finally {
      setCommentSending(false);
    }
  };

  // Reshare — posts this story directly to MY OWN Status (WhatsApp-style
  // reshare). It never opens a share sheet or a send-to-people menu.
  const sendReshare = async () => {
    if (!current || !token || reshareSending) return;
    const storyId = current.story.id;
    setReshareSending(true);
    try {
      await apiPost(`/api/stories/${encodeURIComponent(storyId)}/reshare`, { caption: reshareText.trim() || undefined }, token);
      setReshareOpen(false);
      resumeStory('reshare');
      setReshareText('');
      toast.success('Reshared to your Story');
    } catch (reason: any) {
      toast.error('Could not reshare story', reason?.message);
    } finally {
      setReshareSending(false);
    }
  };

  const storyShareUrl = () => {
    if (typeof window === 'undefined' || !current) return '';
    const ownerId = creator.id || current.story.userId;
    if (!ownerId) return '';
    const storyId = current.story.id;
    return `${window.location.origin}/stories/${encodeURIComponent(ownerId)}?start=${encodeURIComponent(storyId)}`;
  };

  const handleShareAction = async (destination: string) => {
    if (!current) return;
    const url = storyShareUrl();
    if (destination === 'COPY_LINK') {
      try {
        await navigator.clipboard.writeText(url);
        setShareCopied(true);
        window.setTimeout(() => setShareCopied(false), 1500);
      } catch (reason: any) {
        toast.error('Could not copy link', reason?.message);
      }
      return;
    }
    if (destination === 'NATIVE') {
      if (navigator.share) {
        try {
          await navigator.share({ title: 'VANTA Story', text: current.story.caption || `Story by ${creator.fullName || creator.username || 'VANTA'}`, url });
        } catch { /* User dismissed the native share sheet. */ }
      } else {
        try {
          await navigator.clipboard.writeText(url);
          setShareCopied(true);
          window.setTimeout(() => setShareCopied(false), 1500);
        } catch (reason: any) {
          toast.error('Could not copy link', reason?.message);
        }
      }
      setShareOpen(false);
      resumeStory('share');
      return;
    }
    if (destination === 'MESSAGE') {
      router.push(`/chat?share=${encodeURIComponent(url)}`);
      setShareOpen(false);
      return;
    }
  };

  // Reply — sends the story owner a direct message via the existing chat API.
  const sendStoryReply = async () => {
    if (!token || !current || !replyText.trim() || replySending) return;
    const ownerId = creator.id || current.story.userId;
    if (!ownerId) return;
    setReplySending(true);
    try {
      const result = await apiPost<{ conversation?: { id: string } }>(`/api/messages/start`, { participantIds: [ownerId], type: 'DIRECT' }, token);
      const conversationId = result?.conversation?.id;
      if (!conversationId) throw new Error('Could not open a conversation with the story owner.');
      await apiPost(`/api/messages/send`, { conversationId, content: replyText.trim(), type: 'TEXT' }, token);
      setReplyText('');
      setReplyOpen(false);
      resumeStory('reply');
      toast.success('Reply sent');
    } catch (reason: any) {
      toast.error('Reply failed', reason?.message);
    } finally {
      setReplySending(false);
    }
  };
  // Delete the current story (owner only). Confirmed in a dialog, then removed
  // from the viewer immediately after the server confirms — no page refresh.
  const confirmDeleteStory = async () => {
    if (!token || !current || deleteSending) return;
    const storyId = current.story.id;
    const deletedAt = position ?? 0;
    setDeleteSending(true);
    try {
      await apiDelete(`/api/stories/${encodeURIComponent(storyId)}`, token);
      setDeleteConfirmOpen(false);
      resumeStory('delete');
      interactionLayersRef.current.clear();
      playbackSnapshotRef.current = resetStoryPlayback();
      setPlaybackState('playing');
      const nextGroups = groups
        .map(group => ({ ...group, stories: group.stories.filter(story => story.id !== storyId) }))
        .filter(group => group.stories.length > 0);
      const remaining = nextGroups.flatMap(group => group.stories);
      if (remaining.length === 0) {
        router.replace('/home');
        return;
      }
      setGroups(nextGroups);
      resumeOffsetRef.current = 0;
      setTick(0);
      setPaused(false);
      setCommentsOpen(false);
      setReplyOpen(false);
      setPosition(Math.min(deletedAt, remaining.length - 1));
      toast.success('Story deleted');
    } catch (reason: any) {
      toast.error('Story not deleted', reason?.message);
    } finally {
      setDeleteSending(false);
    }
  };

  return (
    <main className="relative h-[100dvh] overflow-hidden bg-[#050505] text-white">
      {/* Media */}
      <div className="absolute inset-0 grid place-items-center bg-black" onClick={handleMediaTap} onPointerDown={handleMediaPointerDown} onPointerUp={releaseLongPress} onPointerCancel={releaseLongPress} onPointerLeave={releaseLongPress} onContextMenu={event => { if (event.button === 2 && !isOwner) event.preventDefault(); }} role="presentation">
        {isVideo ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            key={current.story.id}
            ref={videoRef}
            src={resolveMediaUrl(current.story.mediaUrl)}
            autoPlay
            playsInline
            preload="auto"
            className="max-h-full w-full object-contain"
            onEnded={advance}
            onPlay={() => { if (!longPressRef.current && interactionLayersRef.current.size === 0) { setPaused(false); setTick(0); } }}
            onPause={() => { if (!longPressRef.current && interactionLayersRef.current.size === 0) setPaused(true); }}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={current.story.id}
            src={resolveMediaUrl(current.story.mediaUrl)}
            alt={current.story.caption || 'VANTA Story'}
            className="max-h-full w-full object-contain"
          />
        )}
      </div>

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/70 via-transparent to-black/75" />

      {/* Progress segments (one per story from the current user) */}
      <div className="absolute inset-x-0 top-0 z-20 flex gap-1 px-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        {groupStories.map((story, segmentIndex) => {
          const isCurrentSegment = storyIndexInGroup === segmentIndex;
          const isDone = isCurrentSegment ? false : (segmentIndex < storyIndexInGroup || story.viewed);
          const ratio = isCurrentSegment
            ? isVideo
              ? 1
              : Math.min(1, tick / (Number(story.duration) > 0 ? Number(story.duration) : DEFAULT_DURATION))
            : 0;
          return (
            <div key={story.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/25">
              <div
                className="h-full rounded-full bg-white transition-[width] duration-100 ease-linear"
                style={{ width: `${Math.round((isDone ? 1 : ratio) * 100)}%` }}
              />
            </div>
          );
        })}
      </div>

      {/* Header */}
      <header className="absolute inset-x-0 top-0 z-10 flex items-center gap-3 p-4 pt-[max(2rem,calc(env(safe-area-inset-top)+0.75rem))]">
        <button type="button" onClick={() => router.replace('/home')} aria-label="Back" className="grid h-11 w-11 place-items-center rounded-full bg-black/45 backdrop-blur"><ArrowLeft size={20}/></button>
        <Avatar src={creator.avatar} alt={creator.username || 'Story owner'} size="sm"/>
        <div className="min-w-0">
          <span className="flex items-center gap-1.5"><b className="truncate text-sm">{creator.fullName || creator.username || 'VANTA'}</b>{creator.verified && <VerificationBadge verified size="sm" />}</span>
          {creator.username && (
            <button type="button" onClick={() => router.push(`/profile/${creator.username}`)} className="block max-w-[200px] truncate text-[11px] text-white/60">@{creator.username}</button>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {isOwner && (
            <button type="button" onClick={() => void openViewers()} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-black/45 px-3 text-[11px] text-[#c8c8cc] backdrop-blur" aria-label="Open Story viewers">
              <Eye size={14}/>{compact(current.story.views || 0)} views
            </button>
          )}
          <button type="button" onClick={() => { pauseStory('share'); setShareOpen(true); }} aria-label="Share story" className="grid h-10 w-10 place-items-center rounded-full bg-black/45 text-white/80 backdrop-blur">
            <Share2 size={16}/>
          </button>
          {isOwner && (
            <button type="button" onClick={() => { pauseStory('delete'); setDeleteConfirmOpen(true); }} aria-label="Delete story" className="grid h-10 w-10 place-items-center rounded-full bg-black/45 text-white/80 backdrop-blur">
              <Trash2 size={16}/>
            </button>
          )}
          <button type="button" onClick={() => router.replace('/home')} aria-label="Close story" className="grid h-10 w-10 place-items-center rounded-full bg-black/45 text-white/80 backdrop-blur"><X size={18}/></button>
        </div>
      </header>
{/* Caption */}
      <div className="absolute inset-x-0 bottom-0 z-10 p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        {current.story.resharedFromUsername && (
          <p className="mb-2 flex items-center gap-1.5 text-xs text-white/60">
            <Repeat size={13}/> Reshared from @{current.story.resharedFromUsername}
          </p>
        )}
        {current.story.caption && <p className="mb-3 max-w-lg text-sm leading-6 text-white/90">{current.story.caption}</p>}
      </div>

{/* Story actions — owner sees engagement stats; viewers see Like → Comment → Reshare */}
      <div className="absolute bottom-0 right-0 z-10 flex flex-col items-center gap-3 p-3 pb-[max(1.15rem,env(safe-area-inset-bottom))]">
        {isOwner ? (
          <div className="flex flex-col items-center gap-4 rounded-2xl bg-black/35 px-2.5 py-3 backdrop-blur">
            <div className="flex flex-col items-center gap-1 text-white/85" title="Likes">
              <Heart size={19} strokeWidth={2} className={current.story.likeCount ? 'fill-current text-[#3b82f6]' : 'text-white/70'} />
              <span className="text-[11px] font-semibold tabular-nums">{compact(current.story.likeCount || 0)}</span>
            </div>
            <div className="flex flex-col items-center gap-1 text-white/85" title="Reshares">
              <Repeat size={19} strokeWidth={2} className="text-white/70" />
              <span className="text-[11px] font-semibold tabular-nums">{compact(current.story.reshareCount || 0)}</span>
            </div>
            <div className="flex flex-col items-center gap-1 text-white/85" title="Comments">
              <MessageCircle size={19} strokeWidth={2} className="text-white/70" />
              <span className="text-[11px] font-semibold tabular-nums">{compact(current.story.commentCount || 0)}</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2.5">
            <button
              type="button"
              onClick={() => void toggleLike()}
              aria-label={current.story.likedByMe ? 'Unlike story' : 'Like story'}
              aria-pressed={Boolean(current.story.likedByMe)}
              className="flex w-16 flex-col items-center gap-1 rounded-2xl bg-black/45 px-2 py-2 text-white backdrop-blur transition active:scale-95"
            >
              <Heart size={19} strokeWidth={2} className={current.story.likedByMe ? 'fill-current text-[#3b82f6]' : ''} />
              <span className="text-[10px] font-medium text-white/70">Like</span>
            </button>
            <button
              type="button"
              onClick={() => void openComments()}
              aria-label="Comment on story"
              className="flex w-16 flex-col items-center gap-1 rounded-2xl bg-black/45 px-2 py-2 text-white backdrop-blur transition active:scale-95"
            >
              <MessageCircle size={19} strokeWidth={2} />
              <span className="text-[10px] font-medium text-white/70">Comment</span>
            </button>
            <button
              type="button"
              onClick={() => { pauseStory('reshare'); setReshareOpen(true); }}
              aria-label="Reshare story to your Status"
              className="flex w-16 flex-col items-center gap-1 rounded-2xl bg-black/45 px-2 py-2 text-white backdrop-blur transition active:scale-95"
            >
              <Repeat size={19} strokeWidth={2} />
              <span className="text-[10px] font-medium text-white/70">Reshare</span>
            </button>
          </div>
        )}
      </div>
      {/* Viewers list (own stories only) */}
      {viewers && (
        <>
          <button type="button" onClick={() => { setViewers(null); resumeStory('viewers'); }} aria-label="Close viewers" className="fixed inset-0 z-40 bg-black/65 backdrop-blur-sm"/>
          <section role="dialog" aria-modal="true" aria-label="Story viewers" className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[72dvh] w-full max-w-md flex-col rounded-t-3xl border border-white/10 bg-[#151517] pb-[env(safe-area-inset-bottom)]">
            <header className="flex min-h-16 items-center justify-between border-b border-white/[.08] px-5">
              <div><h2 className="font-semibold">Story viewers</h2><p className="text-xs text-[#c8c8cc]/55">{viewers.length} unique views</p></div>
              <button type="button" onClick={() => { setViewers(null); resumeStory('viewers'); }} className="grid h-11 w-11 place-items-center rounded-full text-[#c8c8cc]" aria-label="Close"><X size={20}/></button>
            </header>
            <div className="overflow-y-auto px-5">
              {viewers.length ? viewers.map(viewer => (
                <article key={viewer.id} className="flex items-center gap-3 border-b border-white/[.06] py-3">
                  <Avatar src={viewer.user.avatar} alt={viewer.user.username} size="md"/>
                  <div className="min-w-0 flex-1"><b className="block truncate text-sm">{viewer.user.fullName || viewer.user.username}</b><p className="truncate text-xs text-[#c8c8cc]/55">@{viewer.user.username}</p></div>
                  <time className="text-[11px] text-[#c8c8cc]/45">{new Date(viewer.viewedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
                </article>
              )) : <p className="py-10 text-center text-sm text-[#c8c8cc]/50">No viewers yet.</p>}
            </div>
          </section>
        </>
      )}
{/* Generic Share sheet (Copy link / Share / Message) — kept separate from Reshare */}
      {shareOpen && (
        <>
          <button type="button" onClick={() => { setShareOpen(false); resumeStory('share'); }} aria-label="Close share options" className="fixed inset-0 z-40 bg-black/65 backdrop-blur-sm" />
          <section role="dialog" aria-modal="true" aria-label="Share story" className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md rounded-t-3xl border border-white/10 bg-[#151517] p-5 pb-[env(safe-area-inset-bottom)]">
            <header className="mb-4 flex items-center justify-between">
              <div><h2 className="font-semibold">Share story</h2><p className="text-xs text-[#c8c8cc]/55">{creator.fullName || creator.username || 'VANTA'}</p></div>
              <button type="button" onClick={() => { setShareOpen(false); resumeStory('share'); }} aria-label="Close" className="grid h-11 w-11 place-items-center rounded-full text-[#c8c8cc]"><X size={20}/></button>
            </header>
            <div className="grid grid-cols-3 gap-2">
              <button type="button" onClick={() => void handleShareAction('COPY_LINK')} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 text-xs text-[#b8b8b8] transition hover:bg-white/[0.06]">
                {shareCopied ? <Check size={19} className="mx-auto mb-2 text-[#c9a227]" /> : <Link2 size={19} className="mx-auto mb-2 text-white" />}
                {shareCopied ? 'Copied' : 'Copy link'}
              </button>
              <button type="button" onClick={() => void handleShareAction('NATIVE')} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 text-xs text-[#b8b8b8] transition hover:bg-white/[0.06]">
                <Share2 size={19} className="mx-auto mb-2 text-white" />
                Share
              </button>
              <button type="button" onClick={() => void handleShareAction('MESSAGE')} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 text-xs text-[#b8b8b8] transition hover:bg-white/[0.06]">
                <MessageCircle size={19} className="mx-auto mb-2 text-white" />
                Message
              </button>
            </div>
          </section>
        </>
      )}

      {/* Reshare composer — posts this story to MY OWN Status (WhatsApp-style
          status reshare). It never opens a share sheet or a send-to-people menu. */}
      {reshareOpen && current && (
        <>
          <button type="button" onClick={() => { setReshareOpen(false); resumeStory('reshare'); }} aria-label="Close reshare composer" className="fixed inset-0 z-40 bg-black/65 backdrop-blur-sm" />
          <section role="dialog" aria-modal="true" aria-label="Reshare to your Story" className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md rounded-t-3xl border border-white/10 bg-[#151517] p-5 pb-[env(safe-area-inset-bottom)]">
            <header className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Reshare to your Story</h2>
                <p className="text-xs text-[#c8c8cc]/55">Will appear on your Status for 24 hours</p>
              </div>
              <button type="button" onClick={() => { setReshareOpen(false); resumeStory('reshare'); }} aria-label="Close" className="grid h-11 w-11 place-items-center rounded-full text-[#c8c8cc]"><X size={20}/></button>
            </header>
            <div className="mb-4 flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-black/25 p-3">
              {isVideo ? (
                <video src={resolveMediaUrl(current.story.mediaUrl)} muted playsInline className="h-20 w-16 shrink-0 rounded-xl object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={resolveMediaUrl(current.story.mediaUrl)} alt="Story preview" className="h-20 w-16 shrink-0 rounded-xl object-cover" />
              )}
              <div className="min-w-0">
                <p className="truncate text-sm text-white/90">Original story by @{current.story.resharedFromUsername || creator.username || 'VANTA'}</p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-white/40"><Repeat size={12}/> Reposted to your Status</p>
              </div>
            </div>
            <form
              onSubmit={event => { event.preventDefault(); void sendReshare(); }}
              className="flex items-center gap-2"
            >
              <input
                autoFocus
                value={reshareText}
                onChange={event => setReshareText(event.target.value)}
                placeholder="Add a caption…"
                aria-label="Reshare caption"
                maxLength={500}
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none focus:border-[#3b82f6]/60"
              />
              <button
                type="submit"
                disabled={reshareSending}
                aria-label="Post reshare"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#3b82f6] text-white transition hover:bg-[#2563eb] disabled:opacity-40"
              >
                {reshareSending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              </button>
            </form>
          </section>
        </>
      )}

      {/* Comments sheet — real story comments */}
      {commentsOpen && current && (
        <>
          <button type="button" onClick={() => { setCommentsOpen(false); resumeStory('comments'); }} aria-label="Close comments" className="fixed inset-0 z-40 bg-black/65 backdrop-blur-sm" />
          <section role="dialog" aria-modal="true" aria-label="Story comments" className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[72dvh] w-full max-w-md flex-col rounded-t-3xl border border-white/10 bg-[#151517] pb-[env(safe-area-inset-bottom)]">
            <header className="flex min-h-16 items-center justify-between border-b border-white/[.08] px-5">
              <div>
                <h2 className="font-semibold">Comments</h2>
                <p className="text-xs text-[#c8c8cc]/55">{comments.length} comment{comments.length === 1 ? '' : 's'}</p>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => { setCommentsOpen(false); resumeStory('comments'); pauseStory('reply'); setReplyOpen(true); }} className="rounded-full px-3 py-2 text-xs text-[#c8c8cc] transition hover:bg-white/[0.06] hover:text-white" aria-label="Message the story owner">
                  Message @{creator.username || 'owner'}
                </button>
                <button type="button" onClick={() => { setCommentsOpen(false); resumeStory('comments'); }} className="grid h-11 w-11 place-items-center rounded-full text-[#c8c8cc]" aria-label="Close"><X size={20}/></button>
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5">
              {commentsLoading ? (
                <div className="grid h-24 place-items-center"><Loader2 className="animate-spin text-white/40"/></div>
              ) : comments.length ? (
                comments.map(comment => (
                  <article key={comment.id} className="flex items-start gap-3 border-b border-white/[.06] py-3">
                    <Avatar src={comment.user.avatar} alt={comment.user.username} size="sm"/>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm"><b className="mr-1">@{comment.user.username}</b><span className="break-words text-white/90">{comment.content}</span></p>
                      <time className="text-[11px] text-[#c8c8cc]/45">{new Date(comment.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
                    </div>
                    {(comment.user.id === user?.id || isOwner) && (
                      <button type="button" onClick={() => void deleteStoryComment(comment)} aria-label="Delete comment" className="-mr-1 grid h-8 w-8 shrink-0 place-items-center self-center rounded-lg text-[#c8c8cc]/50 transition hover:bg-white/[0.06] hover:text-white">
                        <Trash2 size={14}/>
                      </button>
                    )}
                  </article>
                ))
              ) : (
                <p className="py-10 text-center text-sm text-[#c8c8cc]/50">No comments yet — be the first.</p>
              )}
            </div>
            <form
              onSubmit={event => { event.preventDefault(); void sendComment(); }}
              className="flex items-center gap-2 border-t border-white/[0.06] px-4 py-3"
            >
              <input
                value={commentText}
                onChange={event => setCommentText(event.target.value)}
                placeholder="Add a comment…"
                aria-label="Add a comment"
                maxLength={1000}
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/25 px-4 py-2.5 text-sm text-white outline-none focus:border-[#3b82f6]/60"
              />
              <button
                type="submit"
                disabled={!commentText.trim() || commentSending}
                aria-label="Post comment"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#3b82f6] text-white transition hover:bg-[#2563eb] disabled:opacity-40"
              >
                {commentSending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </form>
          </section>
        </>
      )}

      {/* Reply composer — sends the story owner a direct message */}
      {replyOpen && (
        <>
          <button type="button" onClick={() => { setReplyOpen(false); resumeStory('reply'); }} aria-label="Close reply composer" className="fixed inset-0 z-40 bg-black/65" />
          <section role="dialog" aria-modal="true" aria-label="Reply to story" className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md rounded-t-3xl border border-white/10 bg-[#151517] p-5 pb-[env(safe-area-inset-bottom)]">
            <header className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Reply to @{creator.username || 'story'}</h2>
                <p className="text-xs text-[#c8c8cc]/55">Sent as a direct message to {creator.fullName || creator.username || 'the story owner'}</p>
              </div>
              <button type="button" onClick={() => { setReplyOpen(false); resumeStory('reply'); }} aria-label="Close" className="grid h-11 w-11 place-items-center rounded-full text-[#c8c8cc]"><X size={20}/></button>
            </header>
            <form
              onSubmit={event => { event.preventDefault(); void sendStoryReply(); }}
              className="flex items-center gap-2"
            >
              <input
                autoFocus
                value={replyText}
                onChange={event => setReplyText(event.target.value)}
                placeholder="Reply…"
                aria-label="Reply to story"
                maxLength={2000}
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none focus:border-[#c9a227]/60"
              />
              <button
                type="submit"
                disabled={!replyText.trim() || replySending}
                aria-label="Send reply"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[#c9a227]/60 bg-[#c9a227] text-black transition hover:bg-[#f2c75c] disabled:opacity-30"
              >
                {replySending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              </button>
            </form>
          </section>
        </>
      )}

      {/* Delete story confirmation (owner only) */}
      {deleteConfirmOpen && (
        <>
          <button type="button" onClick={() => { setDeleteConfirmOpen(false); resumeStory('delete'); }} aria-label="Cancel delete" className="fixed inset-0 z-[70] bg-black/65 backdrop-blur-sm" />
          <section role="alertdialog" aria-modal="true" aria-label="Delete story" className="fixed z-[80] top-1/2 left-1/2 w-[min(400px,calc(100%-24px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-[#151517] p-5 shadow-2xl">
            <header className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Delete this story?</h2>
              <button type="button" onClick={() => { setDeleteConfirmOpen(false); resumeStory('delete'); }} className="grid h-9 w-9 place-items-center rounded-full text-[#c8c8cc]" aria-label="Close"><X size={18}/></button>
            </header>
            <p className="mb-5 text-sm text-[#c8c8cc]/65">This cannot be undone. The story will be removed from your Status immediately.</p>
            <div className="flex items-center justify-end gap-2">
              <button type="button" disabled={deleteSending} onClick={() => { setDeleteConfirmOpen(false); resumeStory('delete'); }} className="min-h-11 rounded-lg border border-white/10 px-4 text-sm text-[#c8c8cc] transition hover:bg-white/[0.05]">Cancel</button>
              <button type="button" disabled={deleteSending} onClick={() => void confirmDeleteStory()} className="min-h-11 rounded-lg bg-[#b4232f] px-4 text-sm font-semibold text-white transition hover:bg-[#9f1d2a] disabled:opacity-40">{deleteSending ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}Delete story</button>
            </div>
          </section>
        </>
      )}
    </main>
  );
}