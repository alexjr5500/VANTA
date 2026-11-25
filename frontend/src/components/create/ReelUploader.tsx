'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, X, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';
import Avatar from '@/components/ui/Avatar';
import StatusVideoPreview from '@/components/story/StatusVideoPreview';
import { prepareTrimmedVideo, statusRangeNeedsTrim, type StatusTrimRange } from '@/lib/statusVideoTrim';
import { formatVideoTime } from '@/lib/videoTrim';
import { normalizeVideoFileForUpload, probeVideoFileDuration, validateVideoFile, VIDEO_MAX_DURATION_SECONDS } from '@/lib/videoTrim';
import { createReelDraft } from '@/lib/reelApi';
import { startUpload } from '@/lib/uploads/store';

interface ReelUploaderProps {
  open: boolean;
  selectedFile: File | null;
  onChooseAnother: () => void;
  onClose: () => void;
}

type Step = 'preview' | 'editor';

const STEP_TITLES: Record<Step, string> = {
  preview: 'Preview',
  editor: 'Reel details',
};

/**
 * VANTA "Upload Reel" flow.
 *
 * Reels use the Status filmstrip editor. Untrimmed files remain untouched;
 * a selected range is materialized before creating a draft and uploading.
 *
 * Publishing is NON-BLOCKING: "Post Reel" creates an instant Reel draft, then
 * hands the original file to the background upload manager. The editor closes
 * immediately and the real byte-based transfer continues (with the global
 * upload indicator) while the user navigates anywhere in VANTA. The Reel only
 * becomes visible (PUBLISHED) after its media actually reaches storage.
 */
