'use client';

import { AlertCircle, RotateCw } from 'lucide-react';
import '@/components/profile/v2/creator-hub.css';

export default function ProfileError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="profile-state" role="alert">
      <AlertCircle size={28} />
      <h1>Unable to load profile</h1>
      <p>Something went wrong while rendering this profile.</p>
      <button type="button" onClick={reset}><RotateCw size={15} />Try again</button>
    </main>
  );
}