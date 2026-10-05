'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BadgeCheck,
  Camera,
  Check,
  ChevronRight,
  Clock,
  Image as ImageIcon,
  MessagesSquare,
  Plus,
  Sparkles,
  Video,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import StoryComposerTextStory from '@/components/story/TextStoryEditor';
import StatusComposer from '@/components/story/StatusComposer';
import StoryMediaEditor, { MediaStorySource } from '@/components/story/StoryMediaEditor';
import { fetchStatusUsage, type StoryUsage } from '@/lib/storyApi';

export type StoryComposerMode = 'menu' | 'text' | 'status' | 'media';

export interface StoryComposerProps {
  open: boolean;
  onClose: () => void;
}

export interface StoryComposerOpenDetails {
  mode: StoryComposerMode;
  mediaSource?: MediaStorySource;
}

export type StoryComposerOpener = (details: StoryComposerOpenDetails) => void;

// Global open command so any consumer (Home tray, header button, profile) can
// open the composer without prop drilling into every page.
let openCommand: ((details: StoryComposerOpenDetails) => void) | null = null;
export function setStoryComposerOpener(fn: StoryComposerOpener | null): void {
  openCommand = fn;
}
export function openStoryComposer(details: StoryComposerOpenDetails): void {
  openCommand?.(details);
}

/** The three premium creation choices on the landing surface. */
type MenuChoice = 'media' | 'media-camera' | 'text';

interface MenuChoiceCard {
  id: MenuChoice;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  /** mode + media source navigation for this choice. */
  target: { mode: Exclude<StoryComposerMode, 'menu'>; source?: MediaStorySource };
}

export const CREATE_STATUS_CHOICES: MenuChoiceCard[] = [
  {
    id: 'media',
    label: 'Photo & Video',
    description: 'Choose multiple photos or videos',
    icon: ImageIcon,
    target: { mode: 'media', source: 'gallery-mixed' },
  },
  {
    id: 'media-camera',
    label: 'Camera',
    description: 'Capture a photo or video instantly',
    icon: Camera,
    target: { mode: 'media', source: 'camera-photo' },
  },
  {
    id: 'text',
    label: 'Text Only',
    description: 'Write a text Status · up to 700 characters',
    icon: MessagesSquare,
    target: { mode: 'text' },
  },
];
/**
 * Full-screen Story/Status creation environment.
 *
 * The landing surface is a premium, cinematic VANTA experience: a layered
 * hero communicates the 24-hour Story concept visually, and "Choose Your
 * Media" presents three rich creation cards. Photo & Video opens the true
 * multi-file composer; Camera jumps straight into capture; Text Only launches
 * the premium text canvas. No fake controls — every choice routes to an
 * existing, working VANTA flow.
 */
export default function StoryComposer({ open, onClose }: StoryComposerProps) {
  const { user, token } = useAuth();
  const [mode, setMode] = useState<StoryComposerMode>('menu');
  const [mediaSource, setMediaSource] = useState<MediaStorySource>('gallery-mixed');
  const [usage, setUsage] = useState<StoryUsage | null>(null);
  const wasOpenRef = useRef(false);

  // Receive global open commands (e.g. from the Home tray's add button).
  useEffect(() => {
    setStoryComposerOpener(details => {
      if (details.mode === 'media') setMediaSource(details.mediaSource || 'gallery-mixed');
      setMode(details.mode);
    });
    return () => setStoryComposerOpener(null);
  }, []);

  // Fresh landing page every time the composer opens.
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    setMode('menu');
    setMediaSource('gallery-mixed');
    setUsage(null);
    if (token) {
      void fetchStatusUsage(token)
        .then((data) => {
          if (typeof data?.used === 'number' && typeof data?.limit === 'number') setUsage(data);
        })
        .catch(() => undefined);
    }
  }, [open, token]);

  // Lock scroll while the composer is open.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const handleClose = () => {
    setMode('menu');
    onClose();
  };

  const closed = !open;