export default function ReelUploader({ open, selectedFile, onChooseAnother, onClose }: ReelUploaderProps) {
  const { token, user, getAccessToken, renewAccessToken } = useAuth();
  const { showToast } = useToast();

  const [step, setStep] = useState<Step>('preview');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [duration, setDuration] = useState(0);
  const [probing, setProbing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [caption, setCaption] = useState('');
  const [trimRange, setTrimRange] = useState<StatusTrimRange>();
  const [trimming, setTrimming] = useState(false);
  const trimAbort = useRef<AbortController | null>(null);
  const prepared = useRef<{ source: File; range: StatusTrimRange; file: File; duration: number } | null>(null);

  const [submitting, setSubmitting] = useState(false);
  // The provider opens the native picker before this editor appears.
  // Cancelling that picker never creates a draft or opens an upload screen.
  useEffect(() => {
    if (!open || !selectedFile) return;
    let cancelled = false;
    let objectUrl = '';
    setStep('preview');
    setFile(null);
    setPreviewUrl('');
    setDuration(0);
    setLoadError(null);
    setFormError(null);
    setCaption('');
    setTrimRange(undefined);
    prepared.current = null;
    setTrimming(false);
    setSubmitting(false);
    const validation = validateVideoFile(selectedFile);
    if (validation) { setLoadError(validation); setProbing(false); return; }
    setProbing(true);
    const original = normalizeVideoFileForUpload(selectedFile);
    void probeVideoFileDuration(original).then(actualDuration => {
      if (cancelled) return;
      if (actualDuration > VIDEO_MAX_DURATION_SECONDS) {
        setLoadError('Reels can be up to 10 minutes long. Choose a shorter video.');
        return;
      }
      objectUrl = URL.createObjectURL(original);
      setFile(original);
      setDuration(actualDuration);
      setPreviewUrl(objectUrl);
    }).catch(() => {
      if (!cancelled) setLoadError('Could not open this video. Choose another video.');
    }).finally(() => {
      if (!cancelled) setProbing(false);
    });
    return () => {
      cancelled = true;
      trimAbort.current?.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, selectedFile]);

  // Export the selected segment once, before publishing; never upload the
  // original as a fallback when the user explicitly selected a trim.
  const advance = async () => {
    if (!file || trimming || submitting) return;
    setFormError(null);
    const range = trimRange;
    if (!range || !statusRangeNeedsTrim(range, duration || null)) {
      prepared.current = null;
      setStep('editor');
      return;
    }
    const previous = prepared.current;
    if (previous?.source === file && previous.range.start === range.start && previous.range.end === range.end) {
      setStep('editor');
      return;
    }
    const controller = new AbortController();
    trimAbort.current = controller;
    setTrimming(true);
    try {
      const output = await prepareTrimmedVideo(file, previewUrl, range, controller.signal);
      const actualDuration = await probeVideoFileDuration(output);
      if (controller.signal.aborted) return;
      if (!actualDuration || actualDuration > VIDEO_MAX_DURATION_SECONDS || Math.abs(actualDuration - (range.end - range.start)) > 1.5) {
        throw new Error('Could not verify the trimmed clip. Adjust the selection and try again.');
      }
      prepared.current = { source: file, range, file: output, duration: actualDuration };
      setStep('editor');
    } catch (error) {
      if (!controller.signal.aborted) setFormError(error instanceof Error ? error.message : 'Could not trim this video.');
    } finally {
      if (trimAbort.current === controller) {
        trimAbort.current = null;
        setTrimming(false);
      }
    }
  };

  const handleSubmit = async () => {
    if (!token) { setFormError('You need to be signed in to post a Reel.'); return; }
    if (!file || submitting || trimming) return;
    const needsTrim = trimRange && statusRangeNeedsTrim(trimRange, duration || null);
    const exportResult = prepared.current;
    if (needsTrim && (!exportResult || exportResult.source !== file || exportResult.range.start !== trimRange.start || exportResult.range.end !== trimRange.end)) {
      setStep('preview');
      setFormError('Review and prepare your selected clip before posting.');
      return;
    }
    const uploadFile = needsTrim && exportResult ? exportResult.file : file;
    const uploadDuration = needsTrim && exportResult ? exportResult.duration : duration;
    setSubmitting(true);
    setFormError(null);
    try {
      const reelDescription = caption.trim() || undefined;
      // Preserve the existing required server title field without forcing a second user input.
      const reelTitle = 'Reel';
      const draft = await createReelDraft(token, { title: reelTitle, description: reelDescription });
      startUpload({
        kind: 'reel',
        file: uploadFile,
        draftId: draft.video.id,
        token,
        getAccessToken,
        renewAccessToken,
        meta: { title: reelTitle, description: reelDescription, duration: uploadDuration, mimeType: uploadFile.type },
      });
      showToast?.({ type: 'success', title: 'Reel is publishing', message: 'Your Reel is uploading in the background.' });
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
    if (trimming) { trimAbort.current?.abort(); return; }
    onClose();
  }, [submitting, trimming, onClose]);

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <AnimatePresence>
      {open && selectedFile && (
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
            className="fixed inset-0 z-[101] mx-auto flex h-full w-full max-w-none flex-col overflow-hidden bg-[var(--background)] text-[var(--text-primary)] shadow-none"
            role="dialog"
            aria-modal="true"
            aria-label={STEP_TITLES[step]}
          >
            <header className="relative flex shrink-0 items-center justify-between px-3 py-1.5">
              <button type="button" aria-label="Go back" onClick={() => step === 'editor' ? setStep('preview') : requestClose()} disabled={submitting || trimming} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"><ArrowLeft size={20} /></button>
              <div className="pointer-events-none min-w-0 flex-1 text-center">
                <h2 className="truncate text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">{STEP_TITLES[step]}</h2>
                
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

              {probing ? (
                <div className="grid h-full place-items-center text-sm text-[var(--text-secondary)]"><span className="flex items-center gap-2"><Loader2 size={18} className="animate-spin" />Checking video…</span></div>
              ) : loadError ? (
                <div className="space-y-4 pt-5"><p role="alert" className="form-error">{loadError}</p><button type="button" onClick={onChooseAnother} className="btn-gold min-h-11 w-full rounded-lg">Choose another video</button></div>
              ) : step === 'preview' ? (
                <div className="relative flex h-full min-h-0 flex-col pt-1">
                  {previewUrl && file && <StatusVideoPreview key={previewUrl} src={previewUrl} duration={duration || null} size={file.size} poster={null} range={trimRange} showSize={false} onDuration={setDuration} onRange={setTrimRange} />}
                  {trimming && <div role="status" className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 rounded-lg bg-[var(--overlay)] text-white"><Loader2 size={24} className="animate-spin text-[var(--vanta-gold-bright)]" /><span>Preparing selected clip…</span><button type="button" onClick={() => trimAbort.current?.abort()} className="rounded-lg border border-white/30 px-4 py-2 text-sm">Cancel</button></div>}
                </div>
              ) : (
                <div className="space-y-4 pt-2">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <label htmlFor="reel-caption" className="sr-only">Caption</label>
                      <textarea id="reel-caption" rows={5} maxLength={1000} value={caption} onChange={event => setCaption(event.target.value)} placeholder="Add a caption…" className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--active-border)]" />
                      <p className="mt-1 text-right text-[10px] tabular-nums text-[var(--text-muted)]">{caption.length}/1000</p>
                    </div>
                    <button type="button" onClick={() => setStep('preview')} aria-label="Review selected Reel" className="relative h-40 w-28 shrink-0 overflow-hidden rounded-lg bg-[var(--surface)] sm:h-44 sm:w-32">
                      {previewUrl && <video src={previewUrl} muted playsInline preload="metadata" onLoadedMetadata={event => { if (trimRange?.start) event.currentTarget.currentTime = trimRange.start; }} className="pointer-events-none h-full w-full object-contain" />}
                      <span className="absolute inset-x-0 bottom-0 bg-[var(--overlay)] py-1 text-center text-xs text-white">Preview</span>
                    </button>
                  </div>
                  <div className="flex items-center gap-3 border-y border-[var(--border)] py-3">
                    <Avatar src={user?.avatarUrl || user?.avatar || null} alt={user?.username || 'You'} size="sm" />
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-[var(--text-primary)]">{user?.fullName || user?.username || 'You'}</p><p className="truncate text-xs text-[var(--text-secondary)]">Posting as @{(user?.username || 'you').toLowerCase()}</p></div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]"><span>Selected video {formatVideoTime(prepared.current?.duration || duration)}</span><button type="button" disabled={submitting} onClick={onChooseAnother} className="min-h-11 text-[var(--vanta-gold-bright)]">Change video</button></div>
                </div>
              )}
            </div>
            {!probing && !loadError && <footer className="shrink-0 bg-[var(--background)] px-3 pt-2 pb-[max(.5rem,env(safe-area-inset-bottom))]">
              <button type="button" onClick={() => step === 'preview' ? void advance() : void handleSubmit()} disabled={submitting || trimming || !file || duration > VIDEO_MAX_DURATION_SECONDS} className="min-h-12 w-full rounded-xl bg-[var(--vanta-gold)] text-sm font-semibold text-black disabled:opacity-50">{trimming ? 'Preparing clip…' : submitting ? <><Loader2 size={16} className="animate-spin" /> Preparing Reel…</> : step === 'preview' ? 'Next' : 'Post Reel'}</button>
            </footer>}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}