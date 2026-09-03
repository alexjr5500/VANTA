'use client';

import React, { useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Check, CheckCheck, Pin, Trash2, Edit3, Copy, Forward, MoreHorizontal, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import Avatar from '@/components/ui/Avatar';

interface Message {
  id: string;
  content: string;
  sender: { id: string; name: string; avatar?: string };
  timestamp: string;
  isOwn?: boolean;
  isRead?: boolean;
  isDelivered?: boolean;
  type?: 'text' | 'image' | 'voice' | 'file';
  replyTo?: { id: string; content: string; sender: string };
}

interface ChatMessagesProps {
  messages: Message[];
  currentUserId: string;
  onLoadMore?: () => void;
  hasMore?: boolean;
}

export default function ChatMessages({ messages, currentUserId, onLoadMore, hasMore }: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const groupByDate = (msgs: Message[]) => {
    const groups: { date: string; messages: Message[] }[] = [];
    msgs.forEach(msg => {
      const date = new Date(msg.timestamp).toLocaleDateString();
      const last = groups[groups.length - 1];
      if (last && last.date === date) {
        last.messages.push(msg);
      } else {
        groups.push({ date, messages: [msg] });
      }
    });
    return groups;
  };

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-16 px-4 text-center">
        <div className="w-16 h-16 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-4">
          <MessageCircle size={24} className="text-white/20" />
        </div>
        <h3 className="text-white/50 font-medium text-base mb-1">No chats yet</h3>
        <p className="text-white/25 text-sm max-w-xs">Start the conversation</p>
      </div>
    );
  }

  const grouped = groupByDate(messages);

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto scrollbar-hide p-4 space-y-4">
      {hasMore && (
        <div className="flex justify-center">
          <button
            onClick={onLoadMore}
            className="text-xs text-white/30 hover:text-white transition-colors px-4 py-2 rounded-xl bg-white/[0.03]"
          >
            Load older messages
          </button>
        </div>
      )}

      {grouped.map((group, gi) => (
        <div key={gi}>
          {/* Date Separator */}
          <div className="flex items-center justify-center mb-4">
            <div className="px-3 py-1 rounded-full bg-white/[0.04] text-[10px] text-white/30">
              {group.date === new Date().toLocaleDateString() ? 'Today' :
               group.date === new Date(Date.now() - 86400000).toLocaleDateString() ? 'Yesterday' :
               group.date}
            </div>
          </div>

          {/* Messages */}
          <div className="space-y-1.5">
            {group.messages.map((msg, mi) => {
              const isOwn = msg.sender.id === currentUserId;
              const showAvatar = mi === 0 || group.messages[mi - 1]?.sender.id !== msg.sender.id;

              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className={cn(
                    'flex items-end gap-2 group',
                    isOwn ? 'flex-row-reverse' : 'flex-row'
                  )}
                >
                  {/* Avatar */}
                  {showAvatar ? (
                    <div className="shrink-0 mb-1">
                      <Avatar src={msg.sender.avatar} alt={msg.sender.name} size="xs" />
                    </div>
                  ) : (
                    <div className="w-6 shrink-0" />
                  )}

                  {/* Message Bubble */}
                  <div className={cn(
                    'max-w-[70%] relative',
                    isOwn ? 'items-end' : 'items-start'
                  )}>
                    {/* Sender Name (for group chats) */}
                    {showAvatar && !isOwn && (
                      <p className="text-[10px] text-white/30 mb-1 ml-1">{msg.sender.name}</p>
                    )}

                    {/* Reply Indicator */}
                    {msg.replyTo && (
                      <div className={cn(
                        'mb-1 px-3 py-1.5 rounded-xl border-l-2 text-xs',
                        'border-white/30 bg-white/[0.03]'
                      )}>
                        <p className="text-[10px] text-white/30">{msg.replyTo.sender}</p>
                        <p className="text-xs text-white/40 truncate max-w-[200px]">{msg.replyTo.content}</p>
                      </div>
                    )}

                    {/* Bubble */}
                    <div className={cn(
                      'px-4 py-2.5 rounded-2xl text-sm leading-relaxed',
                      isOwn
                        ? 'bg-[#202020] border border-white/[0.12] text-white rounded-br-md'
                        : 'bg-white/[0.04] border border-white/[0.06] text-white/80 rounded-bl-md'
                    )}>
                      {msg.content}
                    </div>

                    {/* Time & Status */}
                    <div className={cn(
                      'flex items-center gap-1 mt-0.5',
                      isOwn ? 'justify-end' : 'justify-start'
                    )}>
                      <span className="text-[9px] text-white/20">{formatTime(msg.timestamp)}</span>
                      {isOwn && (
                        msg.isRead ? (
                          <CheckCheck size={11} className="text-white/70" />
                        ) : msg.isDelivered ? (
                          <CheckCheck size={11} className="text-white/20" />
                        ) : (
                          <Check size={11} className="text-white/20" />
                        )
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}