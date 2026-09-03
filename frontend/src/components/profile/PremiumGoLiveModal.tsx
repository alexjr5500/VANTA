'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Radio, Image, Globe, Users, Lock, AlertCircle,
  Play, Settings, Monitor, Camera, Mic, MicOff, CameraOff,
  Wand2, Sparkles, Gift, DollarSign, Clock, Shield, MessageCircle,
  Heart, Share2, ChevronRight, ChevronLeft, Check, Loader2,
  Music, Gamepad2, Palette, BookOpen, Trophy, Smartphone,
  Video, Tv, Star
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { apiPost } from '@/lib/apiClient';
import { uploadThumbnail, validateImageFile } from '@/lib/uploadService';

interface PremiumGoLiveModalProps {
  open: boolean;
  onClose: () => void;
}

const STEPS = [
  { id: 'setup', label: 'Setup', icon: Settings },
  { id: 'preview', label: 'Preview', icon: Camera },
  { id: 'monetize', label: 'Monetize', icon: DollarSign },
  { id: 'review', label: 'Review', icon: Check },
];

const CATEGORIES = [
  { id: 'chatting', label: 'Just Chatting', icon: MessageCircle },
  { id: 'music', label: 'Music', icon: Music },
  { id: 'gaming', label: 'Gaming', icon: Gamepad2 },
  { id: 'creative', label: 'Creative', icon: Palette },
  { id: 'education', label: 'Education', icon: BookOpen },
  { id: 'sports', label: 'Sports', icon: Trophy },
  { id: 'tech', label: 'Technology', icon: Monitor },
  { id: 'lifestyle', label: 'Lifestyle', icon: Heart },
  { id: 'mobile', label: 'Mobile', icon: Smartphone },
];

const LANGUAGES = ['English', 'Spanish', 'French', 'German', 'Portuguese', 'Arabic', 'Japanese', 'Korean', 'Chinese'];

