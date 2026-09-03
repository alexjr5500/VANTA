import Link from 'next/link';
import { ArrowLeft, SearchX } from 'lucide-react';

export default function NotFound() {
  return (
    <main className="profile-state" role="main">
      <SearchX size={30} aria-hidden="true" />
      <h1>Page not found</h1>
      <p>The page may have moved, or the link is no longer available.</p>
      <Link href="/home">
        <ArrowLeft size={15} aria-hidden="true" />
        Back to VANTA
      </Link>
    </main>
  );
}