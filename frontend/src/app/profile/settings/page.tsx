'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Accessibility, ArrowLeft, Bell, ChevronRight, CircleEllipsis, Database, Globe, LockKeyhole, MessageCircle, Mic, Newspaper, Search, ShieldCheck, SlidersHorizontal, User, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/apiClient';
import { useLocalizedUiText } from '@/lib/i18n/useLocalizedUiText';
import { useScrollRestore } from '@/components/settings/SettingsUI';

const categories = [
  { title: 'Account', href: '/settings/account', icon: User },
  { title: 'Security and access', href: '/settings/security', icon: LockKeyhole },
  { title: 'Privacy and safety', href: '/settings/privacy', icon: ShieldCheck },
  { title: 'Notifications', href: '/settings/notifications', icon: Bell },
  { title: 'Timeline', href: '/settings/content', icon: Newspaper },
  { title: 'Chat', href: '/settings/chat', icon: MessageCircle },
  { title: 'Explore', href: '/settings/explore', icon: Search },
  { title: 'Spaces', href: '/settings/spaces', icon: Mic },
  { title: 'Accessibility', href: '/settings/accessibility', icon: Accessibility },
  { title: 'Appearance', href: '/settings/appearance', icon: SlidersHorizontal },
  { title: 'Languages', href: '/settings/language', icon: Globe },
  { title: 'Storage and Data', href: '/settings/storage', icon: Database },
  { title: 'Additional resources', href: '/settings/about', icon: CircleEllipsis },
];

const searchable = [
  { title: 'Edit profile', href: '/profile/editprofile', icon: User },
  { title: 'Username and account information', href: '/settings/account', icon: User },
  { title: 'Payments and wallet security', href: '/settings/payments', icon: LockKeyhole },
  { title: 'Verified Badge', href: '/verification/badge', icon: ShieldCheck },
  { title: 'Change password, email and two-factor authentication', href: '/settings/security', icon: LockKeyhole },
  { title: 'Active sessions and login activity', href: '/settings/security', icon: LockKeyhole },
  { title: 'Blocked and muted accounts', href: '/settings/privacy', icon: ShieldCheck },
  { title: 'Account privacy, messaging, follows and read receipts', href: '/settings/privacy', icon: ShieldCheck },
  { title: 'Mentions, calls and discoverability', href: '/settings/privacy/audience', icon: ShieldCheck },
  { title: 'Data sharing and consent', href: '/privacy-center?tab=consent', icon: ShieldCheck },
  { title: 'Notification filters and accounts you follow', href: '/settings/notifications', icon: Bell },
  { title: 'Push and email notifications', href: '/settings/notifications', icon: Bell },
  { title: 'Chat notifications, message previews and typing indicators', href: '/settings/chat', icon: MessageCircle },
  { title: 'Voice message playback', href: '/settings/chat', icon: Mic },
  { title: 'Autoplay, media quality and sensitive content', href: '/settings/content', icon: Newspaper },
  { title: 'Data usage', href: '/settings/content', icon: Database },
  { title: 'Clear cache', href: '/settings/device', icon: Database },
  { title: 'High contrast, font size and reduced motion', href: '/settings/accessibility', icon: Accessibility },
  { title: 'Accent color and reading layout', href: '/settings/appearance', icon: SlidersHorizontal },
  { title: 'Help Center', href: '/settings/help', icon: CircleEllipsis },
  { title: 'Terms of Service', href: '/terms', icon: CircleEllipsis },
  { title: 'Privacy Policy', href: '/privacy', icon: ShieldCheck },
  { title: 'Community Guidelines', href: '/community-guidelines', icon: CircleEllipsis },
  { title: "What's New", href: '/settings/whats-new', icon: CircleEllipsis },
  { title: 'Download an archive of your data', href: '/settings/account/archive', icon: User },
  { title: 'Deactivate your account', href: '/settings/account/deactivate', icon: User },
  { title: 'Delete account and log out', href: '/settings/account', icon: User },
];

export default function SettingsPage() {
  const { token } = useAuth();
  const router = useRouter();
  const tr = useLocalizedUiText();
  const saveScroll = useScrollRestore();
  const [query, setQuery] = useState('');
  const [username, setUsername] = useState('');

  useEffect(() => {
    setUsername('');
    if (!token) return;
    let active = true;
    apiGet<{ username: string }>('/api/profiles/me', token)
      .then((profile) => { if (active) setUsername(profile.username || ''); })
      .catch(() => { /* A profile failure must not block settings navigation. */ });
    return () => { active = false; };
  }, [token]);

  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const searching = terms.length > 0;
  const rows = searching
    ? [...categories, ...searchable].filter(({ title }) => {
        const haystack = (title + ' ' + tr(title)).toLocaleLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
    : categories;

  return (
    <div className="min-h-[70vh] pb-[calc(5rem+env(safe-area-inset-bottom))] bg-[var(--background)]">
      <header className="sticky top-0 z-30 -mx-4 flex h-14 items-center gap-2 bg-[var(--header-surface)] px-3">
        <button type="button" aria-label={tr('Go back')} onClick={() => router.push('/profile')}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[var(--vanta-gold)] focus-visible:ring-2 focus-visible:ring-[var(--vanta-gold)]">
          <ArrowLeft size={21} aria-hidden="true" />
        </button>
        <div role="search" className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-[var(--surface-active)] px-3">
          <Search size={18} className="shrink-0 text-[var(--vanta-gold)]" aria-hidden="true" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
            aria-label={tr('Search settings')} placeholder={tr('Search settings')}
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--foreground)] placeholder:text-white/45 outline-none [&::-webkit-search-cancel-button]:hidden" />
          {query && <button type="button" aria-label={tr('Clear search')} onClick={() => setQuery('')}
            className="grid h-9 w-9 shrink-0 place-items-center text-[var(--vanta-gold)]"><X size={17} /></button>}
        </div>
      </header>
      <h1 className="sr-only">{tr('Settings')}</h1>
      <nav aria-label={tr('Settings')} className="-mx-4">
        {rows.map(({ title, href, icon: Icon }) => (
          <Link key={title} href={href} onClick={saveScroll}
            className="flex min-h-[58px] items-center gap-4 px-5 py-3 text-[var(--foreground)] transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--vanta-gold)]">
            <Icon size={21} strokeWidth={1.8} className="shrink-0 text-[var(--vanta-gold)]" aria-hidden="true" />
            <span className="min-w-0 flex-1 text-[15px] font-medium">{tr(title)}</span>
            {!searching && title === 'Account' && username && <span className="max-w-[35%] truncate text-xs opacity-60">@{username}</span>}
            <ChevronRight size={17} className="shrink-0 opacity-40" aria-hidden="true" />
          </Link>
        ))}
      </nav>
      {searching && rows.length === 0 && <p role="status" className="py-10 text-center text-sm text-[var(--foreground)] opacity-70">{tr('No matching settings')}</p>}
      {!searching && <footer className="mt-5 text-center text-xs text-[var(--foreground)] opacity-65">
        <Link href="/settings/about" onClick={saveScroll} className="block py-2">VANTA · {tr('App version')}</Link>
        <Link href="/settings/whats-new" onClick={saveScroll} className="block py-2 underline">{tr("What's New")}</Link>
      </footer>}
    </div>
  );
}
