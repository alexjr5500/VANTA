'use client';

import { motion } from 'framer-motion';
import { cn, getInitials } from '@/lib/utils';
import { resolveMediaUrl } from '@/lib/mediaUrl';

interface UserAvatarProps {
  src?: string | null;
  alt?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  status?: 'online' | 'offline' | 'idle' | null;
  premium?: boolean;
  className?: string;
  story?: boolean;
  viewed?: boolean;
  onClick?: () => void;
}

const sizeMap = {
  xs: 'w-6 h-6 text-[9px]',
  sm: 'w-8 h-8 text-[10px]',
  md: 'w-10 h-10 text-xs',
  lg: 'w-12 h-12 text-sm',
  xl: 'w-16 h-16 text-lg',
  '2xl': 'w-20 h-20 text-xl',
};

const statusSizeMap = {
  xs: 'w-1.5 h-1.5 border',
  sm: 'w-2 h-2 border',
  md: 'w-2.5 h-2.5 border-[1.5px]',
  lg: 'w-3 h-3 border-[1.5px]',
  xl: 'w-3.5 h-3.5 border-2',
  '2xl': 'w-4 h-4 border-2',
};

export default function UserAvatar({
  src,
  alt = '',
  size = 'md',
  status = null,
  premium = false,
  className,
  story = false,
  viewed = false,
  onClick,
}: UserAvatarProps) {
  const initials = getInitials(alt || '?');

  return (
    <motion.div
      className={cn('relative inline-flex shrink-0', onClick && 'cursor-pointer', className)}
      onClick={onClick}
      whileHover={onClick ? { scale: 1.05 } : undefined}
      whileTap={onClick ? { scale: 0.95 } : undefined}
    >
      {story && (
        <div
          className={cn(
            'absolute -inset-[2px] rounded-full',
            viewed
              ? 'bg-gradient-to-br from-gray-500/30 to-gray-600/30'
              : 'bg-gradient-to-br from-[#d6a83f] via-[#c8c8cc] to-[#c8c8cc]'
          )}
        >
          <div className="absolute inset-[2px] rounded-full bg-[#0a0a0f]" />
        </div>
      )}

      <div
        className={cn(
          'relative overflow-hidden rounded-full flex items-center justify-center font-bold text-white',
          sizeMap[size],
          story && 'm-[3px]',
          !src && 'bg-gradient-to-br from-[#d6a83f] to-[#c8c8cc]'
        )}
      >
        {src ? (
          <img src={resolveMediaUrl(src)} alt={alt} className="h-full w-full object-cover" />
        ) : (
          <span>{initials}</span>
        )}

        {premium && (
          <div className="absolute inset-0 rounded-full bg-gradient-to-t from-yellow-400/10 to-transparent pointer-events-none" />
        )}
      </div>

      {premium && (
        <div className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center w-3.5 h-3.5 rounded-full bg-gradient-to-br from-yellow-400 to-yellow-600 shadow-lg shadow-yellow-500/30">
          <span className="text-[6px]">✦</span>
        </div>
      )}

      {status && (
        <span
          className={cn(
            'absolute bottom-0 right-0 rounded-full border-[#0a0a0f]',
            statusSizeMap[size],
            status === 'online' && 'bg-emerald-500',
            status === 'offline' && 'bg-gray-500',
            status === 'idle' && 'bg-amber-500'
          )}
        />
      )}
    </motion.div>
  );
}