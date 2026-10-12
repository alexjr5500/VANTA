"use client";

import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Home, FileText, Radio, DollarSign, Crown, Users, BarChart3,
  MessageCircle, Wallet, Gift, Bell, Shield, BadgeCheck,
  X, LogOut, Menu, BellRing,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { checkStudioAccess } from '@/lib/verificationApi';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// VANTA CREATOR STUDIO SHELL
// A dedicated professional workspace: persistent desktop sidebar (the app
// maps `lg` -> 701px), compact drawer + top bar on phones. Navigation only
// links to routes that exist — every destination is a real page. Access is
// gated by the existing checkStudioAccess entitlement check, preserved
// verbatim from the previous layout (including degraded mode on API failure).
// ---------------------------------------------------------------------------

interface NavItem {
  href: string;
  label: string;
  icon: any;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  { label: 'Overview', items: [{ href: '/creator', label: 'Overview', icon: Home }] },
  { label: 'Content', items: [{ href: '/creator/content', label: 'Content Manager', icon: FileText }] },
  { label: 'Insights', items: [{ href: '/creator/analytics', label: 'Analytics', icon: BarChart3 }] },
  { label: 'Live', items: [{ href: '/creator/live', label: 'Live Studio', icon: Radio }] },
  {
    label: 'Monetization',
    items: [
      { href: '/creator/earnings', label: 'Earnings', icon: DollarSign },
      { href: '/creator/monetization', label: 'Monetization', icon: Wallet },
      { href: '/creator/rewards', label: 'Follower Rewards', icon: Gift },
      { href: '/creator/subscriptions', label: 'Subscriptions', icon: Crown },
    ],
  },
  {
    label: 'Audience',
    items: [
      { href: '/creator/community', label: 'Community', icon: Users },
      { href: '/creator/inbox', label: 'Inbox', icon: MessageCircle },
    ],
  },
  {
    label: 'Account',
    items: [
      { href: '/creator/verification', label: 'Verification', icon: BadgeCheck },
      { href: '/creator/notifications', label: 'Notifications', icon: Bell },
      { href: '/creator/security', label: 'Security', icon: Shield },
    ],
  },
];

// Route-derived title so every /creator/* page shares ONE canonical studio
// header rendered by this layout.
const STUDIO_TITLES: Record<string, string> = {
  ...Object.fromEntries(
    navSections.flatMap((section) => section.items.map((item) => [item.href, item.label])),
  ),
  '/creator': 'Creator Studio',
  '/creator/upgrade': 'Upgrade',
};

const isNavActive = (pathname: string, href: string) =>
  href === '/creator' ? pathname === '/creator' : pathname === href || pathname.startsWith(href + '/');

function StudioNav({
  sections, pathname, onNavigate,
}: {
  sections: NavSection[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <>
      {sections.map((section) => (
        <section key={section.label} className="mb-5">
          <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-console-text-3">
            {section.label}
          </p>
          {section.items.map((item) => {
            const Icon = item.icon;
            const active = isNavActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'vc-focus group relative mb-0.5 flex min-h-9 items-center gap-3 rounded-[var(--vc-radius)] px-3 text-[13px] transition-colors',
                  active
                    ? 'bg-console-gold-soft font-semibold text-console-text'
                    : 'text-console-text-2 hover:bg-white/[0.04] hover:text-console-text',
                )}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-console-gold" aria-hidden />
                )}
                <Icon size={16} className={active ? 'text-console-gold' : 'text-console-text-3 group-hover:text-console-text-2'} aria-hidden />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </section>
      ))}
    </>
  );
}


