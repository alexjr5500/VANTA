'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Play, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import Avatar from '@/components/ui/Avatar';

interface HeroSlide {
  id: string;
  type: 'live' | 'trending' | 'community' | 'event' | 'exclusive';
  title: string;
  description: string;
  coverImage?: string;
  creatorName: string;
  creatorAvatar?: string;
  category: string;
  viewerCount?: number;
  gradient: string;
}

interface DiscoverHeroProps {
  slides?: HeroSlide[];
}

export default function DiscoverHero({ slides = [] }: DiscoverHeroProps) {
  const [current, setCurrent] = useState(0);
  const [direction, setDirection] = useState(0);

  // Don't render anything if no real slides
  if (!slides || slides.length === 0) {
    return null;
  }

  useEffect(() => {
    if (slides.length <= 1) return;
    const timer = setInterval(() => {
      setDirection(1);
      setCurrent(prev => (prev + 1) % slides.length);
    }, 6000);
    return () => clearInterval(timer);
  }, [slides.length]);

  const navigate = (newDirection: number) => {
    setDirection(newDirection);
    setCurrent(prev => {
      const next = prev + newDirection;
      if (next < 0) return slides.length - 1;
      if (next >= slides.length) return 0;
      return next;
    });
  };

  const slide = slides[current];

  const variants = {
    enter: (dir: number) => ({ x: dir > 0 ? 300 : -300, opacity: 0, scale: 0.95 }),
    center: { x: 0, opacity: 1, scale: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? -300 : 300, opacity: 0, scale: 0.95 }),
  };

  return (
    <div className="relative overflow-hidden rounded-3xl">
      <div className="relative aspect-[21/9] min-h-[300px]  ">
        <AnimatePresence initial={false} custom={direction} mode="popLayout">
          <motion.div
            key={current}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-0 rounded-3xl overflow-hidden"
          >
            <div className={cn('absolute inset-0 bg-gradient-to-br', slide.gradient)} />
            <div className="absolute inset-0 bg-[#0a0a0f]/60" />
            <div className="absolute inset-0 opacity-[0.03]" style={{
              backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
              backgroundSize: '60px 60px',
            }} />

            <div className="absolute inset-0 flex flex-col justify-end p-6  ">
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mb-3">
                <span className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider',
                  slide.type === 'live' && 'bg-red-500/20 text-red-400 border border-red-500/20',
                  slide.type === 'trending' && 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20',
                  slide.type === 'exclusive' && 'bg-amber-500/20 text-amber-400 border border-amber-500/20',
                )}>
                  {slide.type === 'live' && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />}
                  {slide.type === 'live' ? 'LIVE' : slide.type === 'exclusive' ? 'Exclusive' : 'Featured'}
                </span>
              </motion.div>

              <motion.h2 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
                className="text-2xl    font-bold text-white max-w-2xl leading-tight tracking-tight">
                {slide.title}
              </motion.h2>

              <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
                className="text-sm  text-white/60 mt-2 max-w-xl leading-relaxed">
                {slide.description}
              </motion.p>

              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
                className="flex flex-wrap items-center gap-4 mt-4">
                {slide.creatorName && (
                  <div className="flex items-center gap-2">
                    <Avatar src={slide.creatorAvatar} alt={slide.creatorName} size="sm" />
                    <span className="text-sm text-white/70 font-medium">{slide.creatorName}</span>
                  </div>
                )}
                {slide.category && (
                  <span className="text-xs text-white/50 px-2.5 py-1 rounded-full bg-white/[0.06]">{slide.category}</span>
                )}
                {slide.viewerCount && (
                  <span className="flex items-center gap-1 text-xs text-white/50">
                    <Eye size={12} />
                    {slide.viewerCount.toLocaleString()} watching
                  </span>
                )}
              </motion.div>

              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="mt-5">
                <button className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-[#d6a83f] to-[#c8c8cc] text-white text-sm font-bold hover:shadow-xl hover:shadow-[#d6a83f]/25 transition-all">
                  <Play size={16} fill="white" />
                  {slide.type === 'live' ? 'Join Stream' : 'Explore'}
                </button>
              </motion.div>
            </div>
          </motion.div>
        </AnimatePresence>

        {slides.length > 1 && (
          <>
            <button onClick={() => navigate(-1)}
              className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm border border-white/[0.08] flex items-center justify-center text-white/70 hover:text-white hover:bg-black/70 transition-all z-10"
              aria-label="Previous slide">
              <ChevronLeft size={18} />
            </button>
            <button onClick={() => navigate(1)}
              className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 backdrop-blur-sm border border-white/[0.08] flex items-center justify-center text-white/70 hover:text-white hover:bg-black/70 transition-all z-10"
              aria-label="Next slide">
              <ChevronRight size={18} />
            </button>
            <div className="absolute bottom-4 right-6 flex items-center gap-2 z-10">
              {slides.map((_, i) => (
                <button key={i} onClick={() => { setDirection(i > current ? 1 : -1); setCurrent(i); }}
                  className={cn('rounded-full transition-all duration-300',
                    i === current ? 'w-8 h-2 bg-gradient-to-r from-[#d6a83f] to-[#c8c8cc]' : 'w-2 h-2 bg-white/20 hover:bg-white/40'
                  )} aria-label={`Go to slide ${i + 1}`} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}