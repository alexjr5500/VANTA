'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Radio, Image, Globe, Users, Lock, AlertCircle,
  Play, Settings, Monitor, Camera, Mic, MicOff, CameraOff, ArrowRight
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
            <div className="flex-1 flex flex-col rounded-3xl border border-white/[0.08] bg-[#0e0e16]/95 backdrop-blur-2xl shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center">
                    <Radio size={16} className="text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white">Go Live</h2>
                    <p className="text-[10px] text-gray-500">Start streaming to your audience</p>
                  </div>
                </div>
                <button
                  onClick={handleClose}
                  className="rounded-xl p-2 text-gray-400 hover:text-white hover:bg-white/[0.05] transition"
                  aria-label="Close go live"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Body */}
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-hide">
                <div className="p-5 space-y-5">
                  {/* Stream preview placeholder */}
                  <div className="relative aspect-video rounded-2xl bg-gradient-to-br from-[#1a1a28] to-[#0e0e16] border border-white/[0.06] overflow-hidden">
                    {thumbnail ? (
                      <img src={thumbnail} alt="Stream thumbnail" className="w-full h-full object-cover" />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
                        <Monitor size={40} className="mb-2 opacity-30" />
                        <p className="text-sm font-medium">Stream Preview</p>
                        <p className="text-[10px] mt-1">Add a thumbnail to customize</p>
                      </div>
                    )}

                    {/* Stream status badge */}
                    <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#f2c75c] animate-pulse" />
                      <span className="text-[10px] font-semibold text-white uppercase tracking-wider">
                        {isStarting ? 'Connecting...' : 'Ready'}
                      </span>
                    </div>

                    {/* Camera/Mic controls */}
                    <div className="absolute bottom-3 right-3 flex items-center gap-2">
                      <button
                        onClick={() => setMicEnabled(!micEnabled)}
                        className={cn(
                          'rounded-xl p-2.5 backdrop-blur-sm transition-all',
                          micEnabled ? 'bg-white/10 text-white' : 'bg-red-500/30 text-red-300'
                        )}
                        aria-label={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
                      >
                        {micEnabled ? <Mic size={14} /> : <MicOff size={14} />}
                      </button>
                      <button
                        onClick={() => setCameraEnabled(!cameraEnabled)}
                        className={cn(
                          'rounded-xl p-2.5 backdrop-blur-sm transition-all',
                          cameraEnabled ? 'bg-white/10 text-white' : 'bg-red-500/30 text-red-300'
                        )}
                        aria-label={cameraEnabled ? 'Disable camera' : 'Enable camera'}
                      >
                        {cameraEnabled ? <Camera size={14} /> : <CameraOff size={14} />}
                      </button>
                    </div>
                  </div>

                  {/* Stream title */}
                  <div>
                    <label htmlFor="stream-title" className="block text-xs font-medium text-gray-400 mb-1.5">
                      Stream Title
                    </label>
                    <input
                      id="stream-title"
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Give your stream a catchy title..."
                      className="w-full rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-white/20 focus:bg-white/[0.05] transition-all"
                      maxLength={120}
                      aria-label="Stream title"
                    />
                    <p className="text-[10px] text-gray-600 mt-1 text-right">{title.length}/120</p>
                  </div>

                  {/* Category selector */}
                  <div className="relative" ref={categoryRef}>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">
                      Category
                    </label>
                    <button
                      onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
                      className={cn(
                        'w-full rounded-2xl border px-4 py-3 text-sm text-left transition-all',
                        showCategoryDropdown
                          ? 'border-white/20 bg-white/[0.06] text-white'
                          : 'border-white/[0.08] bg-white/[0.03] text-gray-400 hover:text-white hover:bg-white/[0.05]'
                      )}
                      aria-label="Select stream category"
                      aria-expanded={showCategoryDropdown}
                    >
                      {category || 'Select a category'}
                    </button>

                    <AnimatePresence>
                      {showCategoryDropdown && (
                        <motion.div
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          className="absolute z-20 mt-1 w-full rounded-2xl border border-white/[0.08] bg-[#0e0e16] backdrop-blur-2xl shadow-2xl overflow-hidden"
                        >
                          <div className="max-h-[200px] overflow-y-auto scrollbar-hide p-1">
                            {CATEGORIES.map((cat) => (
                              <button
                                key={cat}
                                onClick={() => { setCategory(cat); setShowCategoryDropdown(false); }}
                                className={cn(
                                  'w-full text-left px-4 py-2.5 text-sm rounded-xl transition',
                                  category === cat
                                    ? 'bg-white/[0.1] text-white'
                                    : 'text-gray-300 hover:bg-white/[0.04] hover:text-white'
                                )}
                              >
                                {cat}
                              </button>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Thumbnail upload */}
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">
                      Thumbnail
                    </label>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className={cn(
                        'w-full rounded-2xl border-2 border-dashed p-4 text-center transition-all',
                        thumbnail
                          ? 'border-emerald-500/30 bg-emerald-500/5'
                          : 'border-white/[0.06] hover:border-white/[0.15] hover:bg-white/[0.02]'
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
                          <Image size={16} className="text-emerald-400" />
                          <span className="text-sm text-emerald-400">Thumbnail uploaded</span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-2">
                          <Image size={16} className="text-gray-500" />
                          <span className="text-sm text-gray-500">Upload thumbnail (optional)</span>
                        </div>
                      )}
                    </button>
                  </div>

                  {/* Audience settings */}
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-2">
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
                              'flex items-center gap-3 rounded-2xl border p-3.5 text-left transition-all',
                              isSelected
                                ? 'border-white/20 bg-white/[0.06]'
                                : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]'
                            )}
                            aria-label={`Set audience to ${option.label}`}
                          >
                            <div className={cn(
                              'w-9 h-9 rounded-xl flex items-center justify-center',
                              isSelected ? 'bg-white/[0.15] text-white' : 'bg-white/[0.04] text-gray-400'
                            )}>
                              <Icon size={16} />
                            </div>
                            <div>
                              <p className={cn(
                                'text-sm font-medium',
                                isSelected ? 'text-white' : 'text-gray-300'
                              )}>
                                {option.label}
                              </p>
                              <p className="text-[10px] text-gray-500">{option.description}</p>
                            </div>
                            {isSelected && (
                              <div className="ml-auto w-5 h-5 rounded-full bg-white flex items-center justify-center">
                                <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                                  <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
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
                        className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 rounded-xl px-4 py-3"
                      >
                        <AlertCircle size={14} />
                        {error}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Footer */}
              <div className="shrink-0 border-t border-white/[0.06] px-5 py-4">
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleClose}
                    className="flex-1 rounded-2xl border border-white/[0.06] bg-white/[0.04] py-3 text-sm font-medium text-gray-300 hover:text-white hover:bg-white/[0.08] transition"
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
                        ? 'bg-[#f5f5f5] text-black shadow-[0_4px_20px_rgba(255,255,255,0.1)] hover:bg-white'
                        : 'bg-white/[0.05] text-gray-500 cursor-not-allowed'
                    )}
                    aria-label="Start live stream"
                  >
                    {isStarting ? (
                      <>
                        <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        Starting...
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