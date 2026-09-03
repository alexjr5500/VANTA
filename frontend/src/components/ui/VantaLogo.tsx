'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface VantaLogoProps {
  size?: number;
  className?: string;
  variant?: 'white' | 'black' | 'monochrome';
  showText?: boolean;
  textSize?: 'sm' | 'md' | 'lg';
}

const textSizes = { sm: 'text-sm', md: 'text-lg', lg: 'text-2xl' };

export default function VantaLogo({ size = 36, className = '', variant = 'monochrome', showText = false, textSize = 'md' }: VantaLogoProps) {
  const dark = variant === 'black';
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none" role={showText ? undefined : 'img'} aria-hidden={showText}>
        {!showText && <title>VANTA</title>}
        <rect x=".5" y=".5" width="39" height="39" rx="7.5" fill={dark ? '#050505' : '#F5F5F5'} stroke={dark ? '#1C1C1C' : 'rgba(255,255,255,.18)'} />
        <path d="M9.5 10.5 19.9 30 30.5 10.5h-6.1l-4.5 9.8-4.3-9.8H9.5Z" fill={dark ? '#F5F5F5' : '#050505'} />
        <path d="M18 10.5h4l-2.1 4.8L18 10.5Z" fill={dark ? '#8A8A8A' : '#B8B8B8'} />
      </svg>
      {showText && <span className={cn('font-semibold tracking-[0.2em]', textSizes[textSize], dark ? 'text-black' : 'text-white')}>VANTA</span>}
    </span>
  );
}

export function VantaWordmark({ size = 'md', className, variant = 'white' }: { size?: 'sm' | 'md' | 'lg'; className?: string; variant?: 'white' | 'black' }) {
  const iconSize = size === 'sm' ? 28 : size === 'lg' ? 36 : 32;
  const textClass = size === 'sm' ? 'text-lg' : size === 'lg' ? 'text-3xl' : 'text-2xl';
  return <span className={cn('inline-flex items-center gap-2.5', className)}><VantaLogo size={iconSize} variant={variant} /><span className={cn('font-semibold tracking-[0.18em]', textClass, variant === 'black' ? 'text-black' : 'text-white')}>VANTA</span></span>;
}

export function VantaNavbarLogo({ className }: { className?: string }) {
  return <VantaWordmark size="sm" className={className} />;
}