'use client';

import React, { useState, useEffect, memo, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  MessageCircle,
  Video,
  Clapperboard,
  Bell,
  User,
  Settings,
  LogOut,
  X,
  Home,
  Compass,
  Bookmark,
  Sparkles,
  Gift,
  WalletCards,
  HelpCircle,
  Plus,
  HeartHandshake,
} from 'lucide-react';
import VantaLogo from '@/components/ui/VantaLogo';
import Avatar from '@/components/ui/Avatar';
import CreatePostModal from '@/components/create/CreatePostModal';
import GoLiveModal from '@/components/create/GoLiveModal';
import ReelUploader from '@/components/create/ReelUploader';
import CreateHub from '@/components/create/CreateHub';
import { useContentCreation } from '@/components/create/ContentCreationContext';
import { useNotifications } from '@/context/NotificationContext';
import { useChatUnread } from '@/context/ChatUnreadContext';
import { useCalls } from '@/context/CallContext';
import IncomingCallBanner from '@/components/messages/IncomingCallBanner';
import ChatCallOverlay from '@/components/messages/ChatCallOverlay';
import GlobalGiftAnimations from '@/components/gifts/GlobalGiftAnimations';

const notificationDestination = (notification: any) => {
  let data: any = notification?.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { data = {}; }
  }
  data ||= {};
  if (data.streamId) return `/live/${data.streamId}`;
  if (data.postId) return `/home?post=${data.postId}${data.commentId ? `&comment=${data.commentId}` : ''}`;
  if (data.conversationId || data.groupId || data.channelId) return '/chat';
  const type = typeof notification?.type === 'string' ? notification.type.toLowerCase() : '';
  // VANTA Give notifications
  if (data.fundraiserSlug) return `/give/${data.fundraiserSlug}`;
  if (data.fundraiserId) return `/give/my/${data.fundraiserId}`;
  if (data.transactionId || type === 'wallet' || type.startsWith('wallet_')) return '/balance/transactions';
  if (data.followerUsername) return `/profile/${data.followerUsername}`;
  return '/notifications';
};

// Secondary destinations live in one compact mobile sheet. The permanent
// navigation below stays focused on the five primary product actions.
const mainNavItems = [
  { href: '/live', icon: Video, label: 'Live' },
  { href: '/chat', icon: MessageCircle, label: 'Chat' },
  { href: '/notifications', icon: Bell, label: 'Notifications' },
  { href: '/balance', icon: WalletCards, label: 'Balance' },
  { href: '/bookmarks', icon: Bookmark, label: 'Bookmarks' },
  { href: '/creator', icon: Sparkles, label: 'Creator Studio' },
  { href: '/gifts', icon: Gift, label: 'Gifts' },
  { href: '/give', icon: HeartHandshake, label: 'VANTA Give' },
  { href: '/settings', icon: Settings, label: 'Settings' },
  { href: '/help', icon: HelpCircle, label: 'Help Center' },
];

// Keep the shell quiet; content and creators provide the visual focus.
const BackgroundEffects = memo(function BackgroundEffects() {
  return <div className="pointer-events-none fixed inset-0 z-0 bg-[#050505]" />;
});

