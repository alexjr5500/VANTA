'use client';

import { useEffect, useState } from 'react';
import { Film, Loader2, Upload, X } from 'lucide-react';
import { apiUpload } from '@/lib/apiClient';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/ui/Toast';

interface ReelUploaderProps { open: boolean; onClose: () => void; }

/** The single UI entry point for the existing /api/upload/reel backend flow. */
export default function ReelUploader({ open, onClose }: ReelUploaderProps) {
  const { token } = useAuth();
  const { showToast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [progress, setProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) { setFile(null); setTitle(''); setDescription(''); setProgress(0); setSubmitting(false); }
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    if (!token || !file) return;
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append('video', file);
      form.append('title', title.trim() || 'Untitled Reel');
      form.append('description', description.trim());
      await apiUpload('/api/upload/reel', form, token, 'POST', setProgress);
      showToast?.({ type: 'success', title: 'Reel uploaded', message: 'Your Reel is ready to watch.' });
      onClose();
    } catch (error: any) {
      showToast?.({ type: 'error', title: 'Upload failed', message: error?.message || 'The reel could not be uploaded.' });
    } finally { setSubmitting(false); }
  };

  return <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="reel-uploader-title">
    <div className="w-full max-w-lg rounded-3xl border border-white/[0.08] bg-[#0e0e16] p-6 shadow-2xl">
      <div className="mb-5 flex items-center justify-between"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[.06]"><Film className="text-[#b8b8b8]" size={20} /></span><div><h2 id="reel-uploader-title" className="font-bold text-white">Upload reel</h2><p className="text-xs text-white/40">Share a short video on VANTA</p></div></div><button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-white/50 hover:bg-white/[0.05] hover:text-white"><X size={18} /></button></div>
      <label className="mb-4 block cursor-pointer rounded-2xl border-2 border-dashed border-white/[0.1] p-8 text-center hover:border-[#a8a8ac]/40"><input type="file" accept="video/mp4,video/webm" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] || null)} /><Upload className="mx-auto mb-2 text-white/40" size={26} /><p className="text-sm text-white">{file?.name || 'Choose a video'}</p><p className="mt-1 text-xs text-white/35">MP4 or WebM</p></label>
      <div className="space-y-3"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Reel title" className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm text-white outline-none placeholder:text-white/30" /><textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" rows={3} className="w-full resize-none rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm text-white outline-none placeholder:text-white/30" /></div>
      {submitting && <div className="mt-4"><div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-[#a8a8ac] transition-all" style={{ width: `${progress}%` }} /></div><p className="mt-1 text-right text-[10px] text-white/40">{progress}%</p></div>}
      <button type="button" disabled={!file || submitting} onClick={submit} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#151517]0 to-fuchsia-500 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">{submitting && <Loader2 size={16} className="animate-spin" />} {submitting ? 'Uploading…' : 'Upload Reel'}</button>
    </div>
  </div>;
}