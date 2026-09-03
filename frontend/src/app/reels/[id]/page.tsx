'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Clapperboard, Loader2, Play } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import { apiGet } from '@/lib/apiClient';
import { useAuth } from '@/context/AuthContext';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import VerificationBadge from '@/components/ui/VerificationBadge';

type Reel = {
  id: string;
  title?: string;
  description?: string;
  videoUrl: string;
  thumbnailUrl?: string;
  views?: number;
  creator: { id: string; username: string; fullName?: string; avatar?: string; verified?: boolean };
};

export default function ReelDetailPage({ params }: { params: { id: string } }) {
  const { token } = useAuth();
  const [reel, setReel] = useState<Reel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void apiGet<Reel>(`/api/reels/${encodeURIComponent(params.id)}`, token || undefined, { skipCache: true })
      .then(result => { if (!cancelled) setReel(result); })
      .catch(reason => { if (!cancelled) setError(reason?.message || 'This Reel is unavailable.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params.id, token]);

  if (loading) return <State title="Loading Reel" loading />;
  if (error || !reel) return <State title="Reel unavailable" copy="This Reel may have been deleted or is no longer available." />;

  // Resolve through the shared helper so localhost-authored upload URLs are
  // remapped to the API origin this client uses (critical for mobile/LAN),
  // matching the Reels feed behaviour exactly.
  const videoSrc = resolveMediaUrl(reel.videoUrl);
  const posterSrc = resolveMediaUrl(reel.thumbnailUrl);

  return (
    <main className="min-h-[100dvh] w-full bg-[#050505] px-4 py-5 text-white">
      <div className="mx-auto w-full min-w-0">
        <Link href="/reels" className="mb-5 inline-flex items-center gap-2 text-sm text-white/65 hover:text-white"><ArrowLeft size={17} />Back to Reels</Link>
        <div className="grid gap-4">
          <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black shadow-2xl">
            <video src={videoSrc} poster={posterSrc || undefined} controls autoPlay muted loop playsInline preload="metadata" className="max-h-[78dvh] w-full object-contain" aria-label={`Reel by ${reel.creator.username}`} />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/75 to-transparent" />
          </div>
          <section className="rounded-xl border border-white/10 bg-white/[.03] p-5">
            <Link href={`/profile/${reel.creator.username}`} className="flex items-center gap-3 hover:text-white/80">
              <Avatar src={reel.creator.avatar} alt={reel.creator.username} size="md" />
              <span><strong className="block">{reel.creator.fullName || reel.creator.username}{reel.creator.verified && <VerificationBadge verified size="sm" className="ml-1.5 inline align-[-2px]" />}</strong><small className="text-white/50">@{reel.creator.username}</small></span>
            </Link>
            <h1 className="mt-6 text-xl font-semibold">{reel.title || 'VANTA Reel'}</h1>
            {reel.description && <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-white/65">{reel.description}</p>}
            {typeof reel.views === 'number' && <p className="mt-5 text-xs uppercase tracking-wider text-white/35">{reel.views.toLocaleString()} views</p>}
          </section>
        </div>
      </div>
    </main>
  );
}

function State({ title, copy, loading = false }: { title: string; copy?: string; loading?: boolean }) {
  return <div className="grid min-h-[100dvh] place-items-center bg-[#050505] px-6 text-center text-white"><div>{loading ? <Loader2 className="mx-auto mb-5 animate-spin text-white/50" size={38} /> : <Clapperboard className="mx-auto mb-5 text-white/30" size={42} />}<h1 className="text-2xl font-semibold">{title}</h1>{copy && <p className="mt-2 text-sm text-white/50">{copy}</p>}<Link href="/reels" className="mt-6 inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-sm text-white/75"><Play size={14} />Open Reels</Link></div></div>;
}