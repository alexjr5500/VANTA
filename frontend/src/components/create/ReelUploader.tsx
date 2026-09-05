'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Clapperboard, Upload, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiUpload } from '@/lib/apiClient';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import Avatar from '@/components/ui/Avatar';
import { validateVideoFile } from '@/lib/videoTrim';
import VideoTrimEditor, { type VideoTrimResult, type VideoTrimReviewContext } from '@/components/video/VideoTrimEditor';

interface ReelUploaderProps {
  open: boolean;
  onClose: () => void;
}

type Step = 'select' | 'editor';

const STEP_TITLES: Record<Step, string> = {
  select: 'Upload Reel',
  editor: 'Edit Reel',
};

const STEP_SUBTITLES: Record<Step, string> = {
  select: 'Share a short video with your audience',
  editor: 'Preview, trim the timeline and add a caption',
};

/**
 * VANTA "Upload Reel" flow.
 *
 * Uses the shared <VideoTrimEditor /> for the entire trimming experience —
 * the same component that powers Post, Story, Chat and any future video
 * upload flow. Reel-specific metadata (title + description) is injected into
 * the shared review step via `reviewExtras`; publishing still goes through
 * the existing `/api/upload/reel` endpoint with the real trimmed file.
 */
export default function ReelUploader({ open, onClose }: ReelUploaderProps) {
  const { token, user } = useAuth();
  const { showToast } = useToast();

  const [step, setStep] = useState<Step>('select');
  const [file, setFile] = useState<File | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const [uploadProgress, setUploadProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- Lifecycle ----------------------------------------------------------

  const resetAll = useCallback(() => {
    setStep('select');
    setFile(null);
    setLoadError(null);
    setFormError(null);
    setTitle('');
    setDescription('');
    setUploadProgress(0);
    setSubmitting(false);
    setDragActive(false);
  }, []);

  useEffect(() => {
    if (open) resetAll();
  }, [open, resetAll]);

  useEffect(() => {
    if (!open) setStep('select');
  }, [open]);

  // ---- File selection -----------------------------------------------------

  const handleFiles = (files: FileList | null) => {
    const candidate = files?.[0];
    if (!candidate) return;
    setLoadError(null);
    setFormError(null);
    const validation = validateVideoFile(candidate);
    if (validation) {
      setLoadError(validation);
      return;
    }
    setFile(candidate);
    setStep('editor');
  };

  // ---- Publish ------------------------------------------------------------

  const handleSubmit = async (result: VideoTrimResult) => {
    if (!token) {
      setFormError('You need to be signed in to post a Reel.');
      return;
    }
    setSubmitting(true);
    setUploadProgress(0);
    setFormError(null);
    try {
      const form = new FormData();
      form.append('video', result.file);
      form.append('title', title.trim() || 'Untitled Reel');
      form.append('description', description.trim());
      await apiUpload('/api/upload/reel', form, token, 'POST', setUploadProgress);
      showToast?.({ type: 'success', title: 'Reel posted', message: 'Your trimmed Reel is live on VANTA.' });
      onClose();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'The Reel could not be uploaded. Please try again.';
      setFormError(message);
      showToast?.({ type: 'error', title: 'Upload failed', message });
    } finally {
      setSubmitting(false);
    }
  };

  const requestClose = useCallback(() => {
    if (submitting) return;
    onClose();
  }, [submitting, onClose]);

  const formatSeconds = (value: number) => {
    const rounded = Math.round(value);
    const minutes = Math.floor(rounded / 60);
    const seconds = rounded % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  };

  const reviewExtras = useCallback(
    (context: VideoTrimReviewContext) => (
      <div className="space-y-4">
        <div>
          <label htmlFor="reel-title" className="form-label">Title</label>
          <input
            id="reel-title"
            type="text"
            maxLength={120}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Give your Reel a title"
            className="form-input"
          />
          <p className="mt-1 text-right text-[10px] tabular-nums text-white/25">{title.length}/120</p>
        </div>
        <div>
          <label htmlFor="reel-description" className="form-label">Description</label>
          <textarea
            id="reel-description"
            rows={3}
            maxLength={1000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Add a description (optional)"
            className="form-textarea !min-h-[84px]"
          />
          <p className="mt-1 text-right text-[10px] tabular-nums text-white/25">{description.length}/1000</p>
        </div>
        {context.isTrimmed && (
          <p className="text-[11px] text-emerald-400/80">
            This Reel contains only {formatSeconds(context.trimStart)} → {formatSeconds(context.trimEnd)} — the
            original {formatSeconds(context.originalDuration)} clip was cut down before uploading.
          </p>
        )}
      </div>
    ),
    [title, description]
  );

  // ============================================================================
  // Render
  // ============================================================================

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
            onClick={requestClose}
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0, transition: { type: 'spring', damping: 30, stiffness: 320 } }}
            exit={{ y: '100%', transition: { duration: 0.2, ease: 'easeIn' } }}
            className="fixed inset-x-0 bottom-0 z-[101] mx-auto flex h-[94dvh] w-full max-w-[480px] flex-col overflow-hidden rounded-t-[28px] border border-b-0 border-white/[0.08] bg-[#0d0d0f] shadow-[0_-12px_48px_rgba(0,0,0,0.6)]"
            role="dialog"
            aria-modal="true"
            aria-label={STEP_TITLES[step]}
          >
            <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/15" />

            <header className="relative flex shrink-0 items-center justify-between border-b border-white/[0.06] px-3 py-1.5">
              {step === 'editor' ? (
                <button
                  type="button"
                  onClick={requestClose}
                  aria-label="Go back"
                  className="grid h-10 w-10 place-items-center rounded-full text-[#c8c8cc] transition hover:bg-white/[0.06] hover:text-white active:scale-95"
                >
                  <X size={19} />
                </button>
              ) : (
                <div className="w-10" />
              )}
              <div className="pointer-events-none min-w-0 flex-1 text-center">
                <h2 className="truncate text-[15px] font-semibold tracking-tight text-[#f5f5f5]">{STEP_TITLES[step]}</h2>
                <p className="truncate text-[11px] text-white/40">{STEP_SUBTITLES[step]}</p>
              </div>
              <button
                type="button"
                onClick={requestClose}
                disabled={submitting}
                aria-label="Close"
                className="grid h-10 w-10 place-items-center rounded-full text-[#c8c8cc] transition hover:bg-white/[0.06] hover:text-white active:scale-95 disabled:opacity-40"
              >
                <X size={19} />
              </button>
            </header>

            {/* Identity strip */}
            <div className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] px-4 py-2.5">
              <Avatar src={user?.avatarUrl || user?.avatar || null} alt={user?.username || 'You'} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{user?.fullName || user?.username || 'You'}</p>
                <p className="text-[11px] text-white/40">Posting as @{(user?.username || 'you').toLowerCase()}</p>
              </div>
            </div>

            {/* Upload progress while publishing */}
            {submitting && (
              <div className="shrink-0 border-b border-white/[0.06] px-4 py-2">
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#c9a227] to-[#dfbd55]"
                    style={{ width: `${Math.min(100, Math.max(0, uploadProgress))}%` }}
                  />
                </div>
                <p className="mt-1 text-right text-[10px] tabular-nums text-white/40">Publishing… {uploadProgress}%</p>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide overscroll-contain px-4 pb-4">
              {formError && (
                <div className="mt-3 w-full text-left">
                  <div className="form-error">{formError}</div>
                </div>
              )}

              {step === 'select' ? (
                <div className="flex flex-col items-center text-center">
                  <div className="mt-2 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04]">
                    <Clapperboard className="text-[#b8b8b8]" size={26} />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-white">Upload Reel</h3>
                  <p className="mt-1 text-sm text-white/45">Share a short video with your audience</p>

                  {loadError && <div className="form-error mt-4 w-full text-left">{loadError}</div>}

                  <label
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragActive(true);
                    }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDragActive(false);
                      handleFiles(event.dataTransfer?.files);
                    }}
                    className={cn(
                      'group mt-5 flex w-full cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed px-6 py-10 transition',
                      dragActive ? 'border-[#c9a227]/70 bg-[#c9a227]/10' : 'border-white/[0.12] bg-white/[0.02]'
                    )}
                  >
                    <Upload
                      size={28}
                      className={cn('transition', dragActive ? 'text-[#dfbd55]' : 'text-white/35 group-hover:text-white/60')}
                    />
                    <span className="mt-3 text-sm font-medium text-white/70">Drop a video here or tap to choose</span>
                    <span className="mt-1 text-[11px] text-white/35">MP4 or WebM up to 100MB and 10 minutes</span>
                    <span className="mt-3 rounded-full bg-[#c9a227]/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#dfbd55]">
                      Time-trim before posting
                    </span>
                  </label>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/mp4,video/webm"
                    className="sr-only"
                    onChange={(event) => {
                      handleFiles(event.target.files);
                      event.target.value = '';
                    }}
                  />

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="btn-gold mt-4 min-h-11 w-full"
                  >
                    <Upload size={15} />
                    Choose Video
                  </button>
                </div>
              ) : (
                <VideoTrimEditor
                  file={file}
                  onConfirm={(result) => void handleSubmit(result)}
                  reviewExtras={reviewExtras}
                  confirmLabel="Post Reel"
                  trimActionLabel="Preview Reel"
                  className="pt-3"
                />
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}