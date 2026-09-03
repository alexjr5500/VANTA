'use client';

import { motion } from 'framer-motion';
import { Users, Music, Gamepad2, MessageCircle } from 'lucide-react';
import UserAvatar from './UserAvatar';
import LiveBadge from './LiveBadge';
import { cn, formatNumber } from '@/lib/utils';

interface CreatorCardProps {
  creator: {
    id: string;
    name: string;
    username: string;
    avatar: string;
    viewers: number;
    category: string;
    isLive: boolean;
  };
  className?: string;
  onClick?: () => void;
}

const categoryIcons: Record<string, React.ReactNode> = {
  Music: <Music size={12} />,
  Gaming: <Gamepad2 size={12} />,
  Chat: <MessageCircle size={12} />,
  Art: <Music size={12} />,
  Tech: <Gamepad2 size={12} />,
};

export default function CreatorCard({ creator, className, onClick }: CreatorCardProps) {
  return (
    <motion.div
      className={cn('flex items-center gap-3 rounded-2xl p-3 cursor-pointer group transition-colors', className)}
      onClick={onClick}
      whileHover={{ x: 4, backgroundColor: 'rgba(255,255,255,0.03)' }}
    >
      <UserAvatar src={creator.avatar} alt={creator.name} size="lg" status={creator.isLive ? 'online' : 'offline'} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-white truncate">{creator.name}</p>
          {creator.isLive && <LiveBadge viewers={creator.viewers} />}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">{creator.username}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="flex items-center gap-1 text-[10px] text-gray-500">
            {categoryIcons[creator.category] || <Users size={12} />}
            {creator.category}
          </span>
          {!creator.isLive && (
            <span className="flex items-center gap-1 text-[10px] text-gray-500">
              <Users size={12} />
              {formatNumber(creator.viewers)}
            </span>
          )}
        </div>
      </div>
      {!creator.isLive && (
        <motion.button
          className="shrink-0 rounded-full border border-white/10 px-3 py-1 text-xs font-medium text-white hover:bg-white/10 transition-colors"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={(e) => { e.stopPropagation(); }}
        >
          Follow
        </motion.button>
      )}
    </motion.div>
  );
}