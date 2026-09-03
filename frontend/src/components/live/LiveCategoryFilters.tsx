'use client';

import React, { useRef } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Radio } from 'lucide-react';

interface Category {
  id: string;
  label: string;
  liveCount?: number;
}

interface LiveCategoryFiltersProps {
  categories?: Category[];
  activeCategory: string;
  onCategoryChange: (id: string) => void;
}

export default function LiveCategoryFilters({
  categories = [],
  activeCategory,
  onCategoryChange,
}: LiveCategoryFiltersProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Only render if we have real categories from the backend
  if (categories.length === 0) return null;

  return (
    <div ref={scrollRef} className="flex overflow-x-auto scrollbar-hide gap-2 pb-2 -mb-2">
      {categories.map((cat, i) => {
        const isActive = activeCategory === cat.id;
        return (
          <motion.button
            key={cat.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.02 }}
            onClick={() => onCategoryChange(cat.id)}
            className={cn(
              'relative shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-2xl border text-sm font-medium transition-all duration-200',
              isActive
                ? 'bg-white/[0.08] border-white/20 text-white'
                : 'bg-white/[0.02] border-white/[0.06] text-gray-400 hover:text-white hover:bg-white/[0.05] hover:border-white/[0.12]'
            )}
          >
            <Radio size={14} className={isActive ? 'text-white' : 'text-white/30'} />
            <span className="whitespace-nowrap">{cat.label}</span>
            {cat.liveCount !== undefined && cat.liveCount > 0 && (
              <span className={cn(
                'text-[10px] font-semibold px-1.5 py-0.5 rounded-full',
                isActive ? 'bg-white/20 text-white' : 'bg-white/[0.04] text-white/30'
              )}>
                {cat.liveCount}
              </span>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}