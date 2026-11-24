'use client';

import React, { useState, useEffect, memo, useCallback, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
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
  Plus,
} from 'lucide-react';
import VantaLogo from '@/components/ui/VantaLogo';
import Avatar from '@/components/ui/Avatar';
import CreatePostModal from '@/components/create/CreatePostModal';
import GoLiveModal from '@/components/create/GoLiveModal';
import ReelUploader from '@/components/create/ReelUploader';
import CreateHub from '@/components/create/CreateHub';
import StoryComposer from '@/components/story/StoryComposer';
import { useContentCreation } from '@/components/create/ContentCreationContext';
import { UploadManagerProvider } from '@/components/upload/UploadManagerContext';
import UploadIndicator from '@/components/upload/UploadIndicator';
import { useNotifications } from '@/context/NotificationContext';
import { useChatUnread } from '@/context/ChatUnreadContext';
import { useCalls } from '@/context/CallContext';
import { mountVisualViewport } from '@/lib/visualViewport';
import IncomingCallBanner from '@/components/messages/IncomingCallBanner';
import ChatCallOverlay from '@/components/messages/ChatCallOverlay';
import GlobalGiftAnimations from '@/components/gifts/GlobalGiftAnimations';
import { useToast } from '@/components/ui/Toast';
import { useLocalizedUiText } from '@/lib/i18n/useLocalizedUiText';

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
  { href: '/homes', icon: Home, label: 'Homes' },
  { href: '/settings', icon: Settings, label: 'Settings' },
];

