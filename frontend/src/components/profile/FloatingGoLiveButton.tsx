'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { Radio } from 'lucide-react';

interface FloatingGoLiveButtonProps {
  onClick?: () => void;
}

export default function FloatingGoLiveButton({ onClick }: FloatingGoLiveButtonProps) {
  const router = useRouter();

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      router.push('/live/go-live');
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <motion.button
        onClick={handleClick}
        className="relative w-16 h-16 rounded-full bg-[#f5f5f5] flex items-center justify-center shadow-[0_8px_28px_rgba(0,0,0,0.55)] hover:bg-white transition-colors"
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        aria-label="Go Live"
      >
        {/* Pulse ring */}
        <motion.div
          className="absolute -inset-2 rounded-full bg-white/10"
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.5, 0, 0.5],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />

        {/* Icon */}
        <Radio size={24} className="text-black relative z-10" />

        {/* Label */}
        <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[9px] font-bold text-white/60 uppercase tracking-wider whitespace-nowrap">
          Go Live
        </span>
      </motion.button>
    </div>
  );
}