'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Pin, BellOff, Check, CheckCheck, MessageCircle, Archive, MoreHorizontal, Loader2, Users, Hash } from 'lucide-react';
import { cn } from '@/lib/utils';
import Avatar from '@/components/ui/Avatar';
import VerificationBadge from '@/components/ui/VerificationBadge';

interface Conversation {
  id: string;
  type: 'private' | 'group' | 'channel';
  name: string;
  username?: string;
  avatar?: string;
  lastMessage?: {
    content: string;
    timestamp: string;
    sender?: string;
    isRead?: boolean;
    isDelivered?: boolean;
  };
  unread?: number;
  isOnline?: boolean;
  verified?: boolean;
  isPinned?: boolean;
  isMuted?: boolean;
  isTyping?: boolean;
  isArchived?: boolean;
  participants?: { avatar?: string; name: string }[];
}

interface ConversationListProps {
  conversations: Conversation[];
  activeId?: string;
  onSelect: (id: string) => void;
  loading?: boolean;
}

export default function ConversationList({ conversations, activeId, onSelect, loading }: ConversationListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const filtered = conversations.filter(c => {
    if (showArchived !== !!c.isArchived) return false;
    if (!searchQuery) return true;
    return c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
           c.username?.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const pinned = filtered.filter(c => c.isPinned);
  const normal = filtered.filter(c => !c.isPinned);

  const timeAgo = (timestamp: string) => {
    const now = new Date();
    const date = new Date(timestamp);
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="space-y-2 p-4">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="flex items-center gap-3 p-3">
            <div className="skeleton w-10 h-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-4 w-24" />
              <div className="skeleton h-3 w-32" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-3">
        <div className="relative">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search chats..."
            className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] py-2.5 pl-10 pr-4 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-white/20 focus:bg-white/[0.06] transition-all"
          />
        </div>
      </div>

      {/* Archive Toggle */}
      <button
        onClick={() => setShowArchived(!showArchived)}
        className="flex items-center gap-2 px-4 py-2 mx-3 rounded-xl text-xs text-gray-400 hover:text-white hover:bg-white/[0.03] transition-all"
      >
        <Archive size={14} />
        {showArchived ? 'Show Active' : `Archived (${conversations.filter(c => c.isArchived).length})`}
      </button>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto scrollbar-hide px-2 py-1 space-y-0.5">
        {/* Pinned */}
        {pinned.length > 0 && (
          <>
            <div className="px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-gray-600 font-semibold">Pinned</div>
            {pinned.map(conv => (
              <ConversationItem key={conv.id} conv={conv} isActive={conv.id === activeId} onSelect={onSelect} timeAgo={timeAgo} />
            ))}
            <div className="h-2" />
          </>
        )}

        {/* All Conversations */}
        {normal.length === 0 && !searchQuery ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <MessageCircle size={28} className="text-white/10 mb-3" />
            <p className="text-sm text-white/30">No conversations yet</p>
            <p className="text-xs text-white/20 mt-1">Tap the + button to start chatting</p>
          </div>
        ) : normal.length === 0 && searchQuery ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <Search size={28} className="text-white/10 mb-3" />
            <p className="text-sm text-white/30">No results found</p>
          </div>
        ) : (
          normal.map(conv => (
            <ConversationItem key={conv.id} conv={conv} isActive={conv.id === activeId} onSelect={onSelect} timeAgo={timeAgo} />
          ))
        )}
      </div>
    </div>
  );
}

function ConversationItem({ conv, isActive, onSelect, timeAgo }: {
  conv: Conversation;
  isActive: boolean;
  onSelect: (id: string) => void;
  timeAgo: (t: string) => string;
}) {
  return (
    <motion.button
      layout
      onClick={() => onSelect(conv.id)}
      className={cn(
        'w-full flex items-center gap-3 p-3 rounded-2xl transition-all duration-200 text-left',
        isActive
          ? 'bg-white/[0.07] border border-white/[0.12]'
          : 'hover:bg-white/[0.03] border border-transparent'
      )}
    >
      {/* Avatar */}
      <div className="relative shrink-0">
        {conv.type === 'private' ? (
          <Avatar src={conv.avatar} alt={conv.name} size="md" />
        ) : (
          <div className="w-10 h-10 rounded-full border border-white/[0.08] bg-[#161616] flex items-center justify-center text-white/50">
            {conv.type === 'group' ? <Users size={15} /> : <Hash size={15} />}
          </div>
        )}
        {conv.isOnline && (
          <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-[#0a0a0f]" />
        )}
        {conv.verified && (
          <span className="absolute -top-1.5 -right-1.5">
            <VerificationBadge verified size="xs" />
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {conv.isPinned && <Pin size={10} className="text-gray-600 shrink-0" />}
            <span className="text-sm font-semibold text-white truncate">{conv.name}</span>
            {conv.type !== 'private' && (
              <span className="text-[9px] text-white/30 shrink-0">
                {conv.type === 'group' ? `· ${conv.participants?.length || 0} members` : '· Channel'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {conv.isMuted && <BellOff size={10} className="text-gray-600" />}
            {conv.lastMessage && (
              <span className="text-[10px] text-gray-500">{timeAgo(conv.lastMessage.timestamp)}</span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between mt-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            {/* Status Icons */}
            {conv.lastMessage?.isRead && (
              <CheckCheck size={12} className="text-white/70 shrink-0" />
            )}
            {conv.lastMessage?.isDelivered && !conv.lastMessage?.isRead && (
              <CheckCheck size={12} className="text-gray-600 shrink-0" />
            )}
            {!conv.lastMessage?.isDelivered && conv.lastMessage && (
              <Check size={12} className="text-gray-600 shrink-0" />
            )}

            {/* Typing Indicator */}
            {conv.isTyping ? (
              <span className="text-xs text-white/60 italic truncate">typing...</span>
            ) : (
              <span className="text-xs text-white/40 truncate">
                {conv.lastMessage?.content || 'No chats yet'}
              </span>
            )}
          </div>

          {/* Unread Badge */}
          {conv.unread && conv.unread > 0 ? (
            <span className="shrink-0 min-w-[18px] h-[18px] rounded-full bg-[#f5f5f5] flex items-center justify-center text-[9px] font-bold text-black px-1">
              {conv.unread > 99 ? '99+' : conv.unread}
            </span>
          ) : null}
        </div>
      </div>
    </motion.button>
  );
}