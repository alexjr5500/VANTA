'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  gradient?: boolean;
  hover?: boolean;
  glow?: boolean;
  padding?: 'sm' | 'md' | 'lg' | 'xl';
  onClick?: () => void;
  as?: 'div' | 'button' | 'article';
}

const paddingMap = {
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5',
  xl: 'p-6',
};

export default function GlassCard({
  children,
  className,
  gradient = false,
  hover = true,
  glow = false,
  padding = 'lg',
  onClick,
  as = 'div',
}: GlassCardProps) {
  const Component = motion[as];
  const baseClasses = cn(
    'rounded-2xl border border-white/[0.06] backdrop-blur-xl transition-all duration-250',
    gradient && 'bg-gradient-to-br from-white/[0.04] to-white/[0.01]',
    !gradient && 'bg-black/40',
    hover && 'hover:border-white/[0.12] hover:bg-white/[0.02]',
    glow && 'shadow-[0_0_30px_rgba(255,0,127,0.08)]',
    onClick && 'cursor-pointer',
    paddingMap[padding],
    className
  );

  return (
    <Component
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className={baseClasses}
      onClick={onClick}
      whileHover={hover ? { y: -2, transition: { duration: 0.2 } } : undefined}
    >
      {children}
    </Component>
  );
}