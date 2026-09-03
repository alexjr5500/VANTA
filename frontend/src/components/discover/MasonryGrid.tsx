'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Heart, MessageCircle, Play } from 'lucide-react';

interface MasonryItem {
  id: string;
  type: 'image' | 'video' | 'post';
  src?: string;
  title?: string;
  likes?: number;
  comments?: number;
  aspectRatio?: number;
}

interface MasonryGridProps {
  items: MasonryItem[];
  loading?: boolean;
  columns?: 2 | 3 | 4;
}

export default function MasonryGrid({ items, loading, columns = 3 }: MasonryGridProps) {
  if (loading) {
    return (
      <div className={cn(
        'grid gap-4',
        columns === 2 && 'grid-cols-2',
        columns === 3 && 'grid-cols-2 ',
        columns === 4 && 'grid-cols-2 ',
      )}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton rounded-2xl" style={{ aspectRatio: i % 3 === 0 ? '3/4' : '1' }} />
        ))}
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <div className={cn(
      'grid gap-3',
      columns === 2 && 'grid-cols-2',
      columns === 3 && 'grid-cols-2 ',
      columns === 4 && 'grid-cols-2 ',
    )}>
      {items.map((item, i) => (
        <motion.div
          key={item.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.03 }}
          className="relative group cursor-pointer rounded-2xl overflow-hidden bg-white/[0.02] border border-white/[0.06] hover:border-[#d6a83f]/20 transition-all duration-300"
          style={{ aspectRatio: item.aspectRatio || (i % 3 === 0 ? 3 / 4 : 1) }}
        >
          {/* Placeholder gradient */}
          <div className="absolute inset-0 bg-gradient-to-br from-[#d6a83f]/5 via-[#c8c8cc]/5 to-[#f5f5f5]/5" />

          {/* Content */}
          <div className="absolute inset-0 flex items-center justify-center">
            {item.type === 'video' && (
              <div className="w-10 h-10 rounded-full bg-white/[0.15] flex items-center justify-center backdrop-blur-sm">
                <Play size={16} className="text-white ml-0.5" />
              </div>
            )}
          </div>

          {/* Overlay on hover */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <div className="absolute bottom-0 left-0 right-0 p-3">
              {item.title && (
                <p className="text-xs font-medium text-white truncate">{item.title}</p>
              )}
              <div className="flex items-center gap-3 mt-1.5">
                {item.likes !== undefined && (
                  <span className="flex items-center gap-1 text-[10px] text-white/80">
                    <Heart size={10} className="fill-white/80" />
                    {item.likes}
                  </span>
                )}
                {item.comments !== undefined && (
                  <span className="flex items-center gap-1 text-[10px] text-white/80">
                    <MessageCircle size={10} />
                    {item.comments}
                  </span>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}