'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function BalanceTransactionsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/balance?tab=transactions');
  }, [router]);

  return null;
}