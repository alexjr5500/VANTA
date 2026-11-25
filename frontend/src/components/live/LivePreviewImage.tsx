'use client';

import { useState } from 'react';
import { Radio } from 'lucide-react';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import Avatar from '@/components/ui/Avatar';

/** Real uploaded live cover; honest creator fallback if no frame is available. */
export default function LivePreviewImage({ thumbnail, avatar, name }: { thumbnail?: string | null; avatar?: string | null; name: string }) {
  const src = resolveMediaUrl(thumbnail || '');
  const [failed, setFailed] = useState('');
  if (src && failed !== src) return <img src={src} alt="Live stream cover" loading="lazy" onError={() => setFailed(src)} className="h-full w-full object-cover" />;
  return <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-[var(--surface)] text-[var(--text-secondary)]">
    <Avatar src={avatar} alt={name} size="md" />
    <span className="flex items-center gap-1 text-[10px]"><Radio size={12} /> Preview unavailable</span>
  </span>;
}