export default function CreatorLayout({ children }: { children: React.ReactNode }) {
  const { user, token, isLoading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  // Check creator studio access on every route change
  useEffect(() => {
    if (!token || !pathname) {
      return;
    }

    // Skip access check for the upgrade page itself
    if (pathname === '/creator/upgrade') {
      return;
    }

    const verifyAccess = async () => {
      try {
        const access = await checkStudioAccess(token);
        if (!access.allowed) {
          router.push('/creator/upgrade');
        }
      } catch {
        // If API fails, allow access (degraded mode) — unchanged behavior.
      }
    };

    verifyAccess();
  }, [token, pathname, router]);

  // Show a loading state while auth is being restored
  // This prevents showing the login prompt on page refresh
  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-console-bg">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-console-border border-t-console-gold" role="status" aria-label="Restoring session" />
      </div>
    );
  }

  if (!token) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-console-bg px-4">
        <div className="vc-panel w-full max-w-sm p-8 text-center">
          <Radio size={34} className="mx-auto mb-4 text-console-gold" aria-hidden />
          <h1 className="text-lg font-semibold text-console-text">Creator Studio</h1>
          <p className="mt-1.5 text-sm text-console-text-3">Sign in to access your creator workspace.</p>
          <button
            onClick={() => router.push('/login')}
            className="vc-focus mt-6 inline-flex min-h-10 items-center rounded-[var(--vc-radius)] bg-console-gold px-6 text-sm font-semibold text-console-gold-fg transition-colors hover:bg-console-gold-hover"
          >
            Sign In
          </button>
        </div>
      </div>
    );
  }

  const title = STUDIO_TITLES[pathname || ''] || 'Creator Studio';


  return (
    <div className="min-h-dvh w-full bg-console-bg text-console-text">
      {/* Mobile drawer navigation */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.button
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              aria-label="Close studio navigation"
              className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
              onClick={() => setDrawerOpen(false)}
            />
            <motion.aside
              initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 240 }}
              className="fixed bottom-0 left-0 top-0 z-50 flex w-[min(300px,calc(100vw-32px))] flex-col border-r border-console-border bg-console-bg2"
            >
              <div className="flex h-14 shrink-0 items-center justify-between border-b border-console-border px-4">
                <Link href="/creator" className="flex items-center gap-2.5 vc-focus rounded">
                  <img src="/branding/vanta-logo.png" alt="VANTA" className="h-6 w-auto" width={480} height={120} />
                  <span className="text-xs font-bold uppercase tracking-[0.2em] text-console-gold">Studio</span>
                </Link>
                <button onClick={() => setDrawerOpen(false)} className="vc-focus grid h-10 w-10 place-items-center rounded-[var(--vc-radius)] text-console-text-2 hover:bg-white/[0.05]" aria-label="Close navigation">
                  <X size={19} aria-hidden />
                </button>
              </div>
              <nav className="flex-1 overflow-y-auto overscroll-contain px-3 py-3" aria-label="Creator Studio">
                <StudioNav sections={navSections} pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
              </nav>
              <button
                onClick={logout}
                className="vc-focus flex min-h-12 shrink-0 items-center gap-3 border-t border-console-border px-6 text-sm text-console-text-2 transition-colors hover:text-console-danger"
              >
                <LogOut size={16} aria-hidden /> Logout
              </button>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Desktop persistent sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[var(--vc-sidebar-w)] flex-col border-r border-console-border bg-console-bg2 lg:flex">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-console-border px-4">
          <Link href="/creator" className="flex items-center gap-2.5 vc-focus rounded">
            <img src="/branding/vanta-logo.png" alt="VANTA" className="h-6 w-auto" width={480} height={120} />
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-console-gold">Studio</span>
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto overscroll-contain px-3 py-4" aria-label="Creator Studio">
          <StudioNav sections={navSections} pathname={pathname} />
        </nav>
        <div className="shrink-0 border-t border-console-border px-4 py-3">
          <p className="truncate text-xs font-medium text-console-text-2" title={user?.email}>
            {user?.fullName || user?.username}
          </p>
          <p className="truncate text-[11px] text-console-text-3">{user?.email}</p>
          <button
            onClick={logout}
            className="vc-focus mt-2 flex min-h-9 items-center gap-2 rounded-[var(--vc-radius)] text-xs text-console-text-2 transition-colors hover:text-console-danger"
          >
            <LogOut size={14} aria-hidden /> Logout
          </button>
        </div>
      </aside>

      {/* Compact top bar (full-bleed, starts after the desktop sidebar) */}
      <header className="fixed inset-x-0 top-0 z-30 border-b border-console-border bg-console-bg2/95 pt-[env(safe-area-inset-top)] backdrop-blur-xl lg:left-[var(--vc-sidebar-w)]">
        <div className="flex h-14 items-center gap-2 px-4">
          <button
            onClick={() => setDrawerOpen(true)}
            className="vc-focus grid h-9 w-9 shrink-0 place-items-center rounded-[var(--vc-radius)] text-console-text-2 transition-colors hover:bg-white/[0.05] hover:text-console-text lg:hidden"
            aria-label="Open studio navigation"
          >
            <Menu size={19} aria-hidden />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold text-console-text">{title}</h1>
          </div>
          <Link
            href="/creator/notifications"
            className="vc-focus grid h-9 w-9 shrink-0 place-items-center rounded-[var(--vc-radius)] text-console-text-2 transition-colors hover:bg-white/[0.05] hover:text-console-text"
            aria-label="Studio notifications"
            title="Notifications"
          >
            <BellRing size={17} aria-hidden />
          </Link>
        </div>
      </header>

      {/* Content starts below the fixed viewport header (its full height,
          including the safe-area inset, is reserved as top padding). */}
      <div className="flex min-h-dvh flex-col lg:pl-[var(--vc-sidebar-w)]">
        <main className="min-w-0 flex-1 overflow-x-hidden px-4 pb-10 pt-[calc(env(safe-area-inset-top)+3.5rem)]">
          <div className="mx-auto w-full max-w-[var(--vc-content-max)]">{children}</div>
        </main>
      </div>
    </div>
  );
}