// Mobile menu drawer — premium redesign
const MobileMenu = memo(function MobileMenu({
  open,
  onClose,
  pathname,
  onLogout,
  user,
}: {
  open: boolean;
  onClose: () => void;
  pathname: string;
  onLogout: () => void;
  user?: any;
}) {
  const { unreadCount: notificationUnread } = useNotifications();
  const { chatUnreadCount: chatUnread } = useChatUnread();
  const navBadgeFor = (href: string) => {
    if (href === '/chat') return chatUnread;
    if (href === '/notifications') return notificationUnread;
    return 0;
  };
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[82dvh] w-full max-w-[480px] flex-col overflow-hidden rounded-t-[24px] border border-b-0 border-white/[0.08] bg-[#0d0d0f]/98 pb-[env(safe-area-inset-bottom)] shadow-2xl backdrop-blur-2xl"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          >
            <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-white/20" />
            <div className="flex items-center justify-between px-5 h-16 border-b border-white/[0.06] shrink-0">
              <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.12] bg-[#080808]">
                  <VantaLogo size={16} className="text-white" />
                </div>
                <span className="text-base font-semibold tracking-[.18em] text-white">VANTA</span>
              </div>
              <button
                onClick={onClose}
                className="rounded-xl p-2 text-gray-400 hover:bg-white/[0.05] transition"
                aria-label="Close menu"
              >
                <X size={18} />
              </button>
            </div>

            {/* User card */}
            {user && (
              <div className="px-4 py-3 border-b border-white/[0.04]">
                <div className="flex items-center gap-3">
                  <Avatar
                    src={user.avatar}
                    alt={user.username || 'User'}
                    size="md"
                    status="online"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white truncate">{user.fullName || user.username || 'Guest'}</p>
                    <p className="text-[10px] text-gray-500">@{user.username || 'user'}</p>
                  </div>
                </div>
              </div>
            )}

            <nav className="flex-1 overflow-y-auto scrollbar-hide px-4 py-3" role="navigation" aria-label="More VANTA destinations">
              <div className="grid grid-cols-2 gap-2">
                {mainNavItems.map((item) => {
                  const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      className={cn(
                        'flex min-h-14 items-center gap-3 rounded-xl border px-3.5 py-3 transition-all',
                        isActive
                          ? 'bg-white/[0.08] text-white border border-white/[0.1]'
                          : 'border-white/[0.06] bg-white/[0.02] text-gray-400 hover:bg-white/[0.04] hover:text-white'
                      )}
                    >
                      <span className="relative">
                        <Icon size={17} className={isActive ? 'text-white' : undefined} />
                        {navBadgeFor(item.href) > 0 && (
                          <span className="absolute -right-2 -top-2 grid h-4 min-w-[16px] place-items-center rounded-full bg-[#c9a227] px-1 text-[9px] font-bold leading-none text-black ring-2 ring-[#0d0d0f]">
                            {navBadgeFor(item.href) > 99 ? '99+' : navBadgeFor(item.href)}
                          </span>
                        )}
                      </span>
                      <span className="text-sm">{item.label}</span>
                    </Link>
                  );
                })}
              </div>

            </nav>

            {/* Bottom actions */}
            <div className="border-t border-white/[0.06] px-3 py-2 shrink-0">
              <button
                onClick={onLogout}
                className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 w-full text-sm text-red-400 hover:bg-white/[0.04] transition mt-1"
                aria-label="Logout"
              >
                <LogOut size={16} />
                Logout
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
});

