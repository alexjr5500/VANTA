'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Hash, Loader2, MessageCircle, Share2, Users } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { apiDelete, apiGet, apiPost } from '@/lib/apiClient';
import { resolveMediaUrl } from '@/lib/mediaUrl';

type Community = {
  id: string;
  kind: 'group' | 'channel';
  name: string;
  description?: string;
  avatar?: string;
  category?: string;
  conversationId?: string;
  joined: boolean;
  owner?: { id: string; username: string; avatar?: string } | null;
  _count?: { members: number; posts: number };
};

/**
 * Public Group/Channel share-link landing page.
 *
 * The Communities discovery directory on Discover links here, and this unique
 * `/communities/:id` URL is the shareable link for a public Group or Channel.
 * It resolves the existing Group/Channel by its real database id (never a
 * mock), shows its public profile and uses the existing membership endpoints
 * for Join/Leave. After joining, the existing Messages routing opens the
 * Group/Channel conversation.
 */
export default function CommunityPage({ params }: { params: { id: string } }) {
  const { token, user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [community, setCommunity] = useState<Community | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!token) return;
    let current = true;
    setLoading(true);
    setError('');
    apiGet<Community>(`/api/communities/discover/${encodeURIComponent(params.id)}`, token, { skipCache: true })
      .then(data => { if (current) setCommunity(data); })
      .catch((reason: any) => { if (current) setError(reason?.message || 'This community could not be found.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [params.id, token]);

  const toggleJoin = async () => {
    if (!token || !community || joining) return;
    const was = Boolean(community.joined);
    setJoining(true);
    try {
      if (community.kind === 'channel') {
        await apiPost(`/api/channels/${community.id}/${was ? 'leave' : 'join'}`, {}, token);
      } else if (was) {
        await apiDelete(`/api/groups/${community.id}/members/${encodeURIComponent(user?.id || '')}`, token);
      } else {
        await apiPost(`/api/groups/${community.id}/join`, {}, token);
      }
      setCommunity({ ...community, joined: !was, _count: { members: Math.max(0, Number(community._count?.members || 0) + (was ? -1 : 1)), posts: Number(community._count?.posts || 0) } });
      toast.success(was ? 'Left community' : 'Joined community');
    } catch (reason: any) {
      toast.error('Community update failed', reason?.message);
    } finally {
      setJoining(false);
    }
  };

  const copyLink = async () => {
    const url = `${location.origin}/communities/${params.id}`;
    try { await navigator.clipboard.writeText(url); toast.success('Link copied'); }
    catch { toast.error('Could not copy the link'); }
  };

  if (loading) {
    return (
      <main className="min-h-[100dvh] w-full bg-[#050505] px-4 py-5 text-white">
        <div className="grid min-h-[70dvh] place-items-center"><Loader2 className="mx-auto animate-spin text-[#666]" size={34} /></div>
      </main>
    );
  }

  if (error || !community) {
    return (
      <main className="min-h-[100dvh] w-full bg-[#050505] px-4 py-5 text-white">
        <div className="mx-auto w-full min-w-0 max-w-[520px]">
          <Link href="/discover" className="mb-5 inline-flex items-center gap-2 text-sm text-[#8a8a8a] hover:text-white"><ArrowLeft size={17} />Back to Discover</Link>
          <div className="rounded-lg border border-white/[.08] bg-[#101010] px-5 py-14 text-center">
            <Users className="mx-auto text-[#666]" size={28} />
            <h1 className="mt-4 text-base font-semibold">Community not found</h1>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#666]">This public Group or Channel may have been removed, or the link is not public.</p>
            <Link href="/discover" className="mt-5 rounded-lg bg-[#f5f5f5] px-4 py-2.5 text-sm font-semibold text-black">Explore Discover</Link>
          </div>
        </div>
      </main>
    );
  }

  const channel = community.kind === 'channel';
  const handle = channel && community.name ? `@${community.name.toLowerCase().replace(/\s+/g, '-')}` : '';
  const owner = community.owner;
  return (
    <main className="min-h-[100dvh] w-full bg-[#050505] px-4 py-5 text-white">
      <div className="mx-auto w-full min-w-0 max-w-[520px]">
        <Link href="/discover" className="mb-5 inline-flex items-center gap-2 text-sm text-[#8a8a8a] hover:text-white"><ArrowLeft size={17} />Back to Discover</Link>
        <section className="overflow-hidden rounded-2xl border border-white/[.1] bg-[#101010]">
          <div className="border-b border-white/[.08] px-5 py-6 text-center">
            <span className="mx-auto flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-white/[.08] bg-[#1c1c1c] text-[#8a8a8a]">
              {community.avatar ? <img src={resolveMediaUrl(community.avatar)} alt="" loading="lazy" className="h-full w-full object-cover" /> : channel ? <Hash size={28} /> : <Users size={28} />}
            </span>
            <h1 className="mt-3 flex items-center gap-1.5 text-lg font-semibold">{community.name}{channel ? <Hash size={14} className="shrink-0 text-[#c9a227]" /> : <Users size={14} className="shrink-0 text-[#c9a227]" />}</h1>
            <p className="mt-1 text-xs text-[#8a8a8a]"><span className="font-semibold uppercase tracking-[.14em]">{channel ? 'Channel' : 'Group'}</span>{handle ? ` · ${handle}` : ''}{community._count ? ` · ${countLabel(community._count.members)} members` : ''}</p>
            <p className="mt-3 max-w-md text-sm leading-6 text-[#b8b8b8]">{community.description || community.category || (channel ? 'A public channel on VANTA — join to follow along.' : 'A public group on VANTA — join to take part.')}</p>
            {owner?.username && <p className="mt-3 text-[11px] text-[#666]">Created by @{owner.username}</p>}
          </div>
          <div className="flex items-center gap-2 px-5 py-4">
            {community.joined ? (
              <button type="button" onClick={() => void toggleJoin()} disabled={joining} className="min-h-11 flex-1 rounded-lg border border-white/[.12] text-sm font-semibold text-[#b8b8b8] hover:bg-white/[.04] disabled:opacity-60">{joining ? 'Working…' : 'Leave'}</button>
            ) : (
              <button type="button" onClick={() => void toggleJoin()} disabled={joining} className="min-h-11 flex-1 rounded-lg bg-[#f5f5f5] text-sm font-semibold text-black hover:bg-white disabled:opacity-60">{joining ? 'Joining…' : 'Join'}</button>
            )}
            {community.joined && community.conversationId && (
              <button type="button" onClick={() => router.push(`/messages?conversation=${encodeURIComponent(community.conversationId || '')}`)} className="min-h-11 flex-1 rounded-lg border border-white/[.12] text-sm font-semibold text-[#f5f5f5] hover:bg-white/[.05]"><MessageCircle size={16} className="mr-1.5" />Open in Chat</button>
            )}
            <button type="button" onClick={() => void copyLink()} aria-label="Copy community link" className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/[.08] text-[#8a8a8a] hover:bg-white/[.05] hover:text-white"><Share2 size={17} /></button>
          </div>
        </section>
        <p className="mt-4 text-center text-[11px] text-[#666]">Share this link to invite people to {community.name}.</p>
      </div>
    </main>
  );
}

function countLabel(value: number) {
  const number = Number(value) || 0;
  return number >= 1e6 ? `${(number / 1e6).toFixed(1)}M` : number >= 1e3 ? `${(number / 1e3).toFixed(1)}K` : String(number);
}