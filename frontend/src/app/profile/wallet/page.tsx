'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ProfileWalletRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/balance');
  }, [router]);

  return null;
}