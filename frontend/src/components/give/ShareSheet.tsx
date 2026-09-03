'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Check, Clapperboard, Flame, Link2, MessageCircle, Users } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import type { Fundraiser } from '@/types/fundraiser';
import { apiPost } from '@/lib/apiClient';

interface ShareSheetProps {
  fundraiser: Fundraiser;
  open: boolean;
  onClose: () => void;
}

interface ShareDestination {
  id: string;
  label: string;
  description: string;
  icon: any;
  needsAuth: boolean;
}

const DESTINATIONS: ShareDestination[] = [
  { id: 'COPY_LINK', label: 'Copy link', description: 'Share anywhere', icon: Link2, needsAuth: false },
  { id: 'MESSAGE', label: 'Send in Chat', description: 'Share with a friend', icon: MessageCircle, needsAuth: true },
  { id: 'POST', label: 'Share to Post', description: 'Publish on your profile', icon: Users, needsAuth: true },
  { id: 'REEL', label: 'Share to Reels', description: 'Create a video post', icon: Clapperboard, needsAuth: true },
  { id: 'STORY', label: 'Share to Story', description: 'Moment visible for 24h', icon: Flame, needsAuth: true },
];

export default function ShareSheet({ fundraiser, open, onClose }: ShareSheetProps) {
  const router = useRouter();
  const toast = useToast();
  const { token } = useAuth();
  const [destination, setDestination] = useState<string | null>(null);
  const [error, setError] = useState('');
  const url = typeof window !== 'undefined' ? `${window.location.origin}/give/${fundraiser.slug}` : '';

  const close = () => {
    setDestination(null);
    setError('');
    onClose();
  };

  const handleShare = async (id: string) => {
    if (id === 'COPY_LINK') {
      try {
        await navigator.clipboard.writeText(url);
        toast.success('Fundraiser link copied');
      } catch {
        setError('Unable to copy the link. Your browser blocked clipboard access.');
      }
      close();
      return;
    }

    if (!token) {
      router.push(`/login?next=${encodeURIComponent(`/give/${fundraiser.slug}`)}`);
      return;
    }

    setDestination(id);
    setError('');
    try {
      if (id === 'MESSAGE') {
        await apiPost(`/api/fundraisers/${fundraiser.id}/share`, { destination: id }, token).catch(() => null);
        router.push(`/chat?share=${encodeURIComponent(url)}`);
        close();
        return;
      }
      // Tracking + platform navigation for POST/REEL/STORY.
      await apiPost(`/api/fundraisers/${fundraiser.id}/share`, { destination: id }, token).catch(() => null);
      if (id === 'POST') router.push('/home?composer=post');
      if (id === 'REEL') router.push('/home?composer=reel');
      if (id === 'STORY') router.push('/home?composer=story');
      close();
      toast.success('Opening share composer…');
    } catch (reason: any) {
      setError(reason?.message || 'Share failed. Please try again.');
      setDestination(null);
    }
  };

  return (
    <Modal open={open} onClose={close} size="md" title="Share fundraiser" description={fundraiser.title}>
      <div className="space-y-2">
        {DESTINATIONS.map((item) => {
          const Icon = item.icon;
          const active = destination === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleShare(item.id)}
              disabled={active}
              className={cn(
                'group flex min-h-[64px] w-full items-center gap-4 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5 text-left transition',
                'hover:border-white/[0.16] hover:bg-white/[0.055] active:scale-[.99]',
                active && 'pointer-events-none opacity-60'
              )}
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-[#b8b8b8] transition group-hover:border-white/[0.16] group-hover:text-white">
                {active ? <Check size={18} className="text-[var(--vanta-gold-bright)]" /> : <Icon size={18} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">{item.label}</p>
                <p className="text-xs text-white/45">{item.description}</p>
              </div>
              {item.needsAuth && <span className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[10px] text-white/35">VANTA</span>}
            </button>
          );
        })}

        {error && (
          <p className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-300" role="alert">
            <AlertCircle size={14} className="shrink-0" />
            {error}
          </p>
        )}
      </div>

      <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.015] px-3.5 py-3">
        <p className="text-[11px] uppercase tracking-wide text-white/35">Campaign link</p>
        <p className="mt-1 truncate text-sm text-white/60">{url}</p>
      </div>

      <Button variant="ghost" fullWidth className="mt-4" onClick={close}>
        Cancel
      </Button>
    </Modal>
  );
}