export default function PremiumGoLiveModal({ open, onClose }: PremiumGoLiveModalProps) {
  const { token } = useAuth();
  const [currentStep, setCurrentStep] = useState(0);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [language, setLanguage] = useState('English');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [audience, setAudience] = useState('everyone');
  const [visibility, setVisibility] = useState('public');
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const [screenShare, setScreenShare] = useState(false);
  const [backgroundBlur, setBackgroundBlur] = useState(false);
  const [noiseSuppression, setNoiseSuppression] = useState(true);
  const [echoCancellation, setEchoCancellation] = useState(true);
  const [beautyFilter, setBeautyFilter] = useState(false);
  const [enableGifts, setEnableGifts] = useState(true);
  const [enableSubs, setEnableSubs] = useState(true);
  const [enableDonations, setEnableDonations] = useState(true);
  const [enableRecording, setEnableRecording] = useState(true);
  const [ageRestriction, setAgeRestriction] = useState('none');
  const [chatMode, setChatMode] = useState('normal');
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isValid = title.trim().length >= 3 && category;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        if (currentStep > 0) setCurrentStep(prev => prev - 1);
        else handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, currentStep]);

  useEffect(() => {
    if (countdown === null || countdown < 0) return;
    if (countdown === 0) {
      setIsStarting(false);
      setCountdown(null);
      handleClose();
      return;
    }
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleClose = useCallback(() => {
    setCurrentStep(0);
    setTitle('');
    setDescription('');
    setCategory('');
    setTags([]);
    if (thumbnail) URL.revokeObjectURL(thumbnail);
    setThumbnail(null);
    setError(null);
    setCountdown(null);
    setIsStarting(false);
    onClose();
  }, [onClose, thumbnail]);

  const addTag = () => {
    const trimmed = tagInput.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed) && tags.length < 5) {
      setTags([...tags, trimmed]);
      setTagInput('');
    }
  };

  const removeTag = (tag: string) => setTags(tags.filter(t => t !== tag));

  const handleStartLive = useCallback(async () => {
    if (!isValid) return;
    setIsStarting(true);
    setError(null);
    try {
      let thumbnailUrl: string | undefined;
      const file = fileInputRef.current?.files?.[0];
      if (file) {
        if (!token) throw new Error('Please sign in to upload a thumbnail.');
        const uploaded = await uploadThumbnail(file, token);
        if (!uploaded.url) throw new Error(uploaded.error || 'Thumbnail upload failed');
        thumbnailUrl = uploaded.url;
      }
      await apiPost('/api/live/start', {
        title: title.trim(), description: description.trim(), category,
        thumbnailUrl, allowGifts: enableGifts, allowPK: false,
      }, token ?? undefined);
      setCountdown(3);
    } catch (cause) {
      setIsStarting(false);
      setError(cause instanceof Error ? cause.message : 'Could not start the stream.');
    }
  }, [isValid, token, title, description, category, enableGifts]);

  const stepVariants = {
    enter: { opacity: 0, x: 50 },
    center: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -50 },
  };

  const toggleButton = (value: boolean, setter: (v: boolean) => void, label: string) => (
    <button
      onClick={() => setter(!value)}
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-xl text-xs transition-all border',
        value ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-white/[0.03] border-white/[0.06] text-gray-400 hover:text-white'
      )}
    >
      <div className={cn('w-3 h-3 rounded-full border transition-colors', value ? 'bg-emerald-400 border-emerald-400' : 'border-white/20')} />
      {label}
    </button>
  );

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-lg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => currentStep === 0 && handleClose()}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 30 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-x-3 top-[max(12px,env(safe-area-inset-top))] bottom-[max(12px,env(safe-area-inset-bottom))] z-[101] flex min-h-0 flex-col sm:inset-4"
            role="dialog"
            aria-modal="true"
            aria-label="Go live"
          >
            <div className="flex-1 flex flex-col rounded-3xl border border-white/[0.08] bg-[#0e0e16]/95 backdrop-blur-2xl shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#f2c75c] to-[#d6a83f] flex items-center justify-center shadow-lg shadow-[#d6a83f]/20">
                    <Radio size={16} className="text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white">Go Live</h2>
                    <p className="text-[10px] text-gray-500">Start streaming to your audience</p>
                  </div>
                </div>
                <button onClick={handleClose} className="rounded-xl p-2 text-gray-400 hover:text-white hover:bg-white/[0.05] transition" aria-label="Close">
                  <X size={18} />
                </button>
              </div>

              {/* Steps */}
              <div className="px-6 pt-4 pb-2">
                <div className="flex items-center gap-2">
                  {STEPS.map((step, i) => {
                    const StepIcon = step.icon;
                    const isActive = i === currentStep;
                    const isComplete = i < currentStep;
                    return (
                      <div key={step.id} className="flex items-center gap-2 flex-1">
                        <div className={cn(
                          'flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium transition-all',
                          isActive ? 'bg-[#d6a83f]/10 text-[#d6a83f] border border-[#d6a83f]/20' : 
                          isComplete ? 'bg-emerald-500/10 text-emerald-400' : 'text-gray-500'
                        )}>
                          <StepIcon size={12} />
                          <span className="hidden ">{step.label}</span>
                        </div>
                        {i < STEPS.length - 1 && (
                          <div className={cn('flex-1 h-px transition-all', isComplete ? 'bg-emerald-500/30' : 'bg-white/[0.06]')} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto scrollbar-hide px-6 py-4">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={currentStep}
                    variants={stepVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  >
                    {/* Step 1: Setup */}
                    {currentStep === 0 && (
                      <div className="space-y-5">
                        <div>
                          <label className="block text-xs font-medium text-gray-400 mb-2">Stream Thumbnail</label>
                          <button
                            onClick={() => fileInputRef.current?.click()}
                            className={cn(
                              'w-full aspect-video rounded-2xl border-2 border-dashed transition-all overflow-hidden',
                              thumbnail ? 'border-emerald-500/30' : 'border-white/[0.06] hover:border-white/[0.15] hover:bg-white/[0.02]'
                            )}
                          >
                            {thumbnail ? (
                              <img src={thumbnail} alt="Thumbnail" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex flex-col items-center justify-center text-gray-500">
                                <Image size={28} className="mb-2 opacity-40" />
                                <p className="text-xs font-medium">Upload Thumbnail</p>
                                <p className="text-[10px] mt-1">1920x1080 recommended</p>
                              </div>
                            )}
                          </button>
                          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const validationError = validateImageFile(file, 'Thumbnail', 5 * 1024 * 1024);
                              if (validationError) { setError(validationError); e.target.value = ''; return; }
                              if (thumbnail) URL.revokeObjectURL(thumbnail);
                              setThumbnail(URL.createObjectURL(file)); setError(null);
                            }
                          }} />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-400 mb-1.5">Stream Title</label>
                          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Give your stream a catchy title..." className="w-full rounded-2xl border border-white/[0.06] bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#d6a83f]/30 transition-all" maxLength={120} />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-400 mb-1.5">Description</label>
                          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Tell viewers what your stream is about..." className="w-full rounded-2xl border border-white/[0.06] bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#d6a83f]/30 transition-all resize-none" maxLength={500} />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-400 mb-1.5">Category</label>
                          <div className="grid grid-cols-3  gap-2">
                            {CATEGORIES.map(cat => {
                              const CatIcon = cat.icon;
                              const isSelected = category === cat.id;
                              return (
                                <button
                                  key={cat.id}
                                  onClick={() => setCategory(cat.id)}
                                  className={cn(
                                    'flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs transition-all',
                                    isSelected ? 'border-[#d6a83f]/30 bg-[#d6a83f]/5 text-[#d6a83f]' : 'border-white/[0.06] bg-white/[0.03] text-gray-400 hover:text-white hover:bg-white/[0.05]'
                                  )}
                                >
                                  <CatIcon size={16} />
                                  <span className="text-[10px]">{cat.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-medium text-gray-400 mb-1.5">Language</label>
                            <select value={language} onChange={e => setLanguage(e.target.value)} className="w-full rounded-2xl border border-white/[0.06] bg-white/[0.04] px-4 py-3 text-sm text-white focus:outline-none focus:border-[#d6a83f]/30 transition-all">
                              {LANGUAGES.map(lang => <option key={lang} value={lang}>{lang}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-400 mb-1.5">Visibility</label>
                            <div className="flex gap-2">
                              {['public', 'unlisted'].map(v => (
                                <button key={v} onClick={() => setVisibility(v)} className={cn(
                                  'flex-1 rounded-xl border py-2 text-xs font-medium transition-all',
                                  visibility === v ? 'border-[#d6a83f]/30 bg-[#d6a83f]/5 text-[#d6a83f]' : 'border-white/[0.06] text-gray-400 hover:text-white'
                                )}>
                                  {v.charAt(0).toUpperCase() + v.slice(1)}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-400 mb-1.5">Tags (up to 5)</label>
                          <div className="flex items-center gap-2 flex-wrap mb-2">
                            {tags.map(tag => (
                              <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#d6a83f]/10 border border-[#d6a83f]/20 text-[10px] text-[#d6a83f]">
                                #{tag}
                                <button onClick={() => removeTag(tag)} className="hover:text-white">&times;</button>
                              </span>
                            ))}
                          </div>
                          <div className="flex gap-2">
                            <input value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())} placeholder="Add a tag..." className="flex-1 rounded-2xl border border-white/[0.06] bg-white/[0.04] px-4 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#d6a83f]/30 transition-all" maxLength={20} />
                            <button onClick={addTag} disabled={!tagInput.trim() || tags.length >= 5} className="px-4 py-2.5 rounded-2xl bg-[#d6a83f]/10 border border-[#d6a83f]/20 text-[#d6a83f] text-sm font-medium hover:bg-[#d6a83f]/20 transition disabled:opacity-50">Add</button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Step 2: Preview */}
                    {currentStep === 1 && (
                      <div className="space-y-5">
                        <div className="relative aspect-video rounded-2xl bg-gradient-to-br from-[#1a1a28] to-[#0e0e16] border border-white/[0.06] overflow-hidden">
                          {thumbnail ? (
                            <img src={thumbnail} alt="Preview" className="w-full h-full object-cover" />
                          ) : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
                              <Camera size={40} className="mb-2 opacity-30" />
                              <p className="text-sm font-medium">Camera Preview</p>
                            </div>
                          )}
                          <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1.5">
                            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                            <span className="text-[10px] font-bold text-white uppercase tracking-wider">Preview</span>
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-400 mb-2">Devices</label>
                          <div className="grid grid-cols-2 gap-2">
                            {toggleButton(cameraEnabled, setCameraEnabled, 'Camera')}
                            {toggleButton(micEnabled, setMicEnabled, 'Microphone')}
                            {toggleButton(screenShare, setScreenShare, 'Screen Share')}
                            {toggleButton(backgroundBlur, setBackgroundBlur, 'Background Blur')}
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-400 mb-2">Audio</label>
                          <div className="grid grid-cols-2 gap-2">
                            {toggleButton(noiseSuppression, setNoiseSuppression, 'Noise Suppression')}
                            {toggleButton(echoCancellation, setEchoCancellation, 'Echo Cancel')}
                            {toggleButton(beautyFilter, setBeautyFilter, 'Beauty Filter')}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Step 3: Monetize */}
                    {currentStep === 2 && (
                      <div className="space-y-5">
                        <div>
                          <label className="block text-xs font-medium text-gray-400 mb-2">Monetisation</label>
                          <div className="space-y-2">
                            {[
                              { id: 'gifts', label: 'Enable Gifts', desc: 'Allow viewers to send gifts', state: enableGifts, set: setEnableGifts, icon: Gift },
                              { id: 'subs', label: 'Enable Subscribers', desc: 'Allow viewers to subscribe', state: enableSubs, set: setEnableSubs, icon: Star },
                              { id: 'donations', label: 'Enable Donations', desc: 'Allow one-time donations', state: enableDonations, set: setEnableDonations, icon: DollarSign },
                              { id: 'recording', label: 'Enable Recording', desc: 'Auto-record this stream', state: enableRecording, set: setEnableRecording, icon: Video },
                            ].map(item => (
                              <button
                                key={item.id}
                                onClick={() => item.set(!item.state)}
                                className={cn(
                                  'w-full flex items-center gap-3 rounded-2xl border p-3.5 text-left transition-all',
                                  item.state ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.05]'
                                )}
                              >
                                <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center', item.state ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/[0.05] text-gray-400')}>
                                  <item.icon size={16} />
                                </div>
                                <div className="flex-1">
                                  <p className={cn('text-sm font-medium', item.state ? 'text-white' : 'text-gray-300')}>{item.label}</p>
                                  <p className="text-[10px] text-gray-500">{item.desc}</p>
                                </div>
                                <div className={cn('w-5 h-5 rounded border-2 flex items-center justify-center', item.state ? 'bg-emerald-500 border-emerald-500' : 'border-white/20')}>
                                  {item.state && <Check size={12} className="text-white" strokeWidth={3} />}
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-400 mb-1.5">Age Restriction</label>
                          <div className="flex gap-2">
                            {['none', '13+', '18+'].map(age => (
                              <button key={age} onClick={() => setAgeRestriction(age)} className={cn(
                                'flex-1 rounded-xl border py-2 text-xs font-medium transition-all',
                                ageRestriction === age ? 'border-[#d6a83f]/30 bg-[#d6a83f]/5 text-[#d6a83f]' : 'border-white/[0.06] text-gray-400 hover:text-white'
                              )}>{age === 'none' ? 'All Ages' : age}</button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-gray-400 mb-1.5">Chat Mode</label>
                          <div className="flex gap-2">
                            {[
                              { id: 'normal', label: 'Normal' },
                              { id: 'slow', label: 'Slow Mode' },
                              { id: 'subs', label: 'Subs Only' },
                              { id: 'emotes', label: 'Emote Only' },
                            ].map(mode => (
                              <button key={mode.id} onClick={() => setChatMode(mode.id)} className={cn(
                                'flex-1 rounded-xl border py-2 text-xs font-medium transition-all',
                                chatMode === mode.id ? 'border-[#d6a83f]/30 bg-[#d6a83f]/5 text-[#d6a83f]' : 'border-white/[0.06] text-gray-400 hover:text-white'
                              )}>{mode.label}</button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Step 4: Review */}
                    {currentStep === 3 && (
                      <div className="space-y-5">
                        <div className="rounded-2xl bg-gradient-to-br from-emerald-500/5 to-[#151517]0/5 border border-emerald-500/15 p-4">
                          <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                              <Check size={20} className="text-emerald-400" />
                            </div>
                            <div>
                              <p className="text-sm font-bold text-white">Ready to Stream</p>
                              <p className="text-[10px] text-emerald-400/60">All settings configured</p>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-xs py-1.5 border-b border-white/[0.04]">
                              <span className="text-gray-400">Title</span>
                              <span className="text-white font-medium truncate ml-4 max-w-[200px]">{title}</span>
                            </div>
                            <div className="flex items-center justify-between text-xs py-1.5 border-b border-white/[0.04]">
                              <span className="text-gray-400">Category</span>
                              <span className="text-white font-medium">{CATEGORIES.find(c => c.id === category)?.label || category}</span>
                            </div>
                            <div className="flex items-center justify-between text-xs py-1.5 border-b border-white/[0.04]">
                              <span className="text-gray-400">Language</span>
                              <span className="text-white font-medium">{language}</span>
                            </div>
                            <div className="flex items-center justify-between text-xs py-1.5 border-b border-white/[0.04]">
                              <span className="text-gray-400">Visibility</span>
                              <span className="text-white font-medium capitalize">{visibility}</span>
                            </div>
                            <div className="flex items-center justify-between text-xs py-1.5 border-b border-white/[0.04]">
                              <span className="text-gray-400">Monetisation</span>
                              <span className="text-white font-medium">{enableGifts || enableSubs || enableDonations ? 'Enabled' : 'None'}</span>
                            </div>
                          </div>
                        </div>

                        {/* Quality Estimates */}
                        <div className="grid grid-cols-2 gap-3">
                          {[
                            { label: 'Estimated Quality', value: 'Excellent', color: 'text-emerald-400' },
                            { label: 'Internet Speed', value: 'Stable', color: 'text-emerald-400' },
                            { label: 'Camera', value: cameraEnabled ? 'Connected' : 'Disabled', color: cameraEnabled ? 'text-emerald-400' : 'text-gray-400' },
                            { label: 'Audio', value: micEnabled ? 'Connected' : 'Disabled', color: micEnabled ? 'text-emerald-400' : 'text-gray-400' },
                          ].map(item => (
                            <div key={item.label} className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-3">
                              <p className="text-[10px] text-gray-500">{item.label}</p>
                              <p className={cn('text-sm font-bold mt-0.5', item.color)}>{item.value}</p>
                            </div>
                          ))}
                        </div>

                        {/* Checklist */}
                        <div className="space-y-1.5">
                          {[
                            { label: 'Stream title set', done: title.length >= 3 },
                            { label: 'Category selected', done: !!category },
                            { label: 'Camera ready', done: cameraEnabled },
                            { label: 'Microphone ready', done: micEnabled },
                            { label: 'Tags added', done: tags.length > 0 },
                          ].map(item => (
                            <div key={item.label} className="flex items-center gap-2 text-xs">
                              <div className={cn('w-4 h-4 rounded-full flex items-center justify-center', item.done ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/[0.04] text-gray-500')}>
                                {item.done ? <Check size={10} strokeWidth={3} /> : <div className="w-1.5 h-1.5 rounded-full bg-white/20" />}
                              </div>
                              <span className={item.done ? 'text-white/60' : 'text-gray-500'}>{item.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* Footer */}
              <div className="shrink-0 border-t border-white/[0.06] px-6 py-4">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => currentStep > 0 ? setCurrentStep(prev => prev - 1) : handleClose()}
                    className="flex items-center gap-1.5 rounded-2xl border border-white/[0.06] bg-white/[0.04] px-4 py-2.5 text-sm text-gray-300 hover:text-white hover:bg-white/[0.08] transition"
                  >
                    <ChevronLeft size={14} />
                    {currentStep > 0 ? 'Back' : 'Cancel'}
                  </button>

                  <div className="flex items-center gap-3">
                    {currentStep < STEPS.length - 1 ? (
                      <button
                        onClick={() => setCurrentStep(prev => prev + 1)}
                        className="flex items-center gap-1.5 rounded-2xl bg-gradient-to-r from-[#d6a83f] to-[#c8c8cc] px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-[#d6a83f]/20 hover:shadow-[#d6a83f]/30 transition"
                      >
                        Continue
                        <ChevronRight size={14} />
                      </button>
                    ) : (
                      <motion.button
                        onClick={handleStartLive}
                        disabled={!isValid || isStarting}
                        whileTap={{ scale: 0.97 }}
                        className={cn(
                          'flex items-center gap-2 rounded-2xl px-6 py-3 text-sm font-bold transition-all',
                          isValid && !isStarting
                            ? 'bg-gradient-to-r from-[#f2c75c] to-[#d6a83f] text-white shadow-[0_4px_20px_rgba(255,0,127,0.3)] hover:shadow-[0_6px_30px_rgba(255,0,127,0.4)]'
                            : 'bg-white/[0.05] text-gray-500 cursor-not-allowed'
                        )}
                      >
                        {isStarting && countdown !== null ? (
                          <span className="text-xl font-bold tabular-nums">{countdown}</span>
                        ) : (
                          <>
                            <Play size={16} fill="currentColor" />
                            Go Live
                          </>
                        )}
                      </motion.button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}