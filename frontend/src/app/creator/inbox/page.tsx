"use client";

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { MessageCircle, Hash, Users, AlertCircle, RefreshCw, ArrowUpRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/apiClient';
import Avatar from '@/components/ui/Avatar';

// ============================================================================
// CREATOR INBOX — real direct-message conversations from the /api/messages
// backend, linking into the full VANTA Messages experience.
// ============================================================================

interface Conversation {
  id: string;
  type: string;
  isGroup: boolean;
  name?: string | null;
  avatar?: string | null;
  unreadCount: number;
  updatedAt: string;
  partner?: { id: string; username: string; avatar?: string | null; verified?: boolean } | null;
  lastMessage?: { content?: string | null; senderId?: string; createdAt?: string } | null;
  memberCount?: number;
}

const timeAgo = (iso?: string) => {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return days < 7 ? `${days}d` : new Date(iso).toLocaleDateString();
};

export default function InboxPage() {
  const { token } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ conversations: Conversation[] }>('/api/messages?limit=25', token, { skipCache: true });
      setConversations(Array.isArray(res?.conversations) ? res.conversations : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load your inbox.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="w-full space-y-3">
        <div className="skeleton h-12 w-48 rounded-2xl" />
        {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-20 rounded-2xl" />)}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex w-full flex-col items-center py-14 text-center">
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-red-500/20 bg-red-500/10">
          <AlertCircle size={22} className="text-red-400" />
        </div>
        <h2 className="text-base font-semibold text-white/80">Couldn&apos;t load your inbox</h2>
        <p className="mt-1 mb-5 max-w-sm text-sm text-white/40">{error}</p>
        <button onClick={() => void fetchData()} className="btn-primary text-sm"><RefreshCw size={14} className="mr-1.5 inline" /> Try again</button>
      </div>
    );
  }

  const unreadTotal = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full space-y-4 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-white">Inbox</h2>
          <p className="mt-0.5 text-[11px] text-white/40">{unreadTotal > 0 ? `${unreadTotal} unread across ${conversations.length} conversations` : `${conversations.length} conversations`}</p>
        </div>
        <Link href="/messages" className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--active)] px-4 py-2 text-xs font-semibold text-black hover:opacity-90">
          Open Messages <ArrowUpRight size={13} />
        </Link>
      </div>

      {conversations.length === 0 ? (
        <section className="rounded-3xl border border-white/[0.06] bg-white/[0.02] p-10 text-center">
          <MessageCircle size={28} className="mx-auto mb-3 text-white/15" />
          <p className="text-sm text-white/50">No conversations yet</p>
          <p className="mx-auto mt-1 max-w-xs text-xs text-white/30">Messages from followers and collaborators will appear here.</p>
          <Link href="/messages" className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[var(--active)] px-4 py-2 text-xs font-semibold text-black hover:opacity-90">
            Start a conversation <ArrowUpRight size={13} />
          </Link>
        </section>
      ) : (
        <div className="space-y-1.5">
          {conversations.map((c) => {
            const displayName = c.type === 'DIRECT' ? c.partner?.username : c.name;
            const isGroup = c.type === 'GROUP' || c.isGroup;
            return (
              <Link
                key={c.id}
                href="/messages"
                className="flex items-center gap-3 rounded-2xl border border-white/[0.05] bg-white/[0.02] px-4 py-3 transition-colors hover:border-white/[0.12] hover:bg-white/[0.04]"
              >
                {c.type === 'DIRECT' && c.partner ? (
                  <Avatar src={c.partner.avatar} alt={c.partner.username} size="md" fallback={c.partner.username?.charAt(0)} wrapperClassName="shrink-0" />
                ) : (
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/[0.05] text-white/50">
                    {isGroup ? <Users size={16} /> : <Hash size={16} />}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-white">@{displayName || 'Chat'}</p>
                    <span className="shrink-0 text-[10px] text-white/35">{timeAgo(c.updatedAt)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs text-white/45">{c.lastMessage?.content || (isGroup ? `${c.memberCount || 0} members` : 'No messages yet')}</p>
                    {c.unreadCount > 0 && (
                      <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-[#c9a227] px-1.5 text-[10px] font-bold text-black">{c.unreadCount}</span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
