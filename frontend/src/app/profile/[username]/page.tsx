'use client';

import { useParams } from 'next/navigation';
import CreatorHubPage from '@/components/profile/v2/CreatorHubPage';

export default function UserProfilePage() {
  const params = useParams();
  const username = params?.username as string;
  
  return <CreatorHubPage username={username} />;
}