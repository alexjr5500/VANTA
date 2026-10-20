'use client';

import { useAuth } from '@/context/AuthContext';
import Button from '@/components/ui/Button';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';

export function PostHomeButton() {
  const { user } = useAuth();
  const router = useRouter();
  if (!user) return null;
  return (
    <Button variant="gold" onClick={() => router.push('/homes/create')}>
      <Plus size={18} /> Post a Property
    </Button>
  );
}