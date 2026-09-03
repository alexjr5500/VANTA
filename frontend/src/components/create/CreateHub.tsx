'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useContentCreation } from './ContentCreationContext';
import {
  Plus,
  ImagePlus,
  Clapperboard,
  Radio,
  X,
  Zap,
  HeartHandshake,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { canCreateFundraiser } from '@/lib/canCreateFundraiser';

interface CreateHubProps {
  open: boolean;
  onClose: () => void;
}

const creationOptions = [
  {
    id: 'post',
    icon: ImagePlus,
    label: 'Create Post',
    description: 'Text, photos, or video',
    accent: 'bg-[#f5f5f5] text-black',
  },
  {
    id: 'reel',
    icon: Clapperboard,
    label: 'Upload Reel',
    description: 'Publish vertical video',
    accent: 'bg-[#dce7ff] text-[#17264a]',
  },
  {
    id: 'livestream',
    icon: Radio,
    label: 'Go Live',
    description: 'Start a livestream',
    accent: 'bg-[#ffd9df] text-[#8e1831]',
  },
  {
    id: 'story',
    icon: Zap,
    label: 'Create Story',
    description: 'Share a moment',
    accent: 'bg-[#f2dfb1] text-[#5a3a00]',
  },
  {
    id: 'fundraiser',
    icon: HeartHandshake,
    label: 'Start Fundraiser',
    description: 'Raise for a cause',
    accent: 'bg-[#fdf0d0] text-[#5a3a00]',
  },
];

// Animation variants
const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

const modalVariants = {
  hidden: { opacity: 0, y: '100%' },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', damping: 30, stiffness: 320 } },
  exit: { opacity: 0, y: '100%', transition: { duration: 0.2, ease: 'easeIn' } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 15 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.05 + i * 0.03, duration: 0.3, ease: [0.16, 1, 0.3, 1] },
  }),
};

export default function CreateHub({ open, onClose }: CreateHubProps) {
  const router = useRouter();
  const { openPostModal, openStoryModal, openReelUploader } = useContentCreation();
  const { user } = useAuth();
  const fundraiserAllowed = canCreateFundraiser(user);
  const contextHint = { title: 'Create', subtitle: 'Choose how you want to share.' };

  const handleSelect = (option: typeof creationOptions[0]) => {
    onClose();

    switch (option.id) {
      case 'post':
        openPostModal();
        break;
      case 'story':
        openStoryModal();
        break;
      case 'reel':
        openReelUploader();
        break;
      case 'livestream':
        // Open the same LIVE Studio flow the "Go Live" button on the /live
        // page uses (reached from the menu). All Go Live entries stay in sync.
        router.push('/live/studio');
        break;
      case 'fundraiser':
        if (fundraiserAllowed) router.push('/give/start');
        break;
    }
  };

  React.useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, open]);

  return (
    <>
      <AnimatePresence>
        {open && (
          <>
          {/* Backdrop */}
          <motion.div
            id="vanta-create-hub"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vanta-create-title"
            className="fixed inset-0 z-[var(--z-modal-backdrop)] bg-black/72 backdrop-blur-sm"
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            className="fixed inset-x-0 bottom-0 z-[var(--z-modal)] mx-auto flex w-full max-w-[480px] flex-col"
            variants={modalVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <div className="flex max-h-[82dvh] flex-col overflow-hidden rounded-t-[20px] border border-b-0 border-white/[0.08] bg-[#0d0d0f]/98 pb-[env(safe-area-inset-bottom)] shadow-2xl backdrop-blur-2xl">
              <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-white/20" />
              {/* Header */}
              <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#d6a83f]">
                    <Plus size={18} className="text-black" />
                  </div>
                  <div>
                    <h2 id="vanta-create-title" className="text-lg font-semibold text-white">{contextHint.title}</h2>
                    <p className="text-xs text-white/45">{contextHint.subtitle}</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="rounded-xl p-2 text-gray-400 hover:text-white hover:bg-white/[0.05] transition"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Creation Options Grid */}
              <div className="flex-1 overflow-y-auto p-3">
                <div className="space-y-2">
                  {creationOptions.map((option, i) => {
                    const Icon = option.icon;
                    const isFundraiserLocked = option.id === 'fundraiser' && !fundraiserAllowed;
                    return (
                      <motion.button
                        key={option.id}
                        custom={i}
                        variants={itemVariants}
                        initial="hidden"
                        animate="visible"
                        onClick={() => !isFundraiserLocked && handleSelect(option)}
                        disabled={isFundraiserLocked}
                        title={isFundraiserLocked ? 'Verification required to create a fundraiser' : undefined}
                        className={cn(
                          'group relative flex min-h-[76px] w-full items-center gap-4 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5 text-left transition',
                          isFundraiserLocked
                            ? 'cursor-not-allowed opacity-50'
                            : 'hover:border-white/[0.16] hover:bg-white/[0.055] active:scale-[.99]'
                        )}
                      >
                        {/* Icon container */}
                        <div className={cn(
                          'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-105',
                          option.accent
                        )}>
                          <Icon size={21} />
                        </div>

                        {/* Label */}
                        <div className="min-w-0">
                          <p className="text-[15px] font-semibold text-white">{option.label}</p>
                          <p className="mt-0.5 text-xs text-white/45">
                            {isFundraiserLocked ? 'Verification required to create a fundraiser' : option.description}
                          </p>
                          {isFundraiserLocked && (
                            <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-[#f2c75c]">
                              <ShieldCheck size={11} /> Verify your account to start a fundraiser
                            </span>
                          )}
                        </div>

                      </motion.button>
                    );
                  })}
                </div>
              </div>

              {/* Footer */}
              <div className="flex shrink-0 items-center justify-between border-t border-white/[0.06] px-5 py-3">
                <p className="text-[11px] font-medium uppercase text-white/35">
                  <Zap size={11} className="mr-1 inline text-[#d6a83f]" />
                  Create anything
                </p>
                <button
                  onClick={onClose}
                  className="rounded-lg px-3 py-2 text-xs font-medium text-white/55 transition hover:bg-white/[0.05] hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
          </>
        )}
      </AnimatePresence>

    </>
  );
}