return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Create a Story or Status"
          className="fixed inset-0 z-[55] bg-[#050506] text-white"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          {mode === 'menu' && (
            <Menu
              user={user}
              usage={usage}
              onPick={(next) => {
                const card = CREATE_STATUS_CHOICES.find((choice) => choice.id === next);
                if (!card) return;
                if (card.target.mode === 'media' && card.target.source) setMediaSource(card.target.source);
                setMode(card.target.mode);
              }}
              onClose={handleClose}
            />
          )}

          <AnimatePresence mode="wait">
            {mode === 'text' && (
              <motion.div
                key="text"
                className="fixed inset-0"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 24 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              >
                <StoryComposerTextStory onBack={() => setMode('menu')} onClose={handleClose} />
              </motion.div>
            )}

            {mode === 'status' && (
              <motion.div
                key="status"
                className="fixed inset-0"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 24 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              >
                <StatusComposer onBack={() => setMode('menu')} onClose={handleClose} />
              </motion.div>
            )}

            {mode === 'media' && (
              <motion.div
                key="media"
                className="fixed inset-0"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 24 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              >
                <StoryMediaEditor
                  source={mediaSource}
                  onBack={() => setMode('menu')}
                  onClose={handleClose}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {closed && null}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
/**
 * Premium landing surface — hero + "Choose Your Media" + Next CTA.
 * Kept intentionally free of large copy blocks: the hero communicates the
 * 24-hour Story concept visually, and the three choice cards are the only
 * actions on the page.
 */
function Menu({
  user,
  usage,
  onPick,
  onClose,
}: {
  user?: { verified?: boolean } | null;
  usage?: StoryUsage | null;
  onPick: (choice: MenuChoice) => void;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState<MenuChoice | null>(null);
  const isVerified = Boolean(user?.verified);

  return (
    <div className="flex h-full flex-col overflow-y-auto scrollbar-hide bg-[#050506]">
      {/* Header — compact: close, title, verified/quota pill */}
      <header className="flex shrink-0 items-center justify-between px-4 pb-1 pt-[max(env(safe-area-inset-top,0px),10px)]">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close creation"
          className="grid h-11 w-11 place-items-center rounded-full text-[#8a8a8a] transition hover:bg-white/[0.06] hover:text-white"
        >
          <X size={19} />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <h1 className="text-[17px] font-bold leading-tight text-white">Create Status</h1>
          <p className="text-[10.5px] leading-tight text-white/40">Share your moment with the VANTA community</p>
        </div>
        {isVerified ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full border border-[#c9a227]/40 bg-[#c9a227]/12 px-2.5 py-1 text-[10px] font-bold text-[#dfbd55]">
            <BadgeCheck size={11} />
            Unlimited
          </span>
        ) : usage ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full border border-white/[0.12] bg-white/[0.05] px-2.5 py-1 text-[10px] font-semibold tabular-nums text-white/70">
            <Check size={11} className="text-[#dfbd55]" />
            {usage.used}/{usage.limit} today
          </span>
        ) : (
          <span className="grid h-11 w-11 place-items-center" aria-hidden="true" />
        )}
      </header>

      {/* Hero — layered Story cards, 24h motif */}
      <section className="shrink-0 px-5 pt-1.5">
        <HeroVisual />

        <div className="mt-4 text-center">
          <h2 className="text-[22px] font-extrabold tracking-tight text-white">Share Your Story</h2>
          <p className="mt-1 text-[10.5px] font-semibold uppercase tracking-[0.28em] text-[#dfbd55]">Moments · Thoughts · Vibes</p>
          <p className="mt-1.5 flex items-center justify-center gap-1.5 text-[11.5px] text-white/45">
            <Clock size={12} className="text-[#dfbd55]/80" aria-hidden="true" />
            It all disappears in 24 hours.
          </p>
        </div>
      </section>
{/* Choose Your Media */}
      <section className="min-h-0 flex-1 px-5 pt-3" aria-label="Choose your media">
        <div className="mb-1 flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-lg bg-[#c9a227]/14 text-[#dfbd55]">
            <Sparkles size={13} />
          </span>
          <h3 className="text-[15px] font-bold text-white">Choose Your Media</h3>
        </div>
        <p className="text-[10.5px] leading-4 text-white/40">Select one or more files to create your status</p>

        <div className="mt-2.5 space-y-2.5">
          {CREATE_STATUS_CHOICES.map((card, index) => {
            const selected = choice === card.id;
            return (
              <motion.button
                key={card.id}
                type="button"
                onClick={() => setChoice(card.id)}
                aria-pressed={selected}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.06 + index * 0.05, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className={cn(
                  'group flex min-h-[74px] w-full items-center gap-3 overflow-hidden rounded-2xl p-3 text-left transition active:scale-[0.99]',
                  selected
                    ? 'border-2 border-[#dfbd55] bg-white/[0.03] shadow-[0_0_22px_rgba(201,162,39,0.28)]'
                    : 'border border-white/[0.07] bg-white/[0.02] hover:border-white/[0.16] hover:bg-white/[0.05]'
                )}
              >
                <ChoiceTile card={card} selected={selected} />
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-[15px] font-semibold', selected ? 'text-white' : 'text-[#e8e8e8]')}>
                    {card.id === 'media' && (
                      <span className="mr-1.5 rounded-full bg-[#c9a227]/15 px-1.5 py-px text-[8.5px] font-bold uppercase tracking-wide text-[#dfbd55]">
                        Multiple
                      </span>
                    )}
                    {card.label}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-tight text-white/45">{card.description}</span>
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full border transition',
                    selected ? 'border-[#dfbd55] bg-[#c9a227] text-black' : 'border-white/[0.16] bg-transparent text-transparent'
                  )}
                >
                  <Check size={13} />
                </span>
              </motion.button>
            );
          })}
        </div>
      </section>

      {/* Next CTA — gold only when a choice is active */}
      <footer
        className="shrink-0 border-t border-white/[0.07] bg-[#0b0b0e]/95 px-4 pt-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + var(--vanta-kb, 0px) + 16px)' }}
      >
        <button
          type="button"
          onClick={() => choice && onPick(choice)}
          disabled={!choice}
          aria-label="Continue with selected media type"
          className={cn(
            'flex h-[52px] w-full items-center justify-center gap-2 rounded-xl text-[15px] font-bold transition active:scale-[0.99]',
            choice ? 'bg-[#c9a227] text-black hover:bg-[#dfbd55]' : 'bg-white/[0.05] text-white/35 cursor-not-allowed'
          )}
        >
          {choice ? 'Next' : 'Pick how to share'}
          <ChevronRight size={17} className={choice ? '' : 'opacity-40'} />
        </button>
      </footer>
    </div>
  );
}
/**
 * Layered presentation-only Story/Status cards. Purely visual (gradients +
 * icons) — never real user content; it communicates the "Stories" concept.
 */
function HeroVisual() {
  return (
    <div className="relative mx-auto h-[196px] w-full max-w-[312px]" aria-hidden="true">
      {/* Back card — video-style story */}
      <div className="absolute -left-7 top-3 h-[168px] w-[104px] -rotate-[11deg] rounded-2xl border border-white/[0.07] bg-gradient-to-b from-[#171318] to-[#0a0a0c] shadow-[0_14px_40px_rgba(0,0,0,0.55)]">
        <div className="absolute inset-x-0 top-0 h-[58%] bg-gradient-to-b from-[#6b4a2b]/70 via-[#3a2a18]/60 to-transparent" />
        <span className="absolute bottom-2.5 left-2 grid h-6 w-6 place-items-center rounded-full bg-black/55 text-[#dfbd55]">
          <Video size={11} />
        </span>
        <span className="absolute right-2 top-2 h-4 w-4 rounded-full border-2 border-[#dfbd55]/50" />
      </div>

      {/* Back card — photo-style story */}
      <div className="absolute -right-7 top-4 h-[160px] w-[96px] rotate-[11deg] rounded-2xl border border-white/[0.07] bg-gradient-to-b from-[#15202b] to-[#0a0a0c] shadow-[0_14px_40px_rgba(0,0,0,0.55)]">
        <div className="absolute inset-x-0 top-0 h-[54%] bg-gradient-to-b from-[#2b4a6b]/60 to-transparent" />
        <span className="absolute bottom-2.5 left-2 grid h-6 w-6 place-items-center rounded-full bg-black/55 text-[#dfbd55]">
          <ImageIcon size={11} />
        </span>
      </div>

      {/* Center — your Story card */}
      <div className="relative mx-auto flex h-[176px] w-[116px] flex-col items-center justify-center rounded-[20px] border border-white/[0.1] bg-gradient-to-b from-[#241a0a] via-[#140f07] to-[#080806] shadow-[0_16px_44px_rgba(0,0,0,0.65)]">
        <span className="absolute inset-x-3 top-2 h-px rounded-full bg-white/[0.14]" />
        <div className="absolute left-2.5 top-3 grid h-[26px] w-[26px] place-items-center rounded-full border-[2.5px] border-[#dfbd55]/70 bg-[#161210]">
          <span className="h-2.5 w-2.5 rounded-full bg-[#dfbd55]" />
        </div>
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#c9a227]/18 text-[#dfbd55]">
          <Sparkles size={22} className="drop-shadow-[0_0_8px_rgba(201,162,39,0.55)]" />
        </span>
        <span className="mt-2 text-[10px] font-bold tracking-[0.08em] text-[#e8e0c8]">YOUR STATUS</span>
        <span className="flex items-center gap-1 text-[8.5px] font-semibold text-white/40">
          <span className="h-1 w-1 rounded-full bg-[#dfbd55]/80" />
          stories · moments
        </span>
        <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full border border-[#c9a227]/45 bg-[#201a08]/90 px-1.5 py-0.5 text-[8px] font-bold text-[#dfbd55]">
          <Clock size={7.5} />
          24h
        </span>
      </div>
    </div>
  );
}

/** Small visual tile for each "Choose Your Media" card. */
function ChoiceTile({ card, selected }: { card: MenuChoiceCard; selected: boolean }) {
  if (card.id === 'media') {
    // Mini stacked-photo tile communicating multi-select.
    return (
      <span
        className={cn(
          'grid h-12 w-12 shrink-0 place-items-center rounded-xl border transition',
          selected ? 'border-[#dfbd55]/70 bg-[#c9a227]/14' : 'border-white/[0.1] bg-white/[0.03]'
        )}
      >
        <span className="relative flex -space-x-2">
          <span className="h-7 w-5 rounded-[4px] bg-gradient-to-b from-[#8a6a3f] to-[#3a2a18]" />
          <span className="h-7 w-5 rounded-[4px] bg-gradient-to-b from-[#3f5a7a] to-[#15202b]">
            <Video size={10} className="m-auto text-[#e8d9a8]" />
          </span>
          <span className="grid h-7 w-5 place-items-center rounded-[4px] border border-dashed border-[#dfbd55]/60 bg-black/30 text-[#dfbd55]">
            <Plus size={12} />
          </span>
        </span>
      </span>
    );
  }
  if (card.id === 'media-camera') {
    return (
      <span
        className={cn(
          'grid h-12 w-12 shrink-0 place-items-center rounded-xl border transition',
          selected ? 'border-[#dfbd55]/70 bg-[#c9a227]/14 text-[#dfbd55]' : 'border-white/[0.1] bg-white/[0.03] text-white/70'
        )}
      >
        <Camera size={24} />
      </span>
    );
  }
  return (
    <span
      className={cn(
        'grid h-12 w-12 shrink-0 place-items-center rounded-xl border transition',
        selected ? 'border-[#dfbd55]/70 bg-[#c9a227]/14 text-[#dfbd55]' : 'border-white/[0.1] bg-white/[0.03] text-white/70'
      )}
    >
      <MessagesSquare size={23} />
    </span>
  );
}