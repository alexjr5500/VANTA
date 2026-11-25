'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Clapperboard, Loader2, Upload, X, Camera, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import Avatar from '@/components/ui/Avatar';
import { normalizeVideoFileForUpload, probeVideoFileDuration, validateVideoFile, VIDEO_MAX_DURATION_SECONDS } from '@/lib/videoTrim';
import { createReelDraft } from '@/lib/reelApi';
import { startUpload } from '@/lib/uploads/store';

interface ReelUploaderProps {
  open: boolean;
  onClose: () => void;
}

type Step = 'select' | 'preview' | 'editor';

const STEP_TITLES: Record<Step, string> = {
  select: 'Upload Reel',
  preview: 'Preview',
  editor: 'Reel details',
};

const STEP_SUBTITLES: Record<Step, string> = {
  select: 'Share a short video with your audience',
  preview: 'Review your video before continuing',
  editor: 'Add a caption before posting',
};

/**
 * VANTA "Upload Reel" flow.
 *
 * Reels are uploaded exactly as selected. There is no crop, trim or re-encode
 * step; the original video is previewed and sent to the background uploader.
 *
 * Publishing is NON-BLOCKING: "Post Reel" creates an instant Reel draft, then
 * hands the original file to the background upload manager. The editor closes
 * immediately and the real byte-based transfer continues (with the global
 * upload indicator) while the user navigates anywhere in VANTA. The Reel only
 * becomes visible (PUBLISHED) after its media actually reaches storage.
 */
