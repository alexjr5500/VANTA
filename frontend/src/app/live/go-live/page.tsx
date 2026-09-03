'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Compatibility route; studio is the single Live capture/publish experience. */
export default function GoLivePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/live/studio');
  }, [router]);

  return <main className="min-h-dvh bg-[#050505]" aria-label="Opening VANTA Live studio" />;
}