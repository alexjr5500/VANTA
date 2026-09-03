"use client";

import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Home, FileText, Radio, DollarSign, Crown, Users, BarChart3,
  MessageCircle, Wallet, Bell, Sparkles, Shield,
  X, LogOut
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import { checkStudioAccess } from '@/lib/verificationApi';
import type { VerificationStatus } from '@/lib/verificationApi';

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
  {
    label: 'Main',
    items: [
      { href: '/creator', label: 'Home', icon: Home },
      { href: '/creator/content', label: 'Content Manager', icon: FileText },
    ],
  },
  {
    label: 'Studio',
    items: [
      { href: '/creator/live', label: 'Live Studio', icon: Radio },
    ],
  },
  {
    label: 'Earnings',
    items: [
      { href: '/creator/earnings', label: 'Earnings', icon: DollarSign },
      { href: '/creator/subscriptions', label: 'Subscriptions', icon: Crown },
    ],
  },
  {
    label: 'Community',
    items: [
      { href: '/creator/community', label: 'Community', icon: Users },
      { href: '/creator/analytics', label: 'Analytics', icon: BarChart3 },
      { href: '/creator/inbox', label: 'Inbox', icon: MessageCircle },
    ],
  },
  {
    label: 'Monetization',
    items: [
      { href: '/creator/monetization', label: 'Monetization', icon: Wallet },
      { href: '/creator/notifications', label: 'Notifications', icon: Bell },
    ],
  },
  {
    label: 'Tools',
    items: [
      { href: '/creator/ai', label: 'AI Tools', icon: Sparkles },
      { href: '/creator/security', label: 'Security', icon: Shield },
    ],
  },
];

// Route-derived title so every /creator/* page shares ONE canonical studio
// header rendered by this layout, instead of each page stacking its own bar
// directly beneath it (the double-header defect).
const STUDIO_TITLES: Record<string, string> = {
  ...Object.fromEntries(
    navSections.flatMap((section) => section.items.map((item) => [item.href, item.label])),
  ),
  '/creator': 'Creator Studio',
  '/creator/upgrade': 'Upgrade',
};

export default function CreatorLayout({ children }: { children: React.ReactNode }) {
  const { user, token, isLoading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus | null>(null);
  const [checkingAccess, setCheckingAccess] = useState(true);

  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  // Check creator studio access on every route change
  useEffect(() => {
    if (!token || !pathname) {
      setCheckingAccess(false);
      return;
    }
    
    // Skip access check for the upgrade page itself
    if (pathname === '/creator/upgrade') {
      setCheckingAccess(false);
      return;
    }

    const verifyAccess = async () => {
      setCheckingAccess(true);
      try {
        const access = await checkStudioAccess(token);
        setVerificationStatus(access.status);
        if (!access.allowed) {
          router.push('/creator/upgrade');
        }
      } catch {
        // If API fails, allow access (degraded mode)
        setCheckingAccess(false);
      } finally {
        setCheckingAccess(false);
      }
    };

    verifyAccess();
  }, [token, pathname, router]);

  const isCreator = user?.role === 'creator' || user?.role === 'admin' || user?.role === 'moderator';

  // Show a loading state while auth is being restored
  // This prevents showing the login prompt on page refresh
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-[#151517]0/60" />
      </div>
    );
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <div className="glass rounded-[28px] p-12 text-center max-w-md mx-4">
          <Radio size={48} className="text-[#d6a83f] mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white">Creator Studio</h2>
          <p className="text-sm text-gray-400 mt-2">Sign in to access your creator dashboard.</p>
          <button onClick={() => router.push('/login')} className="mt-6 px-6 py-2.5 rounded-full bg-gradient-to-r from-[#d6a83f] to-[#c8c8cc] text-white text-sm font-semibold hover:brightness-110 transition-all">
            Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-[480px] bg-[#050505] text-white">
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} aria-label="Close studio navigation" className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
            <motion.aside initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ type: 'spring', damping: 28, stiffness: 240 }} className="fixed bottom-0 left-0 top-0 z-50 flex w-[min(300px,calc(100vw-32px))] flex-col border-r border-white/[.08] bg-[#0d0d0f]">
              <div className="flex h-16 items-center justify-between border-b border-white/[.08] px-4"><Link href="/creator" className="flex items-center gap-2.5"><img src="/branding/vanta-logo.png" alt="VANTA" className="h-7 w-auto" width={480} height={120} /><span className="text-sm font-bold text-[#c9a227]">Studio</span></Link><button onClick={() => setDrawerOpen(false)} className="grid h-10 w-10 place-items-center text-[#b8b8b8]" aria-label="Close navigation"><X size={19} /></button></div>
              <nav className="flex-1 overflow-y-auto px-3 py-3">{navSections.map(section => <section key={section.label} className="mb-5"><p className="mb-2 px-3 text-[10px] font-semibold uppercase text-[#777]">{section.label}</p>{section.items.map(item => { const Icon = item.icon; const active = pathname === item.href; return <Link key={item.href} href={item.href} className={`mb-1 flex min-h-11 items-center gap-3 rounded-md px-3 text-sm ${active ? 'border border-[#c9a227]/30 bg-[#151517] text-white' : 'text-[#b8b8b8]'}`}><Icon size={18} /><span>{item.label}</span></Link>; })}</section>)}</nav>
              <button onClick={logout} className="flex min-h-14 items-center gap-3 border-t border-white/[.08] px-6 text-sm text-[#b8b8b8]"><LogOut size={18} />Logout</button>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
      <div className="flex min-h-screen flex-col">
        {/* Single canonical VANTA studio header (compact utility pattern).
            The menu toggle opens the studio drawer; title follows the route. */}
        <PageHeader
          sticky
          onMenu={() => setDrawerOpen(true)}
          title={STUDIO_TITLES[pathname || ''] || 'Creator Studio'}
          actions={
            <button
              type="button"
              className="relative grid h-10 w-10 shrink-0 place-items-center rounded-lg text-[#8A8A8A] transition hover:bg-white/[0.06] hover:text-white"
              aria-label="Studio notifications"
            >
              <Bell size={18} />
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#c9a227]" aria-hidden />
            </button>
          }
        />

        <main className="min-w-0 flex-1 overflow-x-hidden p-4">{children}</main>
      </div>
    </div>
  );
}