// Keep the shell quiet; content and creators provide the visual focus.
const BackgroundEffects = memo(function BackgroundEffects() {
  return <div className="pointer-events-none fixed inset-0 z-0 bg-[var(--background)]" />;
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
  const tr = useLocalizedUiText();
  const navBadgeFor = (href: string) => {
    if (href === '/chat') return chatUnread;
    if (href === '/notifications') return notificationUnread;
    return 0;
  };
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 cursor-default bg-transparent"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className="fixed left-3 right-3 top-[3.75rem] z-50 mx-auto flex max-h-[calc(var(--vanta-vh,100dvh)-5rem)] w-auto max-w-[480px] flex-col overflow-hidden rounded-2xl border border-white/[0.10] bg-[#1F2630]/[0.99] shadow-[0_20px_70px_rgba(0,0,0,0.72)] backdrop-blur-2xl"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
          >
            
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.08] bg-[#1F2630] px-4">
              <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.10] bg-[#27313d]">
                  <VantaLogo size={16} className="text-[#c9a227]" />
                </div>
                <span className="text-base font-semibold tracking-[.18em] text-[#c9a227]">VANTA</span>
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
                    <p className="text-[10px] text-gray-400">@{user.username || 'user'}</p>
                  </div>
                </div>
              </div>
            )}

            <nav className="flex-1 overflow-y-auto scrollbar-hide px-3 py-3" role="navigation" aria-label="More VANTA destinations">
              <div className="flex flex-col gap-1">
                {mainNavItems.map((item) => {
                  const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      className={cn(
                        'flex min-h-11 w-full items-center gap-3 rounded-xl border px-3 py-2.5 transition-all',
                        isActive
                          ? 'border-[#c9a227]/25 bg-white/[0.035] text-[#c9a227]'
                          : 'border-transparent bg-transparent text-white/70 hover:border-white/[0.08] hover:bg-white/[0.045]'
                      )}
                    >
                      <span className="relative">
                        <Icon size={17} className="text-gray-400" />
                        {navBadgeFor(item.href) > 0 && (
                          <span className="absolute -right-2 -top-2 grid h-4 min-w-[16px] place-items-center rounded-full bg-[#c9a227] px-1 text-[9px] font-bold leading-none text-black ring-2 ring-[#0d0d0f]">
                            {navBadgeFor(item.href) > 99 ? '99+' : navBadgeFor(item.href)}
                          </span>
                        )}
                      </span>
                      <span className="text-sm">{tr(item.label)}</span>
                    </Link>
                  );
                })}
              </div>

            </nav>

            {/* Bottom actions */}
            <div className="shrink-0 border-t border-white/[0.06] px-3 py-2">
              <button
                onClick={onLogout}
                className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 w-full text-sm text-red-400 hover:bg-white/[0.04] transition mt-1"
                aria-label="Logout"
              >
                <LogOut size={16} />
                {tr('Logout')}
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
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, logout } = useAuth();
  const tr = useLocalizedUiText();
  const { unreadCount: notificationUnread } = useNotifications();
  const { chatUnreadCount: chatUnread } = useChatUnread();
  const { chatCalls } = useCalls();
  const { activeFlow, createHubOpen, openCreateHub, openStoryModal, closeCreateHub, closeAll } = useContentCreation();
  const { latestNotification: notificationToast, dismissLatestNotification } = useNotifications();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isFloatingCreateOpen, setIsFloatingCreateOpen] = useState(false);
  const [bottomNavHidden, setBottomNavHidden] = useState(false);

  // Let the frontmost visible overlay consume Android Back before WebView
  // history changes. Chat's capture-phase handler gets the first chance to
  // dismiss a nested conversation sheet, so respect defaultPrevented here.
  useEffect(() => {
    const handleNativeBack = (event: Event) => {
      if (event.defaultPrevented) return;
      const overlays = Array.from(document.querySelectorAll<HTMLElement>(
        '[role="dialog"], [aria-modal="true"], [data-vanta-overlay], dialog[open], [role="menu"], [role="listbox"]'
      )).filter(el => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return !el.closest('[aria-hidden="true"]') && style.display !== 'none' &&
          style.visibility !== 'hidden' && style.pointerEvents !== 'none' &&
          rect.width > 0 && rect.height > 0;
      });
      const top = overlays.at(-1);
      if (top) {
        event.preventDefault();
        const close = top.querySelector<HTMLButtonElement>(
          '[data-vanta-back-close], button[aria-label^="Close"], button[aria-label^="Cancel"], ' +
          'button[aria-label^="Back"], button[aria-label="Go back"], button[title="Close"]'
        );
        if (close && !close.disabled) close.click();
        else top.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        return;
      }
      if (createHubOpen) { event.preventDefault(); closeCreateHub(); return; }
      if (activeFlow) { event.preventDefault(); closeAll(); return; }
      if (mobileMenuOpen) { event.preventDefault(); setMobileMenuOpen(false); return; }
      if (isFloatingCreateOpen) {
        // A page-owned composer is still visible; never navigate the page
        // behind it. Let the owner handle its existing Escape close action.
        event.preventDefault();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      }
    };
    window.addEventListener('vanta-native-back', handleNativeBack);
    return () => window.removeEventListener('vanta-native-back', handleNativeBack);
  }, [activeFlow, createHubOpen, mobileMenuOpen, isFloatingCreateOpen, closeCreateHub, closeAll]);

  // The bottom navigation is shared by the whole app, so observe scrolls at
  // the document capture phase. This catches the shell scroller and page-owned
  // nested scrollers (Home, Discover, Profile, Chat, and standard pages) alike.
  useEffect(() => {
    const lastPositions = new WeakMap<Element, number>();

    const handleScroll = (event: Event) => {
      // Reels is a full-screen, swipe-driven feed: keep the primary VANTA
      // navigation visible while users move between videos.
      if (pathname?.startsWith('/reels')) {
        setBottomNavHidden(false);
        return;
      }

      const target = event.target;
      const scroller =
        target instanceof Document
          ? target.scrollingElement
          : target instanceof Element
            ? target
            : null;
      if (!(scroller instanceof Element)) return;

      const position = scroller.scrollTop;
      const previous = lastPositions.get(scroller);
      lastPositions.set(scroller, position);

      // Returning to the top always restores navigation. Ignore tiny movement
      // to prevent jitter from touch momentum and browser viewport adjustments.
      if (position <= 8) {
        setBottomNavHidden(false);
        return;
      }

      // A newly encountered page scroller has no previous position yet. Its
      // first non-zero scroll event is already evidence that the user moved
      // down the page, so hide the shared navigation instead of waiting for a
      // second event. This matters when a page receives one large scroll jump.
      if (previous === undefined) {
        setBottomNavHidden(true);
        return;
      }

      const delta = position - previous;
      if (Math.abs(delta) < 6) return;
      setBottomNavHidden(delta > 0);
    };

    document.addEventListener('scroll', handleScroll, true);
    return () => document.removeEventListener('scroll', handleScroll, true);
  }, [pathname]);

  useEffect(() => {
    setBottomNavHidden(false);
  }, [pathname]);

  useEffect(() => {
    const handleFloatingCreate = (event: Event) => {
      setIsFloatingCreateOpen(Boolean((event as CustomEvent<{ open?: boolean }>).detail?.open));
    };
    window.addEventListener('vanta:floating-create-open', handleFloatingCreate);
    return () => window.removeEventListener('vanta:floating-create-open', handleFloatingCreate);
  }, []);
  const [isClient, setIsClient] = useState(false);
  const postOpen = activeFlow === 'post';

  useEffect(() => {
    setIsClient(true);
  }, []);

  // Surface push-intent failures (e.g. "call no longer available" after
  // tapping Answer on an expired notification) as toasts.
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  useEffect(() => {
    const onPushToast = (event: Event) => {
      const message = (event as CustomEvent<{ message?: string }>).detail?.message;
      if (message) {
        void toastRef.current.error('Call unavailable', message);
      }
    };
    window.addEventListener('vanta-push-toast', onPushToast);
    return () => window.removeEventListener('vanta-push-toast', onPushToast);
  }, []);

  // Mount the global visual-viewport / mobile-keyboard tracker once. It writes
  // --vanta-vh / --vanta-kb / --vanta-safe-bottom on :root so every fixed
  // composer, sheet, dialog and popup can stay above the on-screen keyboard.
  useEffect(() => mountVisualViewport(), []);

  // Pages now scroll inside the app's single [data-vanta-scroll] container
  // (the Chat scrolling model) instead of the document. Next.js resets the
  // document scroll on navigation, so we reset the container here — otherwise
  // a tall page would leave the next page starting mid-scroll. The Settings
  // "return and keep my place" feature intentionally re-applies its saved
  // offset after this reset (it runs on the child's mount + a 0ms timer).
  useEffect(() => {
    const container = document.querySelector('[data-vanta-scroll]');
    container?.scrollTo({ top: 0 });
    // The Discover menu is page-scoped. Always dismiss it when navigating so
    // its drawer can never linger over Home, Reels, Profile, or another route.
    setMobileMenuOpen(false);
  }, [pathname]);

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
    const open = () => {
      // This three-line drawer belongs to Discover only. Other pages may have
      // their own leading controls and must not open this Discover drawer.
      if (window.location.pathname === '/discover') setMobileMenuOpen(true);
    };
    window.addEventListener('vanta:open-menu', open);
    return () => window.removeEventListener('vanta:open-menu', open);
  }, []);

  const isAuthPage = ['/login', '/register', '/forgot-password', '/terms', '/privacy', '/community-guidelines', '/'].includes(pathname || '');
  // Chat is a separate application surface with /chat as its only route.
  const isChatPage = pathname?.startsWith('/chat');
  // Conversation view (direct, group, or channel) is immersive; keep the
  // bottom navigation only on the Chat inbox/list surface.
  const isChatConversation = isChatPage && Boolean(searchParams.get('conversation'));
  const isPostDetailPage = Boolean(pathname && /^\/post\/[^/]+/.test(pathname));
  const isReelsPage = pathname?.startsWith('/reels');
  const isHomePage = pathname === '/home';
  const isEditProfilePage = pathname === '/profile/editprofile';
  // Discover is a primary tab like Home — it renders its own full-bleed,
  // edge-to-edge sticky header (VANTA wordmark) and grabs the whole shell,
  // so it must not be inset by the default `px-4 py-5` page padding.
  const isDiscoverPage = pathname === '/discover';
  const isLiveViewer = /^\/live\/[^/]+$/.test(pathname || '');
  // Go-Live is a full-screen immersive capture surface — it owns the whole
  // viewport (camera fills the screen) and must not show the app navigation.
  const isGoLivePage = pathname === '/live/go-live';
  // The Story/Status viewer is a full-screen surface like Reels / the Live
  // viewer: it must occupy exactly the viewport so the page never scrolls.
  const isStoryPage = pathname?.startsWith('/stories');
  const isReelsFeed = pathname === '/reels';
  // A single-Reel page (/reels/:id) is an immersive viewing surface too: the
  // Reel owns the viewport exactly like the Reels feed, so it receives no
  // shell scroll container, no padding and no bottom navigation.
  const isReelViewerPage = Boolean(pathname && /^\/reels\/.+/.test(pathname));
  // Admin and Creator Studio are desktop-style consoles that previously relied
  // on the shell padding; keep their classic low bottom inset so their layout
  // is byte-for-byte unchanged while they gain the standard scroll container.
  const isConsolePage = pathname?.startsWith('/admin') || pathname?.startsWith('/creator');
  // Immersive surfaces own the entire viewport and manage their own scrolling
  // (Chat is the reference implementation). Every other page is a standard
  // scroll page: the shell owns the dynamic viewport (100dvh), <main> fills it
  // exactly, and the page content scrolls inside a single container — the same
  // scrolling model Chat uses. The Live viewer/studio stay full-bleed but are
  // given the scroll fallback so a short viewport (keyboard, address bar)
  // can never clip their controls. Go-Live is a true immersive surface: the
  // camera feed owns the viewport and the page manages its own layers.
  // Settings (including the legacy Edit Profile entry) renders its own
  // persistent, full-bleed PageHeader (back + title) using the canonical
  // sticky-top pattern. As a standard scroll page it still scrolls inside the
  // shared container, so we only zero the container's top inset below — this
  // lets the sticky header sit flush against the shell's top edge (like Home /
  // Discover) while the Settings content scrolls beneath it.
  const isSettingsRoute = pathname?.startsWith('/settings') || pathname === '/profile/editprofile';
  // Homes and +Property own their page-specific sticky headers and need the
  // same flush-to-top, full-bleed scroll surface as Discover without importing
  // any Discover header content.
  const isHomesHeaderRoute = pathname === '/homes' || pathname === '/homes/create';
  // Notifications, Bookmarks, Gift Store (canonical route /gifts), Balance and
  // the Live feed render the same Discover-style full-bleed sticky header, so
  // they get the same flush-top treatment as Settings (the shell zeroes its top
  // inset below; each page keeps `px-4` so its header can bleed edge-to-edge
  // while the content retains its intended inset).
  const isFlushHeaderRoute =
    pathname === '/notifications' ||
    pathname === '/bookmarks' ||
    pathname === '/gift-store' ||
    pathname === '/gifts' ||
    pathname === '/balance' ||
    pathname === '/live' ||
    pathname === '/terms' ||
    pathname === '/privacy' ||
    pathname === '/community-guidelines';

  const isProfilePage = pathname === '/profile' || pathname?.startsWith('/profile/');
  const isImmersiveSurface = isChatPage || isHomePage || isDiscoverPage || isStoryPage || isReelsFeed || isReelViewerPage || isGoLivePage || isProfilePage;
  const isScrollPage = !isImmersiveSurface;

  const handleLogout = useCallback(() => {
    logout();
    setMobileMenuOpen(false);
  }, [logout]);

  if (isAuthPage) {
    return <>{children}</>;
  }

  return (
    <div className={cn(
      // TRUE FULL-SCREEN shell: the shell IS the browser/device viewport at every
      // breakpoint. No phone-frame max-width, no desktop letterboxing. All pages
      // scroll inside the shell's [data-vanta-scroll] region; immersive surfaces
      // (chat, home, discover, reels, stories, go-live) own their own scrolling.
      'vanta-app-shell relative h-[100dvh] w-full max-w-none overflow-hidden bg-[var(--background)] text-[var(--text-primary)]'
    )}>
      {!isChatPage && <BackgroundEffects />}

      <div className="relative z-10 flex h-full min-h-0 flex-col overflow-hidden">
        <AnimatePresence>
          {notificationToast && !isChatPage && (
            <motion.button
              initial={{ opacity: 0, y: -16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -12 }}
              onClick={() => { router.push(notificationDestination(notificationToast)); dismissLatestNotification(); }}
              className="fixed right-4 top-4 z-[100] w-[min(360px,calc(100vw-2rem))] rounded-xl border border-white/10 bg-[#1F2630]/95 p-4 text-left shadow-2xl backdrop-blur-xl"
            >
              <span className="flex items-start gap-3"><Bell className="mt-0.5 text-[#b8b8b8]" size={18} /><span><strong className="block text-sm text-white">{notificationToast.title || 'New notification'}</strong><span className="mt-1 block text-xs text-white/60">{notificationToast.message}</span></span><X onClick={(event) => { event.stopPropagation(); dismissLatestNotification(); }} className="ml-auto text-white/40" size={15} /></span>
            </motion.button>
          )}
        </AnimatePresence>
        {!isChatPage && <>
          <CreateHub open={createHubOpen} onClose={closeCreateHub} />
          <CreatePostModal open={postOpen} initialIntent="post" onClose={closeAll} />
          <StoryComposer open={activeFlow === 'story'} onClose={closeAll} onRequestOpen={openStoryModal} />
          <GoLiveModal open={activeFlow === 'live'} onClose={closeAll} />
          <ReelUploader open={activeFlow === 'reel'} onClose={closeAll} />
        </>}
        {/* Global background-upload indicator — always mounted so an in-progress
            Story/Reel upload stays visible and controllable while the user
            navigates anywhere in VANTA. */}
        <UploadManagerProvider>
          <UploadIndicator />
        </UploadManagerProvider>
        {/* Main Content Area */}
        {/* min-w-0 is essential: as a flex-1 item, <main> otherwise defaults to
            min-width:auto (= its content's min-content width). Wide intrinsic
            content (e.g. non-wrapping selector rows) would then push <main>
            past the 480px shell, and every width:100% child (page headers,
            cards, stats) would inherit that inflated width. min-w-0 keeps
            <main> equal to the available shell width so children stay contained
            and their own overflow-x-auto/hidden scroll regions work correctly. */}
        <main className="min-w-0 min-h-0 w-full flex-1 overflow-hidden">

          <div
            data-vanta-scroll
            className={cn(
              // Standard scroll pages: the page scrolls inside this single
              // container (the Chat scrolling model) instead of the document.
              // overflow-x-hidden prevents any page from creating its own
              // horizontal scrollbar inside the shell.
              'relative h-full min-h-0 w-full',
              isScrollPage && 'overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-hide [-webkit-overflow-scrolling:touch]',
              !isScrollPage && 'overflow-hidden',
              // Reels renders its own full-bleed surface on every sub-route
              // (the feed owns the viewport; a single-Reel page owns its own
              // page-level inset and does not receive a shared one).
              isReelsPage && 'px-0 py-0',
              // Home / Discover / Stories are full-bleed immersive surfaces.
              (isHomePage || isDiscoverPage || isStoryPage) && 'px-0 py-0',
              // Live viewer + studio are full-bleed playback surfaces.
              isLiveViewer && 'px-0 py-0',
              // Standard user pages keep the classic page inset (px-4 py-5).
              // Console surfaces (Admin / Creator Studio) keep their classic
              // low bottom inset so their desktop layouts stay unchanged.
              // Settings zeroes the top inset so its sticky full-bleed header
              // sits flush at the shell's top edge; the page keeps px-4 so the
              // Settings content itself retains its intended inset.
              isScrollPage &&
                !isLiveViewer &&
                !isConsolePage &&
                !isReelsPage && cn(isHomesHeaderRoute || isPostDetailPage ? 'px-0 pb-0' : 'px-4 pb-5', isSettingsRoute || isFlushHeaderRoute || isHomesHeaderRoute || isPostDetailPage ? 'pt-0' : 'pt-5'),
              isScrollPage && isConsolePage && 'px-4 pt-5 pb-24'
            )}>
            <motion.div
              key={isClient ? pathname : 'initial'}
              className={cn(isSettingsRoute && 'vanta-settings-shell', (isHomePage || isDiscoverPage || isStoryPage || isReelsFeed || isReelViewerPage || isGoLivePage || isChatPage || isProfilePage) && 'h-full min-h-0')}
              initial={{ opacity: 0, ...(isConsolePage ? {} : { y: 10 }) }}
              animate={{ opacity: 1, ...(isConsolePage ? {} : { y: 0 }) }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
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
            isFrontCamera={chatCalls.isFrontCamera}
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
            onFlipCamera={() => chatCalls.flipCamera()}
          />
        )}

        {/* Mobile Menu Drawer */}
        <MobileMenu
          open={mobileMenuOpen && isDiscoverPage}
          onClose={() => setMobileMenuOpen(false)}
          pathname={pathname || ''}
          onLogout={handleLogout}
          user={user}
        />

        {(isHomePage || isDiscoverPage || pathname === '/profile' || (pathname?.startsWith('/profile/') && !isEditProfilePage)) && (
          <button type="button" onClick={openCreateHub} aria-label="Create" style={{ bottom: 'calc(5.25rem + var(--vanta-native-safe-bottom, env(safe-area-inset-bottom)))' }} className="vanta-floating-action fixed right-4 z-40 grid h-[52px] w-[52px] place-items-center">
            <Plus size={25} strokeWidth={2.5} />
          </button>
        )}
        <AnimatePresence initial={false}>
          {(!isEditProfilePage && !isPostDetailPage && (!isReelsPage || isReelsFeed) && !isLiveViewer && !isStoryPage && !isGoLivePage && !isChatConversation && !createHubOpen && !activeFlow && !isFloatingCreateOpen) && (
          <motion.nav
            initial={{ y: 64, opacity: 0 }}
            animate={{ y: bottomNavHidden ? '100%' : 0, opacity: bottomNavHidden ? 0 : 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeInOut' }}
            style={{ pointerEvents: bottomNavHidden ? 'none' : 'auto' }}
            className="fixed inset-x-0 bottom-[var(--vanta-kb,0px)] z-40 w-full border-t border-white/[0.10] bg-[var(--nav-surface)] pb-[var(--vanta-native-safe-bottom,env(safe-area-inset-bottom))] shadow-none will-change-transform"
            aria-label="Mobile navigation"
          >
            <div className="mx-auto grid min-h-16 w-full max-w-5xl grid-cols-5 items-center px-2 pt-1">
              {[
                { href: '/home', icon: Home, label: 'Home' },
                { href: '/discover', icon: Compass, label: 'Discover' },
                { href: '/reels', icon: Clapperboard, label: 'Reels' },
                { href: '/chat', icon: MessageCircle, label: 'Chat' },
                { href: '/profile', icon: User, label: 'Profile' },
              ].map((item) => {
                const Icon = item.icon;
                const active = item.href === '/chat' ? isChatPage : pathname === item.href || pathname?.startsWith(`${item.href}/`);
                return (
                  <Link key={item.href} href={item.href} style={{ color: active ? '#c9a227' : undefined }} className={cn('flex min-h-12 flex-col items-center justify-center gap-1 text-[10px] transition', active ? '!text-[#c9a227]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]')} aria-current={active ? 'page' : undefined}>
                    <span className="relative inline-flex">
                      <Icon size={item.href === '/chat' ? 22 : 20} strokeWidth={active ? 2.4 : 1.8} style={{ color: active ? '#c9a227' : undefined }} className={active ? '!text-[#c9a227]' : undefined} />
                      {item.href === '/chat' && chatUnread > 0 && (
                        <span className="absolute -right-3 -top-2 grid h-4 min-w-4 place-items-center rounded-full bg-[#c9a227] px-1 text-[9px] font-bold leading-none text-black ring-2 ring-[var(--nav-surface)]" aria-label={`${chatUnread} unread messages`}>
                          {chatUnread > 99 ? '99+' : chatUnread}
                        </span>
                      )}
                    </span>
                    <span>{tr(item.label)}</span>
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
