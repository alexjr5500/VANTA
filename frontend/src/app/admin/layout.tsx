"use client";

import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart3, Users, UserCog, FileText, Radio, Wallet, Gift, Coins,
  Building2, Bell, TrendingUp, ScrollText, Server, Shield,
  Menu, X, LogOut
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';

// The backend authenticates admin endpoints for these roles only
// (Role.ADMIN, Role.CEO, Role.SUPER_ADMIN; "ADMINISTRATOR" parses to ADMIN).
// Frontend-only roles such as MODERATOR / FINANCE_MANAGER are NOT accepted by
// the admin API, so they must not be given admin UI access either.
const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'CEO', 'ADMINISTRATOR'];

interface NavSection {
  label: string;
  items: { href: string; label: string; icon: any; roles: string[] }[];
}

const navSections: NavSection[] = [
  {
    label: 'Main',
    items: [
      { href: '/admin', label: 'Overview', icon: BarChart3, roles: ADMIN_ROLES },
    ],
  },
  {
    label: 'Management',
    items: [
      { href: '/admin/users', label: 'Users', icon: Users, roles: ADMIN_ROLES },
      { href: '/admin/creators', label: 'Creators', icon: UserCog, roles: ADMIN_ROLES },
      { href: '/admin/content', label: 'Content', icon: FileText, roles: ADMIN_ROLES },
      { href: '/admin/live', label: 'Live Streams', icon: Radio, roles: ADMIN_ROLES },
    ],
  },
  {
    label: 'Finance',
    items: [
      { href: '/admin/finance', label: 'Finance', icon: Wallet, roles: ADMIN_ROLES },
      { href: '/admin/coin-payments', label: 'Coin Payments', icon: Coins, roles: ADMIN_ROLES },
      { href: '/admin/gifts', label: 'Gifts', icon: Gift, roles: ADMIN_ROLES },
    ],
  },
  {
    label: 'Community',
    items: [
      { href: '/admin/communities', label: 'Communities', icon: Building2, roles: ADMIN_ROLES },
      { href: '/admin/notifications', label: 'Notifications', icon: Bell, roles: ADMIN_ROLES },
    ],
  },
  {
    label: 'Insights',
    items: [
      { href: '/admin/analytics', label: 'Analytics', icon: TrendingUp, roles: ADMIN_ROLES },
      { href: '/admin/audit', label: 'Audit Logs', icon: ScrollText, roles: ADMIN_ROLES },
    ],
  },
  {
    label: 'Compliance',
    items: [
      { href: '/admin/compliance', label: 'Compliance', icon: Shield, roles: [...ADMIN_ROLES, 'MODERATOR'] },
    ],
  },
  {
    label: 'Infrastructure',
    items: [
      { href: '/admin/infrastructure', label: 'Infrastructure', icon: Server, roles: ADMIN_ROLES },
    ],
  },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, token, refreshToken, isLoading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const hasAdminAccess = user && (ADMIN_ROLES.includes(user.role as any) || user.role === 'MODERATOR');
  const isModeratorOnly = user && user.role === 'MODERATOR';

  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  // Redirect non-admin users — only after auth finishes loading
  useEffect(() => {
    if (isLoading) return;
    if (!token && !refreshToken) {
      router.push('/login');
    }
  }, [isLoading, refreshToken, token, router]);

  // Moderators may only use the Compliance area (the backend grants them the
  // moderation permission, not full admin access).
  useEffect(() => {
    if (isModeratorOnly && !pathname.startsWith('/admin/compliance')) {
      router.push('/admin/compliance');
    }
  }, [isModeratorOnly, pathname, router]);

  if (!token && refreshToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <div className="text-sm text-gray-400">Restoring your session...</div>
      </div>
    );
  }

  if (!user || !hasAdminAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <div className="glass rounded-[28px] p-12 text-center max-w-md mx-4">
          <Shield size={48} className="text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white">Admin Access Required</h2>
          <p className="text-sm text-gray-400 mt-2">
            You need admin privileges to access this dashboard.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-6"
            onClick={() => router.push('/')}
          >
            Back to Home
          </Button>
        </div>
      </div>
    );
  }

  const roleBadgeColor = (role: string) => {
    const colors: Record<string, string> = {
      SUPER_ADMIN: 'bg-[#c9a227]/15 text-[#d8bd68]',
      ADMIN: 'bg-white/[.08] text-[#dedede]',
      CEO: 'bg-[#c9a227]/15 text-[#d8bd68]',
      ADMINISTRATOR: 'bg-white/[.08] text-[#dedede]',
      MODERATOR: 'bg-white/[.08] text-[#b8b8b8]',
      SUPPORT_AGENT: 'bg-white/[.08] text-[#b8b8b8]',
      FINANCE_MANAGER: 'bg-[#c9a227]/15 text-[#d8bd68]',
      CONTENT_REVIEWER: 'bg-white/[.08] text-[#b8b8b8]',
    };
    return colors[role] || 'bg-gray-500/20 text-gray-300';
  };

  return (
    <div className="min-h-screen w-full bg-[#050505] text-white">
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} aria-label="Close admin navigation" className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
            <motion.aside initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ type: 'spring', damping: 28, stiffness: 240 }} className="fixed bottom-0 left-0 top-0 z-50 flex w-[min(300px,calc(100vw-32px))] flex-col border-r border-white/[.08] bg-[#0d0d0f]">
              <div className="flex h-16 items-center justify-between border-b border-white/[.08] px-4">
                <Link href="/admin" className="flex items-center gap-2.5"><img src="/branding/vanta-logo.png" alt="VANTA" className="h-7 w-auto" width={480} height={120} /><span className="text-sm font-bold text-[#c9a227]">Admin</span></Link>
                <button onClick={() => setDrawerOpen(false)} className="grid h-10 w-10 place-items-center text-[#b8b8b8]" aria-label="Close navigation"><X size={19} /></button>
              </div>
              <nav className="flex-1 overflow-y-auto px-3 py-3">
                {navSections.map(section => <section key={section.label} className="mb-5"><p className="mb-2 px-3 text-[10px] font-semibold uppercase text-[#777]">{section.label}</p>{section.items.filter(item => item.roles.includes(user?.role as any)).map(item => { const Icon = item.icon; const active = pathname === item.href; return <Link key={item.href} href={item.href} className={`mb-1 flex min-h-11 items-center gap-3 rounded-md px-3 text-sm ${active ? 'border border-[#c9a227]/30 bg-[#151517] text-white' : 'text-[#b8b8b8]'}`}><Icon size={18} /><span>{item.label}</span></Link>; })}</section>)}
              </nav>
              <button onClick={logout} className="flex min-h-14 items-center gap-3 border-t border-white/[.08] px-6 text-sm text-[#b8b8b8]"><LogOut size={18} />Logout</button>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
      {/* Desktop persistent sidebar (hidden on small screens, where the drawer is used). */}
      <aside className="fixed inset-y-0 left-0 z-20 w-60 border-r border-white/[.08] bg-[#0d0d0f] lg:flex lg:flex-col hidden">
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/[.08] px-4">
          <Link href="/admin" className="flex items-center gap-2.5">
            <img src="/branding/vanta-logo.png" alt="VANTA" className="h-7 w-auto" width={480} height={120} />
            <span className="text-sm font-bold text-[#c9a227]">Admin</span>
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto overscroll-contain px-3 py-3">
          {navSections.map(section => (
            <section key={section.label} className="mb-4">
              <p className="mb-2 px-3 text-[10px] font-semibold uppercase text-[#777]">{section.label}</p>
              {section.items.filter(item => item.roles.includes(user?.role as any)).map(item => {
                const Icon = item.icon;
                const active = pathname === item.href;
                return (
                  <Link key={item.href} href={item.href} className={`mb-1 flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm ${active ? 'border border-[#c9a227]/30 bg-[#151517] text-white' : 'text-[#b8b8b8] hover:bg-white/[.04]'}`}>
                    <Icon size={17} /><span className="truncate">{item.label}</span>
                    {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#c9a227]" />}
                  </Link>
                );
              })}
            </section>
          ))}
        </nav>
        <button onClick={logout} className="flex min-h-12 shrink-0 items-center gap-3 border-t border-white/[.08] px-6 text-sm text-[#b8b8b8] hover:text-red-400">
          <LogOut size={17} />Logout
        </button>
      </aside>

      {/* Full-viewport fixed admin header. The outer bar is `fixed inset-x-0` so it
          reaches both screen edges on every device. On desktop the content area
          (and header) start after the fixed sidebar (lg:left-64 / lg:pl-64). */}
      <header className="fixed inset-x-0 top-0 z-30 border-b border-white/[.08] bg-[#0d0d0f]/95 pt-[env(safe-area-inset-top)] backdrop-blur-xl lg:left-64">
        <div className="mx-auto w-full max-w-[1400px] flex h-16 items-center justify-between px-4">
          <button onClick={() => setDrawerOpen(true)} className="grid h-10 w-10 place-items-center text-[#b8b8b8] lg:hidden" aria-label="Open admin navigation"><Menu size={20} /></button>
          <strong className="text-sm">{pathname === '/admin' ? 'Admin Overview' : 'Admin'}</strong>
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setProfileOpen(!profileOpen)}
                className="flex items-center gap-2 p-1.5 rounded-xl hover:bg-white/5 transition-colors"
              >
                <Avatar src={user?.avatar} alt={user?.username || 'Admin'} size="sm" status="online" />
              </button>

              <AnimatePresence>
                {profileOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.96 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 top-full z-50 mt-2 max-h-[min(360px,calc(100dvh-80px))] w-[min(224px,calc(100vw-24px))] overflow-y-auto overscroll-contain rounded-2xl border border-white/[0.08] glass-strong shadow-elevated"
                  >
                    <div className="p-3 border-b border-white/[0.06]">
                      <p className="text-sm font-medium text-white">{user?.fullName || user?.username}</p>
                      <p className="text-xs text-gray-400">{user?.email}</p>
                      <p className="mt-1 text-[10px] font-medium"><span className={`px-2 py-0.5 rounded-full ${roleBadgeColor(user?.role || '')}`}>{user?.role || ''}</span></p>
                    </div>
                    <div className="p-1.5 space-y-0.5">
                      <button
                        onClick={logout}
                        className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-red-400 transition-colors hover:bg-red-500/10"
                      >
                        <LogOut size={14} /> Sign Out
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </header>

      {/* Content starts below the fixed viewport header (its full height,
          including the safe-area inset, is reserved as top padding) so nothing
          scrolls underneath or disappears behind it. */}
      <div className="flex min-h-screen flex-col lg:pl-64">
        <main className="min-w-0 flex-1 overflow-x-hidden px-4 pb-6 pt-[calc(env(safe-area-inset-top)+4rem)]">{children}</main>
      </div>
    </div>
  );
}