export default function ReelUploader({ open, onClose }: ReelUploaderProps) {
  const { token, user, getAccessToken, renewAccessToken } = useAuth();
  const { showToast } = useToast();

  const [step, setStep] = useState<Step>('select');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [duration, setDuration] = useState(0);
  const [probing, setProbing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // ---- Lifecycle ----------------------------------------------------------

  const resetAll = useCallback(() => {
    setStep('select');
    setFile(null);
    setPreviewUrl('');
    setDuration(0);
    setProbing(false);
    setLoadError(null);
    setPreviewFailed(false);
    setFormError(null);
    setTitle('');
    setDescription('');
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

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const handleFiles = async (files: FileList | null) => {
    const candidate = files?.[0];
    if (!candidate || probing) return;
    setLoadError(null);
    setFormError(null);
    const validation = validateVideoFile(candidate);
    if (validation) { setLoadError(validation); return; }
    setProbing(true);
    try {
      const original = normalizeVideoFileForUpload(candidate);
      const actualDuration = await probeVideoFileDuration(original);
      // Some valid containers/codecs cannot be previewed by the current browser.
      // Keep the original uploadable; the backend checks duration with ffprobe.
      if (!actualDuration) { setDuration(0); }
      if (actualDuration > VIDEO_MAX_DURATION_SECONDS) { setLoadError('Reels can be up to 10 minutes long. Choose a shorter video.'); return; }
      setFile(original);
      setPreviewFailed(false);
      setDuration(actualDuration);
      setPreviewUrl(URL.createObjectURL(original));
      setStep('preview');
    } finally { setProbing(false); }
  };

  // ---- Publish ------------------------------------------------------------

  const handleSubmit = async () => {
    if (!token) {
      setFormError('You need to be signed in to post a Reel.');
      return;
    }
    if (!file) { setFormError('Choose a video before posting.'); return; }
    setSubmitting(true);
    setFormError(null);
    try {
      const reelTitle = title.trim() || 'Reel';
      const reelDescription = description.trim() || undefined;
      const draft = await createReelDraft(token, { title: reelTitle, description: reelDescription });

      // Hand the untouched original file to the background upload manager.
      // The editor closes right away; the upload runs with real byte progress in
      // the global indicator while the user continues using VANTA.
      startUpload({
        kind: 'reel',
        file,
        draftId: draft.video.id,
        token,
        getAccessToken,
        renewAccessToken,
        meta: {
          title: reelTitle,
          description: reelDescription,
          duration,
          mimeType: file.type || (file.name.toLowerCase().endsWith('.mp4') ? 'video/mp4' : 'video/webm'),
        },
      });

      showToast?.({ type: 'success', title: 'Reel is publishing', message: 'Your Reel is uploading in the background — you’ll see live progress at the bottom of the screen.' });
      onClose();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not start publishing your Reel. Please try again.';
      setFormError(message);
      showToast?.({ type: 'error', title: 'Publish failed', message });
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
            className="fixed inset-0 z-[101] mx-auto flex h-[100dvh] w-full max-w-none flex-col overflow-hidden bg-[var(--background)] text-[var(--text-primary)] shadow-none"
            role="dialog"
            aria-modal="true"
            aria-label={STEP_TITLES[step]}
          >
            <header className="relative flex shrink-0 items-center justify-between border-b border-[var(--border)] px-3 py-1.5">
              <button type="button" aria-label="Go back" onClick={() => step === 'editor' ? setStep('preview') : step === 'preview' ? setStep('select') : requestClose()} disabled={submitting} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"><ArrowLeft size={20} /></button>
              <div className="pointer-events-none min-w-0 flex-1 text-center">
                <h2 className="truncate text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">{STEP_TITLES[step]}</h2>
                <p className="truncate text-[11px] text-[var(--text-muted)]">{STEP_SUBTITLES[step]}</p>
              </div>
              <button
                type="button"
                onClick={requestClose}
                disabled={submitting}
                aria-label="Close"
                className="grid h-10 w-10 place-items-center rounded-full text-[var(--text-secondary)] transition hover:bg-white/[0.06] hover:text-[var(--text-primary)] active:scale-95 disabled:opacity-40"
              >
                <X size={19} />
              </button>
            </header>

            {/* Starting publish (brief — the actual upload runs in the background) */}
            {submitting && (
              <div className="shrink-0 border-b border-white/[0.06] px-4 py-2">
                <p className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                  <Loader2 size={13} className="animate-spin text-[#dfbd55]" />
                  Preparing your Reel… the upload continues in the background.
                </p>
              </div>
            )}

            <div className={cn("min-h-0 flex-1 overscroll-contain px-4 pb-4", step === "preview" ? "overflow-hidden" : "overflow-y-auto scrollbar-hide")}>
              {formError && (
                <div className="mt-3 w-full text-left">
                  <div className="form-error">{formError}</div>
                </div>
              )}

              {step === 'select' ? (
                <div className="mx-auto flex w-full max-w-xl flex-col items-start text-left">
                  <div className="mt-6 flex items-center gap-3">
                    <Clapperboard className="text-[#dfbd55]" size={22} />
                    <div><h3 className="text-base font-semibold text-white">Choose a video</h3><p className="mt-0.5 text-sm text-[var(--text-secondary)]">Select a clip to preview before posting.</p></div>
                  </div>

                  {loadError && <div className="form-error mt-4 w-full text-left">{loadError}</div>}

                  <label
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragActive(true);
                    }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDragActive(false);
                      void handleFiles(event.dataTransfer?.files);
                    }}
                    className={cn(
                      'group mt-5 hidden w-full cursor-pointer flex-col items-center rounded-xl border border-dashed px-5 py-8 transition sm:flex',
                      dragActive ? 'border-[#c9a227]/70 bg-[#c9a227]/10' : 'border-white/[0.12] bg-white/[0.02]'
                    )}
                  >
                    <Upload
                      size={28}
                      className={cn('transition', dragActive ? 'text-[#dfbd55]' : 'text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]')}
                    />
                    <span className="mt-3 text-sm font-medium text-[var(--text-secondary)]">Drop a video here or tap to choose</span>
                    <span className="mt-1 text-[11px] text-[var(--text-muted)]">MP4, WebM, MOV or M4V · up to 100MB · 10 minutes</span>
                  </label>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/*,.mp4,.webm,.mov,.m4v"
                    className="sr-only"
                    onChange={(event) => {
                      void handleFiles(event.target.files);
                      event.target.value = '';
                    }}
                  />

                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="video/*,.mp4,.webm,.mov,.m4v"
                    capture="environment"
                    className="sr-only"
                    onChange={(event) => {
                      void handleFiles(event.target.files);
                      event.target.value = '';
                    }}
                  />

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={probing}
                    className="btn-gold mt-4 min-h-12 w-full rounded-xl disabled:opacity-50"
                  >
                    {probing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                    {probing ? 'Checking video…' : 'Choose Video'}
                  </button>

                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    disabled={probing}
                    className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl text-sm text-[var(--text-secondary)] transition hover:bg-white/[0.04] hover:text-[var(--text-primary)] disabled:opacity-50"
                  >
                    <Camera size={16} />
                    Capture Video
                  </button>
                </div>
              ) : step === 'preview' ? (
                <div className="flex h-full min-h-0 flex-col gap-3 pt-3">
                  <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-[var(--surface)]">
                    {previewUrl && <video key={previewUrl} src={previewUrl} controls playsInline preload="metadata" onError={() => setPreviewFailed(true)} onLoadedData={() => setPreviewFailed(false)} className="absolute inset-0 h-full w-full object-contain" />}
                    {previewFailed && <p role="status" className="absolute inset-x-3 bottom-12 rounded-lg bg-[var(--surface)] p-3 text-center text-xs text-[var(--text-secondary)]">This browser cannot preview the video. You can still continue with the original file.</p>}
                  </div>
                  <div className="flex items-center justify-between gap-3 text-xs text-[var(--text-secondary)]"><span className="min-w-0 truncate">{file?.name}</span><span className="shrink-0 tabular-nums">{duration > 0 ? formatSeconds(duration) : 'Duration checked on upload'}</span></div>
                </div>
              ) : (
                <div className="space-y-4 pt-4">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1 space-y-3">
                      <div><label htmlFor="reel-title" className="sr-only">Title</label><input id="reel-title" type="text" maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Give your Reel a title" className="form-input" /></div>
                      <div><label htmlFor="reel-description" className="sr-only">Description</label><textarea id="reel-description" rows={3} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Add a description (optional)" className="form-textarea !min-h-[84px]" /><p className="mt-1 text-right text-[10px] tabular-nums text-[var(--text-muted)]">{description.length}/1000</p></div>
                    </div>
                    <button type="button" onClick={() => setStep('preview')} aria-label="Review selected Reel" className="relative h-32 w-24 shrink-0 overflow-hidden rounded-lg bg-[var(--surface)] sm:h-40 sm:w-28">
                      {previewUrl && <video src={previewUrl} muted playsInline preload="metadata" className="pointer-events-none h-full w-full object-contain" />}
                      <span className="absolute inset-x-0 bottom-0 bg-[var(--overlay)] py-1 text-center text-xs text-white">Preview</span>
                    </button>
                  </div>
                  <div className="flex items-center gap-3 border-y border-[var(--border)] py-3">
                    <Avatar src={user?.avatarUrl || user?.avatar || null} alt={user?.username || 'You'} size="sm" />
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-[var(--text-primary)]">{user?.fullName || user?.username || 'You'}</p><p className="truncate text-xs text-[var(--text-secondary)]">Posting as @{(user?.username || 'you').toLowerCase()}</p></div>
                  </div>
                  <button type="button" onClick={() => { setFile(null); setPreviewUrl(''); setDuration(0); setPreviewFailed(false); setStep('select'); }} disabled={submitting} className="min-h-11 w-full rounded-lg border border-[var(--border)] text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-40">Choose a different video</button>
                </div>
              )}
            </div>
            {step !== 'select' && <footer className="shrink-0 border-t border-[var(--border)] bg-[var(--background)] px-4 pt-3 pb-[calc(.75rem+env(safe-area-inset-bottom))]">
              <button type="button" onClick={() => step === 'preview' ? setStep('editor') : void handleSubmit()} disabled={submitting || !file} className="btn-gold min-h-12 w-full rounded-xl disabled:opacity-50">{submitting ? <><Loader2 size={16} className="animate-spin" /> Preparing Reel…</> : step === 'preview' ? 'Next' : 'Post Reel'}</button>
            </footer>}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}