// Main AppLayout component — V2 Redesign
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { chatCalls } = useCalls();
  const { activeFlow, createHubOpen, openCreateHub, closeCreateHub, closeAll } = useContentCreation();
  const { latestNotification: notificationToast, dismissLatestNotification } = useNotifications();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const postOpen = activeFlow === 'post' || activeFlow === 'story';

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!notificationToast) return;
    const timer = window.setTimeout(dismissLatestNotification, 5000);
    return () => window.clearTimeout(timer);
  }, [dismissLatestNotification, notificationToast]);

  // Canonical drawer entry point. Pages open the VANTA menu through their
  // PageHeader's `onMenu` slot (see lib/openAppMenu) instead of a floating
  // overlay button that fought sticky headers and back buttons for the same
  // top-left corner of the shell.
  useEffect(() => {
    const open = () => setMobileMenuOpen(true);
    window.addEventListener('vanta:open-menu', open);
    return () => window.removeEventListener('vanta:open-menu', open);
  }, []);

  const isAuthPage = ['/login', '/register', '/forgot-password', '/'].includes(pathname || '');
  // Chat is a separate application surface. Keep the legacy /messages entry
  // point in the same shell while its canonical links continue to use /chat.
  const isChatPage = pathname?.startsWith('/chat') || pathname?.startsWith('/messages');
  const isReelsPage = pathname?.startsWith('/reels');
  const isHomePage = pathname === '/home';
  // Discover is a primary tab like Home — it renders its own full-bleed,
  // edge-to-edge sticky header (VANTA wordmark) and grabs the whole shell,
  // so it must not be inset by the default `px-4 py-5` page padding.
  const isDiscoverPage = pathname === '/discover';
  const isLiveViewer = /^\/live\/[^/]+$/.test(pathname || '');

  const handleLogout = useCallback(() => {
    logout();
    setMobileMenuOpen(false);
  }, [logout]);

  if (isAuthPage) {
    return <>{children}</>;
  }

  return (
    <div className={cn(
      'vanta-app-shell relative mx-auto min-h-[100dvh] w-full max-w-[480px] bg-[#050505] text-white',
      isChatPage && 'h-[100dvh] max-w-none overflow-hidden',
      (isHomePage || isDiscoverPage) && 'h-[100dvh] overflow-hidden'
    )}>
      {!isChatPage && <BackgroundEffects />}

      <div className={cn('relative z-10 flex min-h-screen', isChatPage && 'h-full min-h-0 overflow-hidden', (isHomePage || isDiscoverPage) && 'h-full min-h-0 overflow-hidden')}>
        <AnimatePresence>
          {notificationToast && !isChatPage && (
            <motion.button
              initial={{ opacity: 0, y: -16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -12 }}
              onClick={() => { router.push(notificationDestination(notificationToast)); dismissLatestNotification(); }}
              className="fixed right-4 top-4 z-[100] w-[min(360px,calc(100vw-2rem))] rounded-xl border border-white/10 bg-[#161616]/95 p-4 text-left shadow-2xl backdrop-blur-xl"
            >
              <span className="flex items-start gap-3"><Bell className="mt-0.5 text-[#b8b8b8]" size={18} /><span><strong className="block text-sm text-white">{notificationToast.title || 'New notification'}</strong><span className="mt-1 block text-xs text-white/60">{notificationToast.message}</span></span><X onClick={(event) => { event.stopPropagation(); dismissLatestNotification(); }} className="ml-auto text-white/40" size={15} /></span>
            </motion.button>
          )}
        </AnimatePresence>
        {!isChatPage && <>
          <CreateHub open={createHubOpen} onClose={closeCreateHub} />
          <CreatePostModal open={postOpen} initialIntent={activeFlow === 'story' ? 'story' : 'post'} onClose={closeAll} />
          <GoLiveModal open={activeFlow === 'live'} onClose={closeAll} />
          <ReelUploader open={activeFlow === 'reel'} onClose={closeAll} />
        </>}
        {/* Main Content Area */}
        {/* min-w-0 is essential: as a flex-1 item, <main> otherwise defaults to
            min-width:auto (= its content's min-content width). Wide intrinsic
            content (e.g. non-wrapping selector rows) would then push <main>
            past the 480px shell, and every width:100% child (page headers,
            cards, stats) would inherit that inflated width. min-w-0 keeps
            <main> equal to the available shell width so children stay contained
            and their own overflow-x-auto/hidden scroll regions work correctly. */}
        <main className={cn(
          'min-w-0 flex-1 min-h-screen',
          isChatPage && 'h-full min-h-0 overflow-hidden',
          (isHomePage || isDiscoverPage) && 'h-full min-h-0 overflow-hidden',
          isReelsPage && 'ml-0'
        )}>

          <div className={cn(
            !isLiveViewer && !isChatPage && !isHomePage && !isDiscoverPage && 'pb-24',
            isChatPage && 'h-full min-h-0 overflow-hidden',
            (isHomePage || isDiscoverPage) && 'h-full min-h-0 overflow-hidden',
            !isChatPage && !isReelsPage && !isHomePage && !isDiscoverPage && 'px-4 py-5',
            isChatPage && '',
            isReelsPage && 'px-0 py-0',
            isHomePage && 'px-0 py-0',
            isDiscoverPage && 'px-0 py-0',
            isLiveViewer && 'px-0 py-0'
          )}>
            <motion.div
              key={isClient ? pathname : 'initial'}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className={cn(
                isChatPage && 'h-full min-h-0 overflow-hidden',
                (isHomePage || isDiscoverPage) && 'h-full min-h-0 overflow-hidden'
              )}
            >
              {children}
            </motion.div>
          </div>
        </main>

        {/* Global gift overlay — recipient/sender sees animated gifts on every
            page in real time (live pages mount their own overlay). */}
        <GlobalGiftAnimations />

        {/* ── Global call UI (any page) ─────────────────────────────────────
            Incoming calls are surfaced as a compact top banner while the user
            browses; the full call interface opens on Answer (established calls)
            or immediately for outgoing/ringing/connecting states. The incoming
            full-screen (ChatCallOverlay) is intentionally not auto-shown.  */}
        <IncomingCallBanner
          status={chatCalls.status}
          callType={chatCalls.callType}
          peerName={chatCalls.peerName}
          peerAvatar={chatCalls.peerAvatar}
          onAnswer={() => void chatCalls.acceptCall()}
          onDecline={chatCalls.declineCall}
        />

        {chatCalls.status !== 'idle' && chatCalls.status !== 'incoming' && (
          <ChatCallOverlay
            status={chatCalls.status}
            callType={chatCalls.callType}
            peerName={chatCalls.peerName}
            peerAvatar={chatCalls.peerAvatar}
            localStream={chatCalls.localStream}
            remoteStream={chatCalls.remoteStream}
            isMicOn={chatCalls.isMicOn}
            isCamOn={chatCalls.isCamOn}
            durationSeconds={chatCalls.durationSeconds}
            error={chatCalls.error}
            permissionError={chatCalls.permissionError}
            endedReason={chatCalls.endedReason}
            onAccept={() => void chatCalls.acceptCall()}
            onDecline={chatCalls.declineCall}
            onEnd={chatCalls.endCall}
            onCancel={chatCalls.cancelCall}
            onToggleMic={chatCalls.toggleMicrophone}
            onToggleCam={chatCalls.toggleCamera}
          />
        )}

        {/* Mobile Menu Drawer */}
        <MobileMenu
          open={mobileMenuOpen && !isChatPage}
          onClose={() => setMobileMenuOpen(false)}
          pathname={pathname || ''}
          onLogout={handleLogout}
          user={user}
        />

        <AnimatePresence initial={false}>
          {!isChatPage && !isReelsPage && !isLiveViewer && (
          <motion.nav
            initial={{ y: 64, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 64, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[480px] border-x border-t border-white/[0.08] bg-[#080808]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-2xl"
            aria-label="Mobile navigation"
          >
            <div className="mx-auto grid min-h-16 grid-cols-5 items-center px-2 pt-1">
              {[
                { href: '/home', icon: Home, label: 'Home' },
                { href: '/discover', icon: Compass, label: 'Discover' },
                { href: '', icon: Plus, label: 'Create', create: true },
                { href: '/reels', icon: Clapperboard, label: 'Reels' },
                { href: '/profile', icon: User, label: 'Profile' },
              ].map((item) => {
                const Icon = item.icon;
                const active = !item.create && (pathname === item.href || pathname?.startsWith(`${item.href}/`));
                if (item.create) {
                  return (
                    <button key={item.label} type="button" onClick={openCreateHub} className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#c9a227] text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50" aria-label="Create">
                      <Icon size={22} strokeWidth={2.5} />
                    </button>
                  );
                }
                return (
                  <Link key={item.href} href={item.href} className={cn('flex min-h-12 flex-col items-center justify-center gap-1 text-[10px] transition', active ? 'text-white' : 'text-[#666] hover:text-[#b8b8b8]')} aria-current={active ? 'page' : undefined}>
                    <Icon size={20} strokeWidth={active ? 2.4 : 1.8} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </motion.nav>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}
