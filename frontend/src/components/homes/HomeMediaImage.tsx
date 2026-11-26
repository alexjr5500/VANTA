'use client';

import { useState } from 'react';
import { Home } from 'lucide-react';
import { homeImageCandidates, type HomeMediaSource } from '@/lib/homeMedia';

export default function HomeMediaImage({ media, alt, className, thumbnailFirst = false, onReady }: {
  media?: HomeMediaSource | null;
  alt: string;
  className?: string;
  thumbnailFirst?: boolean;
  onReady?: (src: string) => void;
}) {
  const sources = homeImageCandidates(media, thumbnailFirst);
  const [failed, setFailed] = useState<string[]>([]);
  const src = sources.find(url => !failed.includes(url));
  if (!src) return <span className="flex h-full w-full flex-col items-center justify-center gap-1 bg-[var(--surface)] text-[var(--text-secondary)]" role="img" aria-label="Property image unavailable"><Home size={24} strokeWidth={1.5} /><span className="text-[10px]">Photo unavailable</span></span>;
  return <img key={src} src={src} alt={alt} className={className || 'h-full w-full object-cover'} loading={thumbnailFirst ? 'lazy' : 'eager'} onLoad={() => onReady?.(src)} onError={() => setFailed(previous => previous.includes(src) ? previous : [...previous, src])} />;
}
