"use client";

import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart3, Users, UserCog, FileText, Radio, Wallet, Gift, Coins,
  Building2, Home, Bell, TrendingUp, ScrollText, Server, Shield, ShieldCheck,
  Menu, X, LogOut,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import Avatar from '@/components/ui/Avatar';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// VANTA ADMIN COMMAND CENTER SHELL
// A distinct operational interface sharing the VANTA console design system
// with Creator Studio but emphasising density, precision and fast navigation.
//
// AUTHORIZATION (unchanged from the previous implementation — this shell only
// mirrors the backend rules):
//  - Only Role.ADMIN / CEO / SUPER_ADMIN are accepted by the admin API
//    ("ADMINISTRATOR" parses to ADMIN server-side).
//  - MODERATOR is a frontend permission that the backend grants for the
//    compliance/moderation routes only, so moderators are redirected to
//    /admin/compliance and see only that section.
// Every /admin/* page performs its own permission checks and the backend
// enforces authorization on every request regardless of this UI.
// ---------------------------------------------------------------------------

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'CEO', 'ADMINISTRATOR'];

interface NavItem {
  href: string;
  label: string;
  icon: any;
  roles: string[];
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    label: 'Dashboard',
    items: [
      { href: '/admin', label: 'Overview', icon: BarChart3, roles: ADMIN_ROLES },
    ],
  },
  {
    label: 'Management',
    items: [
      { href: '/admin/users', label: 'Users', icon: Users, roles: ADMIN_ROLES },
      { href: '/admin/creators', label: 'Creators', icon: UserCog, roles: ADMIN_ROLES },
      { href: '/admin/verification', label: 'Verification', icon: ShieldCheck, roles: ADMIN_ROLES },
      { href: '/admin/homes', label: 'Homes', icon: Home, roles: ADMIN_ROLES },
      { href: '/admin/content', label: 'Content', icon: FileText, roles: ADMIN_ROLES },
    ],
  },
  {
    label: 'Finance',
    items: [
      { href: '/admin/finance', label: 'Payments', icon: Wallet, roles: ADMIN_ROLES },
      { href: '/admin/coin-payments', label: 'Coins', icon: Coins, roles: ADMIN_ROLES },
      { href: '/admin/gifts', label: 'Gifts', icon: Gift, roles: ADMIN_ROLES },
      { href: '/admin/follower-rewards', label: 'Follower Rewards', icon: TrendingUp, roles: ADMIN_ROLES },
    ],
  },
  {
    label: 'Platform',
    items: [
      { href: '/admin/live', label: 'Live Streams', icon: Radio, roles: ADMIN_ROLES },
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
    label: 'Safety',
    items: [
      { href: '/admin/compliance', label: 'Reports & Moderation', icon: Shield, roles: [...ADMIN_ROLES, 'MODERATOR'] },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/admin/infrastructure', label: 'System', icon: Server, roles: ADMIN_ROLES },
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

  if (isLoading || (!token && refreshToken)) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-console-bg">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-console-border border-t-console-gold" role="status" aria-label="Restoring session" />
      </div>
    );
  }

  if (!user || !hasAdminAccess) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-console-bg px-4">
        <div className="vc-panel w-full max-w-sm p-8 text-center">
          <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-console-danger-soft text-console-danger" aria-hidden>
            <Shield size={24} />
          </span>
          <h1 className="text-lg font-semibold text-console-text">Administrator access required</h1>
          <p className="mt-1.5 text-sm text-console-text-3">
            This command center is restricted to authorized VANTA administrators. Your permissions
            are verified on every request by the backend.
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              onClick={() => router.push('/')}
              className="vc-focus inline-flex min-h-10 items-center justify-center rounded-[var(--vc-radius)] bg-console-gold px-5 text-sm font-semibold text-console-gold-fg transition-colors hover:bg-console-gold-hover"
            >
              Back to VANTA
            </button>
            <button
              onClick={logout}
              className="vc-focus inline-flex min-h-10 items-center justify-center rounded-[var(--vc-radius)] border border-console-border-strong px-5 text-sm font-semibold text-console-text-2 transition-colors hover:bg-white/[0.04] hover:text-console-text"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Roles that the backend actually accepts on /api/admin/* — anything else is
  // a frontend label only and must not be granted console navigation.
  const roleBadgeClass = (role: string) =>
    ADMIN_ROLES.includes(role) || role === 'MODERATOR'
      ? 'bg-console-gold-soft text-console-gold'
      : 'bg-white/[0.06] text-console-text-2';

  const isNavActive = (pathname: string, href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname === href || pathname.startsWith(href + '/');

  // Single navigation renderer shared by the drawer and the desktop rail so the
  // two can never drift apart. `compact` tightens row height on phones.
  const renderNav = (compact: boolean) =>
    navSections.map((section) => {
      const items = section.items.filter((item) => item.roles.includes(user?.role as any));
      if (items.length === 0) return null;
      return (
        <section key={section.label} className="mb-5">
          <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-console-text-3">
            {section.label}
          </p>
          {items.map((item) => {
            const Icon = item.icon;
            const active = isNavActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'vc-focus group relative mb-0.5 flex items-center gap-3 rounded-[var(--vc-radius)] px-3 text-[13px] transition-colors',
                  compact ? 'min-h-11' : 'min-h-9',
                  active
                    ? 'bg-console-gold-soft font-semibold text-console-text'
                    : 'text-console-text-2 hover:bg-white/[0.04] hover:text-console-text',
                )}
              >
                {active && <span aria-hidden className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-console-gold" />}
                <Icon size={16} aria-hidden className={cn('shrink-0 transition-colors', active ? 'text-console-gold' : 'text-console-text-3 group-hover:text-console-text-2')} />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </section>
      );
    });

  // Breadcrumb section is derived from the ACTIVE route, not a static lookup,
  // so the header always names the section the administrator is in.
  const activeNavItem = navSections
    .flatMap((s) => s.items)
    .find((i) => i.roles.includes(user?.role as any) && isNavActive(pathname, i.href)) ?? null;
  const currentSection =
    navSections.find((s) => activeNavItem && s.items.includes(activeNavItem))?.label ?? 'Command Center';

  return (
    <div className="min-h-dvh bg-console-bg text-console-text">
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              aria-label="Close admin navigation"
              className="fixed inset-0 z-40 bg-black/70"
              onClick={() => setDrawerOpen(false)}
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 240 }}
              className="fixed inset-y-0 left-0 z-50 flex w-[min(288px,calc(100vw-2.5rem))] flex-col border-r border-console-border bg-console-bg2 pt-[env(safe-area-inset-top)]"
              aria-label="Admin navigation"
            >
              <div className="flex h-[var(--vc-header-h)] shrink-0 items-center justify-between gap-2 border-b border-console-border px-3">
                <Link href="/admin" className="flex min-w-0 items-center gap-2.5">
                  <img src="/branding/vanta-logo.png" alt="VANTA" className="h-6 w-auto" width={480} height={120} />
                  <span className="truncate text-[11px] font-bold uppercase tracking-[0.18em] text-console-gold">Command Center</span>
                </Link>
                <button onClick={() => setDrawerOpen(false)} className="vc-focus grid h-10 w-10 shrink-0 place-items-center rounded-[var(--vc-radius)] text-console-text-3 transition-colors hover:bg-white/[0.05] hover:text-console-text" aria-label="Close navigation">
                  <X size={19} aria-hidden />
                </button>
              </div>
              <nav className="flex-1 overflow-y-auto overscroll-contain px-2 py-4">{renderNav(true)}</nav>
              <button onClick={logout} className="vc-focus flex min-h-14 shrink-0 items-center gap-3 border-t border-console-border px-5 text-left text-[13px] text-console-text-3 transition-colors hover:bg-white/[0.03] hover:text-console-danger">
                <LogOut size={16} aria-hidden /> Sign out
              </button>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
      {/* Desktop persistent rail — stable while moving between sections. */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[var(--vc-sidebar-w)] flex-col border-r border-console-border bg-console-bg2 pt-[env(safe-area-inset-top)] lg:flex">
        <div className="flex h-[var(--vc-header-h)] shrink-0 items-center gap-2.5 border-b border-console-border px-4">
          <Link href="/admin" className="flex min-w-0 items-center gap-2.5">
            <img src="/branding/vanta-logo.png" alt="VANTA" className="h-6 w-auto" width={480} height={120} />
            <span className="truncate text-[11px] font-bold uppercase tracking-[0.18em] text-console-gold">Command Center</span>
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto overscroll-contain px-2 py-4" aria-label="Admin sections">
          {renderNav(false)}
        </nav>
        <div className="shrink-0 border-t border-console-border p-2">
          <button
            onClick={logout}
            className="vc-focus flex min-h-10 w-full items-center gap-3 rounded-[var(--vc-radius)] px-3 text-left text-[13px] text-console-text-3 transition-colors hover:bg-white/[0.04] hover:text-console-danger"
          >
            <LogOut size={16} aria-hidden /> Sign out
          </button>
        </div>
      </aside>

      {/* Compact top bar. Fixed across the full viewport width on mobile; on
          desktop it starts after the persistent rail. The content area below
          reserves its full height (incl. safe-area inset) as top padding so no
          content is ever hidden behind it. */}
      <header className="fixed inset-x-0 top-0 z-30 border-b border-console-border bg-console-bg2/95 pt-[env(safe-area-inset-top)] backdrop-blur-xl lg:left-[var(--vc-sidebar-w)]">
        <div className="flex h-[var(--vc-header-h)] items-center justify-between gap-2 px-3 sm:px-4">
          <button onClick={() => setDrawerOpen(true)} className="vc-focus grid h-10 w-10 shrink-0 place-items-center rounded-[var(--vc-radius)] text-console-text-3 transition-colors hover:bg-white/[0.05] hover:text-console-text lg:hidden" aria-label="Open admin navigation">
            <Menu size={20} aria-hidden />
          </button>
          <nav aria-label="Breadcrumb" className="min-w-0 flex-1 lg:px-2">
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-console-text-3">
              VANTA / {currentSection}
            </p>
            <h1 className="truncate text-sm font-semibold text-console-text">
              {activeNavItem?.label ?? 'Command Center'}
            </h1>
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            <span className={cn('hidden rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider sm:inline', roleBadgeClass(user?.role || ''))}>
              {user?.role}
            </span>
            <div className="relative">
              <button
                onClick={() => setProfileOpen(!profileOpen)}
                className="vc-focus flex items-center gap-2 rounded-[var(--vc-radius)] p-1.5 transition-colors hover:bg-white/[0.05]"
                aria-label="Admin account menu"
                aria-expanded={profileOpen}
                aria-haspopup="menu"
              >
                <Avatar src={user?.avatar} alt={user?.username || 'Admin'} size="sm" />
              </button>

              <AnimatePresence>
                {profileOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                    transition={{ duration: 0.12 }}
                    role="menu"
                    className="absolute right-0 top-full z-50 mt-2 max-h-[min(360px,calc(100dvh-5rem))] w-[min(248px,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain rounded-[var(--vc-radius-lg)] border border-console-border bg-console-surface p-2 shadow-[0_16px_48px_rgba(0,0,0,0.5)]"
                  >
                    <div className="rounded-[var(--vc-radius)] border border-console-border bg-console-bg2 p-3">
                      <p className="truncate text-[13px] font-medium text-console-text">{user?.fullName || user?.username}</p>
                      <p className="truncate text-[11px] text-console-text-3">{user?.email}</p>
                      <p className="mt-2">
                        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider', roleBadgeClass(user?.role || ''))}>
                          {user?.role}
                        </span>
                      </p>
                    </div>
                    <div className="mt-1">
                      <button
                        onClick={logout}
                        role="menuitem"
                        className="vc-focus flex min-h-11 w-full items-center gap-2.5 rounded-[var(--vc-radius)] px-3 py-2 text-left text-[13px] text-console-danger transition-colors hover:bg-console-danger-soft"
                      >
                        <LogOut size={14} aria-hidden /> Sign out
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </header>

      {/* Content region: starts below the fixed header (safe-area inset plus the
          bar height reserved as top padding) and after the desktop rail. */}
      <div className="flex min-h-dvh flex-col lg:pl-[var(--vc-sidebar-w)]">
        <main className="mx-auto w-full max-w-[var(--vc-content-max)] min-w-0 flex-1 px-4 pb-12 pt-[calc(env(safe-area-inset-top)+calc(var(--vc-header-h)+1rem))] sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}