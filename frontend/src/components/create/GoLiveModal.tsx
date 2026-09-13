'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Radio, Image, Globe, Users, Lock, AlertCircle,
  Play, Settings, Monitor, Camera, Mic, MicOff, CameraOff, ArrowRight, ChevronDown, Check
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useContentCreation } from './ContentCreationContext';
import { uploadThumbnail, validateImageFile } from '@/lib/uploadService';

const CATEGORIES = [
  'Just Chatting',
  'Music',
  'Gaming',
  'Creative',
  'Sports',
  'Education',
  'Technology',
  'Lifestyle',
  'Travel',
  'Food & Drink',
];

const AUDIENCE_OPTIONS = [
  { id: 'everyone', label: 'Everyone', icon: Globe, description: 'Visible to everyone on VANTA' },
  { id: 'followers', label: 'Followers Only', icon: Users, description: 'Only your followers can join' },
  { id: 'private', label: 'Private', icon: Lock, description: 'Only people you invite can join' },
];

interface GoLiveModalProps {
  open: boolean;
  onClose: () => void;
}

export default function GoLiveModal({ open, onClose }: GoLiveModalProps) {
  const router = useRouter();
  const { user, token } = useAuth();
  const { closeAll, setLiveDraft } = useContentCreation();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [audience, setAudience] = useState('everyone');
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLDivElement>(null);

  const isValid = title.trim().length >= 3 && category;

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        if (showCategoryDropdown) setShowCategoryDropdown(false);
        else handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, showCategoryDropdown]);

  // Click outside category dropdown
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (categoryRef.current && !categoryRef.current.contains(e.target as Node)) {
        setShowCategoryDropdown(false);
      }
    };
    if (showCategoryDropdown) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [showCategoryDropdown]);

  const handleClose = useCallback(() => {
    setTitle('');
    setCategory('');
    setAudience('everyone');
    setThumbnail(null);
    setError(null);
    setShowCategoryDropdown(false);
    onClose();
    closeAll();
  }, [onClose, closeAll]);

  const handleThumbnailUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const validationError = validateImageFile(file, 'Thumbnail', 5 * 1024 * 1024);
      if (validationError) {
        setError(validationError);
        return;
      }
      setThumbnail(URL.createObjectURL(file));
      setError(null);
    }
  }, []);

  const handleStartLive = useCallback(async () => {
    if (!isValid) return;
    setIsStarting(true);
    setError(null);

    try {
      // Upload thumbnail if one was selected
      let thumbnailUrl: string | undefined;
      const thumbnailFile = fileInputRef.current?.files?.[0];
      if (thumbnailFile && token) {
        const thumbResult = await uploadThumbnail(thumbnailFile, token);
        if (thumbResult.url) {
          thumbnailUrl = thumbResult.url;
        } else if (thumbResult.error) {
          setError(thumbResult.error);
          setIsStarting(false);
          return;
        }
      }

      // Hand the setup (title, category, thumbnail) to the Studio via context
      // so nothing the user chose in the "+" modal is lost on navigation.
      setLiveDraft({
        title: title.trim(),
        category,
        thumbnailUrl,
      });

      // Navigate to the real Go Live broadcast flow which handles
      // camera/microphone permissions, preview, and LiveKit connection.
      handleClose();
      router.push('/live/go-live');
    } catch (err: any) {
      setError(err.message || 'Failed to start stream. Please check your connection and try again.');
      setIsStarting(false);
    }
  }, [isValid, title, category, handleClose, router, setLiveDraft]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => { if (!showCategoryDropdown) handleClose(); }}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] top-[max(12px,env(safe-area-inset-top))] z-[101] flex min-h-0 flex-col sm:inset-4"
            role="dialog"
            aria-modal="true"
            aria-label="Go live"
          >
            <div className="flex-1 flex flex-col rounded-3xl border border-white/[0.08] bg-[#0a0a0c]/97 backdrop-blur-3xl shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl border border-[#D6A83F]/40 bg-[#D6A83F]/15 flex items-center justify-center">
                    <Radio size={16} className="text-[#F2C75C]" />
                  </div>
                  <div>
                    <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#8A8A8A]">VANTA Live</p>
                    <h2 className="text-lg font-bold text-white">Go Live</h2>
                  </div>
                </div>
                <button
                  onClick={handleClose}
                  className="grid h-9 w-9 place-items-center rounded-xl border border-white/[0.1] bg-white/[0.04] text-white/60 hover:bg-white/[0.1] hover:text-white transition"
                  aria-label="Close go live"
                >
                  <X size={17} />
                </button>
              </div>

              {/* Body */}
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-hide">
                <div className="p-5 space-y-5">
                  {/* Stream preview placeholder */}
                  <div className="relative aspect-video rounded-2xl bg-gradient-to-br from-[#16161d] to-[#0a0a0c] border border-white/[0.07] overflow-hidden">
                    {thumbnail ? (
                      <img src={thumbnail} alt="Stream thumbnail" className="w-full h-full object-cover" />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-white/40">
                        <Monitor size={40} className="mb-2 opacity-30" />
                        <p className="text-sm font-medium">Stream Preview</p>
                        <p className="text-[10px] mt-1">Add a thumbnail to customize</p>
                      </div>
                    )}

                    {/* Stream status badge */}
                    <div className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full border border-[#D6A83F]/40 bg-black/60 backdrop-blur-md px-3 py-1.5">
                      <motion.span
                        className="h-2 w-2 rounded-full bg-[#F2C75C]"
                        animate={{ opacity: [1, 0.35, 1] }}
                        transition={{ duration: 1.2, repeat: Infinity }}
                        style={{ display: 'inline-block' }}
                      />
                      <span className="text-[10px] font-semibold text-[#F2C75C] uppercase tracking-wider">
                        {isStarting ? 'Connecting…' : 'Ready'}
                      </span>
                    </div>

                    {/* Camera/Mic controls — gold when enabled, rose when off */}
                    <div className="absolute bottom-3 right-3 flex items-center gap-2">
                      <button
                        onClick={() => setMicEnabled(!micEnabled)}
                        className={cn(
                          'grid h-9 w-9 place-items-center rounded-full border backdrop-blur-md transition-all active:scale-95',
                          micEnabled ? 'border-white/15 bg-white/[0.08] text-white' : 'bg-rose-500/30 text-rose-200 border-rose-400/30'
                        )}
                        aria-label={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
                      >
                        {micEnabled ? <Mic size={14} /> : <MicOff size={14} />}
                      </button>
                      <button
                        onClick={() => setCameraEnabled(!cameraEnabled)}
                        className={cn(
                          'grid h-9 w-9 place-items-center rounded-full border backdrop-blur-md transition-all active:scale-95',
                          cameraEnabled ? 'border-white/15 bg-white/[0.08] text-white' : 'bg-rose-500/30 text-rose-200 border-rose-400/30'
                        )}
                        aria-label={cameraEnabled ? 'Disable camera' : 'Enable camera'}
                      >
                        {cameraEnabled ? <Camera size={14} /> : <CameraOff size={14} />}
                      </button>
                    </div>
                  </div>

                  {/* Stream title */}
                  <div>
                    <label htmlFor="stream-title" className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-white/45 mb-1.5">
                      Stream Title
                    </label>
                    <input
                      id="stream-title"
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Give your stream a catchy title..."
                      className="w-full rounded-2xl border border-white/[0.09] bg-black/30 px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#D6A83F]/45 focus:bg-white/[0.03] transition-all"
                      maxLength={120}
                      aria-label="Stream title"
                    />
                    <p className="text-[10px] text-white/30 mt-1 text-right tabular-nums">{title.length}/120</p>
                  </div>

                  {/* Category selector */}
                  <div className="relative" ref={categoryRef}>
                    <label className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-white/45 mb-1.5">
                      Category
                    </label>
                    <button
                      onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
                      className={cn(
                        'w-full rounded-2xl border px-4 py-3 text-sm text-left transition-all',
                        showCategoryDropdown
                          ? 'border-[#D6A83F]/45 bg-white/[0.05] text-white'
                          : 'border-white/[0.09] bg-black/30 text-white/55 hover:text-white hover:bg-white/[0.04]'
                      )}
                      aria-label="Select stream category"
                      aria-expanded={showCategoryDropdown}
                    >
                      <span className="flex items-center justify-between">
                        <span>{category || 'Select a category'}</span>
                        <ChevronDown size={14} className="text-white/40" />
                      </span>
                    </button>

                    <AnimatePresence>
                      {showCategoryDropdown && (
                        <motion.div
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          className="absolute z-20 mt-1 w-full rounded-2xl border border-white/[0.09] bg-[#0a0a0c] backdrop-blur-3xl shadow-2xl overflow-hidden"
                        >
                          <div className="max-h-[200px] overflow-y-auto scrollbar-hide p-1">
                            {CATEGORIES.map((cat) => (
                              <button
                                key={cat}
                                onClick={() => { setCategory(cat); setShowCategoryDropdown(false); }}
                                className={cn(
                                  'w-full text-left px-4 py-2.5 text-sm rounded-xl transition',
                                  category === cat
                                    ? 'bg-[#D6A83F]/15 text-white'
                                    : 'text-white/60 hover:bg-white/[0.05] hover:text-white'
                                )}
                              >
                                <span className="flex items-center gap-2">
                                  {cat}
                                  {category === cat && <Check size={13} className="text-[#F2C75C]" />}
                                </span>
                              </button>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Thumbnail upload */}
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-white/45 mb-1.5">
                      Thumbnail
                    </label>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className={cn(
                        'w-full rounded-2xl border-2 border-dashed p-4 text-center transition-all',
                        thumbnail
                          ? 'border-emerald-500/35 bg-emerald-500/10'
                          : 'border-white/[0.08] hover:border-[#D6A83F]/30 hover:bg-white/[0.02]'
                      )}
                      aria-label="Upload thumbnail"
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={handleThumbnailUpload}
                        aria-hidden="true"
                      />
                      {thumbnail ? (
                        <div className="flex items-center justify-center gap-2">
                          <Check size={16} className="text-emerald-400" />
                          <span className="text-sm text-emerald-400">Thumbnail uploaded</span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-2">
                          <Image size={16} className="text-white/40" />
                          <span className="text-sm text-white/40">Upload thumbnail (optional)</span>
                        </div>
                      )}
                    </button>
                  </div>

                  {/* Audience settings */}
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-white/45 mb-2">
                      Audience
                    </label>
                    <div className="grid gap-2">
                      {AUDIENCE_OPTIONS.map((option) => {
                        const Icon = option.icon;
                        const isSelected = audience === option.id;
                        return (
                          <button
                            key={option.id}
                            onClick={() => setAudience(option.id)}
                            className={cn(
                              'flex items-center gap-3 rounded-2xl border p-3.5 text-left transition-all active:scale-[0.99]',
                              isSelected
                                ? 'border-[#D6A83F]/45 bg-[#D6A83F]/10'
                                : 'border-white/[0.08] bg-white/[0.02] hover:border-white/[0.14] hover:bg-white/[0.04]'
                            )}
                            aria-label={`Set audience to ${option.label}`}
                            aria-pressed={isSelected}
                          >
                            <div className={cn(
                              'w-9 h-9 rounded-xl flex items-center justify-center',
                              isSelected ? 'bg-[#D6A83F]/20 text-[#F2C75C]' : 'bg-white/[0.05] text-white/45'
                            )}>
                              <Icon size={16} />
                            </div>
                            <div>
                              <p className={cn(
                                'text-sm font-medium',
                                isSelected ? 'text-white' : 'text-white/70'
                              )}>
                                {option.label}
                              </p>
                              <p className="text-[10px] text-white/40">{option.description}</p>
                            </div>
                            {isSelected && (
                              <div className="ml-auto grid h-5 w-5 place-items-center rounded-full bg-[#D6A83F]">
                                <Check size={12} className="text-black" strokeWidth={3} />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Error */}
                  <AnimatePresence>
                    {error && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="flex items-center gap-2 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-xs text-rose-300"
                      >
                        <AlertCircle size={14} className="shrink-0" />
                        <span>{error}</span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Footer */}
              <div className="shrink-0 border-t border-white/[0.06] px-5 py-4 pb-[max(16px,env(safe-area-inset-bottom))]">
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleClose}
                    className="flex-1 rounded-2xl border border-white/[0.09] bg-white/[0.04] py-3 text-sm font-medium text-white/70 hover:text-white hover:bg-white/[0.08] transition"
                  >
                    Cancel
                  </button>
                  <motion.button
                    onClick={handleStartLive}
                    disabled={!isValid || isStarting}
                    whileTap={{ scale: 0.97 }}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold transition-all duration-200',
                      isValid && !isStarting
                        ? 'bg-gradient-to-r from-[#D6A83F] to-[#F2C75C] text-black shadow-[0_8px_28px_rgba(214,168,63,0.28)] hover:brightness-105'
                        : 'bg-white/[0.05] text-white/35 cursor-not-allowed'
                    )}
                    aria-label="Start live stream"
                  >
                    {isStarting ? (
                      <>
                        <span className="h-4 w-4 rounded-full border-2 border-black/25 border-t-black animate-spin" />
                        Starting…
                      </>
                    ) : (
                      <>
                        <Play size={16} fill="currentColor" />
                        Start Live
                      </>
                    )}
                  </motion.button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}