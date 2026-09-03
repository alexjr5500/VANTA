"use client";

import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart3, Users, UserCog, FileText, Radio, Wallet, Gift,
  Building2, Bell, TrendingUp, ScrollText, Server, Shield,
  Menu, X, LogOut, Settings, BellDot, Activity, Heart
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'CEO', 'ADMINISTRATOR', 'MODERATOR', 'SUPPORT_AGENT', 'FINANCE_MANAGER', 'CONTENT_REVIEWER'];

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
      { href: '/admin/users', label: 'Users', icon: Users, roles: ['SUPER_ADMIN', 'ADMIN', 'CEO', 'ADMINISTRATOR', 'MODERATOR', 'SUPPORT_AGENT'] },
      { href: '/admin/communication', label: 'Communication', icon: Bell, roles: ['SUPER_ADMIN', 'ADMIN', 'CEO', 'ADMINISTRATOR'] },
      { href: '/admin/creators', label: 'Creators', icon: UserCog, roles: ['SUPER_ADMIN', 'ADMIN', 'CEO', 'ADMINISTRATOR', 'MODERATOR', 'CONTENT_REVIEWER'] },
      { href: '/admin/content', label: 'Content', icon: FileText, roles: ['SUPER_ADMIN', 'ADMIN', 'CEO', 'ADMINISTRATOR', 'MODERATOR', 'CONTENT_REVIEWER'] },
      { href: '/admin/fundraisers', label: 'Fundraisers', icon: Heart, roles: ['SUPER_ADMIN', 'ADMIN', 'CEO', 'ADMINISTRATOR', 'MODERATOR', 'CONTENT_REVIEWER'] },
      { href: '/admin/live', label: 'Live Streams', icon: Radio, roles: ['SUPER_ADMIN', 'ADMIN', 'CEO', 'ADMINISTRATOR', 'MODERATOR'] },
    ],
  },
  {
    label: 'Finance',
    items: [
      { href: '/admin/finance', label: 'Finance', icon: Wallet, roles: ['SUPER_ADMIN', 'ADMIN', 'CEO', 'ADMINISTRATOR', 'FINANCE_MANAGER'] },
      { href: '/admin/gifts', label: 'Gifts', icon: Gift, roles: ['SUPER_ADMIN', 'ADMIN', 'CEO', 'ADMINISTRATOR', 'FINANCE_MANAGER'] },
    ],
  },
  {
    label: 'Community',
    items: [
      { href: '/admin/communities', label: 'Communities', icon: Building2, roles: ['SUPER_ADMIN', 'ADMIN', 'CEO', 'ADMINISTRATOR', 'MODERATOR'] },
      { href: '/admin/notifications', label: 'Notifications', icon: Bell, roles: ['SUPER_ADMIN', 'ADMIN', 'CEO', 'ADMINISTRATOR'] },
    ],
  },
  {
    label: 'Insights',
    items: [
      { href: '/admin/analytics', label: 'Analytics', icon: TrendingUp, roles: ['SUPER_ADMIN', 'ADMIN', 'CEO', 'ADMINISTRATOR', 'FINANCE_MANAGER'] },
      { href: '/admin/audit', label: 'Audit Logs', icon: ScrollText, roles: ['SUPER_ADMIN', 'ADMIN', 'CEO', 'ADMINISTRATOR'] },
    ],
  },
  {
    label: 'Compliance',
    items: [
      { href: '/admin/compliance', label: 'Compliance', icon: Shield, roles: ['SUPER_ADMIN', 'ADMIN', 'CEO', 'ADMINISTRATOR', 'MODERATOR', 'CONTENT_REVIEWER'] },
    ],
  },
  {
    label: 'Infrastructure',
    items: [
      { href: '/admin/infrastructure', label: 'Infrastructure', icon: Server, roles: ['SUPER_ADMIN', 'ADMIN', 'CEO', 'ADMINISTRATOR'] },
    ],
  },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, token, refreshToken, isLoading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const hasAdminAccess = user && ADMIN_ROLES.includes(user.role as any);

  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  // Redirect non-admin users — only after auth finishes loading
  useEffect(() => {
    if (isLoading) return;
    if (!token && !refreshToken) {
      router.push('/login');
    }
  }, [isLoading, refreshToken, token, router]);

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
    <div className="mx-auto min-h-screen w-full max-w-[700px] bg-[#050505] text-white">
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
      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-white/[.08] bg-[#0d0d0f]/95 px-4 backdrop-blur-xl">
          <button onClick={() => setDrawerOpen(true)} className="grid h-10 w-10 place-items-center text-[#b8b8b8]" aria-label="Open admin navigation"><Menu size={20} /></button>
          <strong className="text-sm">Admin</strong>
          <div className="flex items-center gap-2">
            <button className="relative p-2 rounded-xl hover:bg-white/5 text-gray-400 transition-colors">
              <BellDot size={18} />
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#c9a227] text-[9px] font-bold text-black flex items-center justify-center">
                3
              </span>
            </button>

            {/* Profile Dropdown */}
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
                    </div>
                    <div className="p-1.5 space-y-0.5">
                      <button className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-gray-400 transition-colors hover:bg-white/5 hover:text-white">
                        <Settings size={14} /> Settings
                      </button>
                      <button className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-gray-400 transition-colors hover:bg-white/5 hover:text-white">
                        <Activity size={14} /> Activity Log
                      </button>
                      <hr className="border-white/[0.06] my-1" />
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
        </header>

        <main className="min-w-0 flex-1 overflow-x-hidden p-4">{children}</main>
      </div>
    </div>
  );
}