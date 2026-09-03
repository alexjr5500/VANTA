'use client';

import React, { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Image, Video, X, FileWarning, CheckCircle2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { useAuth } from '@/context/AuthContext';
import { apiUpload } from '@/lib/apiClient';
import { apiDelete } from '@/lib/apiClient';

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'];
const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/webm'];
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB (matches backend)
const MAX_IMAGE_SIZE = 15 * 1024 * 1024; // 15MB

export interface MediaFile {
  id: string;
  file: File;
  type: 'image' | 'video';
  url: string;
  name: string;
  size: number;
  progress: number;
  uploading: boolean;
  uploadedUrl?: string;
  uploadedId?: string;
  error?: string;
}

export interface MediaUploaderHandle {
  /** Open the native file picker, optionally filtered to images or videos. */
  openPicker: (kind?: 'image' | 'video') => void;
}

interface MediaUploaderProps {
  onMediaChange: (media: MediaFile[]) => void;
  maxFiles?: number;
  storyMode?: boolean;
  openPickerOnMount?: boolean;
  className?: string;
  /** Hide the desktop drag & drop zone (mobile composers provide their own toolbar entry points). */
  hideDropZone?: boolean;
}

const MediaUploader = forwardRef<MediaUploaderHandle, MediaUploaderProps>(function MediaUploader({ onMediaChange, maxFiles = 10, storyMode = false, openPickerOnMount = false, className, hideDropZone = false }, ref) {
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { token } = useAuth();
  const filesRef = useRef<MediaFile[]>([]);
  const abortControllers = useRef(new Map<string, AbortController>());
  const pickerOpenedRef = useRef(false);

  useEffect(() => {
    if (!openPickerOnMount || pickerOpenedRef.current) return;
    pickerOpenedRef.current = true;
    const frame = window.requestAnimationFrame(() => fileInputRef.current?.click());
    return () => window.cancelAnimationFrame(frame);
  }, [openPickerOnMount]);

  const updateFiles = useCallback((files: MediaFile[]) => {
    filesRef.current = files;
    setMediaFiles(files);
  }, []);

  useEffect(() => {
    filesRef.current = mediaFiles;
    onMediaChange(mediaFiles);
  }, [mediaFiles, onMediaChange]);

  useEffect(() => () => {
    abortControllers.current.forEach(controller => controller.abort());
    filesRef.current.forEach(file => {
      URL.revokeObjectURL(file.url);
      // An uploaded asset still present when the parent unmounts was committed by
      // the parent flow (post/story). Explicit remove handles abandoned assets.
    });
  }, []);

  const validateFile = (file: File): string | null => {
    if (ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      if (file.size > MAX_IMAGE_SIZE) return `Image exceeds ${MAX_IMAGE_SIZE / 1024 / 1024}MB limit`;
    } else if (ACCEPTED_VIDEO_TYPES.includes(file.type)) {
      if (file.size > MAX_FILE_SIZE) return `Video exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`;
    } else {
      return 'Unsupported file type. Please upload images or videos.';
    }
    return null;
  };

  const processFiles = useCallback((files: FileList | File[]) => {
    const newFiles: MediaFile[] = [];
    const existingCount = mediaFiles.length;

    for (let i = 0; i < files.length; i++) {
      if (existingCount + newFiles.length >= maxFiles) break;
      const file = files[i];
      const error = validateFile(file);
      const type = ACCEPTED_IMAGE_TYPES.includes(file.type) ? 'image' : 'video';

      newFiles.push({
        id: `media_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`,
        file,
        type,
        url: URL.createObjectURL(file),
        name: file.name,
        size: file.size,
        progress: 0,
        uploading: false,
        error: error ?? undefined,
      });

    }

    const updated = [...mediaFiles, ...newFiles];
    updateFiles(updated);
    newFiles.filter(file => !file.error).forEach(file => void uploadFileToServer(file));
  }, [mediaFiles, maxFiles, updateFiles]);

  const uploadFileToServer = async (mediaFile: MediaFile) => {
    const fd = new FormData();
    fd.append('file', mediaFile.file);
    fd.append('category', storyMode ? 'story' : mediaFile.type === 'video' ? 'post-video' : 'post-image');
    const controller = new AbortController();
    abortControllers.current.set(mediaFile.id, controller);

    setMediaFiles((prev) =>
      prev.map((f) =>
        f.id === mediaFile.id ? { ...f, uploading: true, progress: 0, error: undefined } : f
      )
    );

    try {
      const result = await apiUpload<{ id: string; url: string }>(
        '/api/upload',
        fd,
        token ?? undefined,
        'POST',
        (percent) => {
          setMediaFiles((prev) =>
            prev.map((f) =>
              f.id === mediaFile.id ? { ...f, progress: percent } : f
            )
          );
        },
        controller.signal
      );
      setMediaFiles((prev) =>
        prev.map((f) =>
          f.id === mediaFile.id
            ? { ...f, progress: 100, uploading: false, uploadedUrl: result.url, uploadedId: result.id }
            : f
        )
      );
      abortControllers.current.delete(mediaFile.id);
    } catch (err) {
      setMediaFiles((prev) =>
        prev.map((f) =>
          f.id === mediaFile.id
            ? { ...f, uploading: false, error: err instanceof Error ? err.message : 'Upload failed' }
            : f
        )
      );
      abortControllers.current.delete(mediaFile.id);
    }
  };

  const retryUpload = useCallback((id: string) => {
    const target = mediaFiles.find((f) => f.id === id);
    if (target) {
      uploadFileToServer(target);
    }
  }, [mediaFiles]);

  const removeFile = useCallback((id: string) => {
    abortControllers.current.get(id)?.abort();
    abortControllers.current.delete(id);
    setMediaFiles((prev) => {
      const file = prev.find((f) => f.id === id);
      if (file) {
        URL.revokeObjectURL(file.url);
        if (file.uploadedId) void apiDelete(`/api/upload/files/${file.uploadedId}`, token ?? undefined).catch(() => {});
      }
      const updated = prev.filter((f) => f.id !== id);
      return updated;
    });
  }, [token]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  }, [processFiles]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
      e.target.value = '';
    }
  }, [processFiles]);

  const openPicker = useCallback((kind?: 'image' | 'video') => {
    const input = fileInputRef.current;
    if (!input) return;
    input.accept = kind === 'image'
      ? ACCEPTED_IMAGE_TYPES.join(',')
      : kind === 'video'
        ? ACCEPTED_VIDEO_TYPES.join(',')
        : [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_VIDEO_TYPES].join(',');
    input.click();
  }, []);

  useImperativeHandle(ref, () => ({ openPicker }), [openPicker]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  // Single-file flows (the post composer) show one large featured preview
  // instead of the compact grid so the media itself is the visual focus.
  const featuredPreview = !storyMode && maxFiles === 1;

  return (
    <div className={cn('space-y-3', className)}>
      <input
        ref={fileInputRef}
        type="file"
        accept={[...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_VIDEO_TYPES].join(',')}
        multiple={!storyMode && maxFiles > 1}
        className="hidden"
        onChange={handleFileSelect}
        aria-hidden="true"
      />
      {/* Drop zone */}
      {!storyMode && !hideDropZone && <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          'relative cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-all duration-200',
          isDragging
            ? 'border-[#d6a83f] bg-[#d6a83f]/5 shadow-[0_0_30px_rgba(255,0,127,0.1)]'
            : 'border-white/[0.08] hover:border-white/[0.15] hover:bg-white/[0.02]'
        )}
        role="button"
        tabIndex={0}
        aria-label="Upload media files"
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
      >
        <div className="flex flex-col items-center gap-2">
          <div className={cn(
            'w-12 h-12 rounded-2xl flex items-center justify-center transition-all',
            isDragging ? 'bg-[#d6a83f]/20 scale-110' : 'bg-white/[0.05]'
          )}>
            <Upload size={22} className={isDragging ? 'text-[#d6a83f]' : 'text-gray-400'} />
          </div>
          <div>
            <p className="text-sm font-medium text-white">
              {isDragging ? 'Drop files here' : 'Drag & drop or click to upload'}
            </p>
            <p className="text-[11px] text-gray-500 mt-1">
              Images (jpg, png, webp) up to 15MB &bull; Videos (mp4, webm) up to 100MB
            </p>
          </div>
          <div className="flex items-center gap-3 mt-1">
            <span className="flex items-center gap-1.5 text-[10px] text-gray-500 bg-white/[0.04] px-2.5 py-1 rounded-full">
              <Image size={11} /> Photo
            </span>
            <span className="flex items-center gap-1.5 text-[10px] text-gray-500 bg-white/[0.04] px-2.5 py-1 rounded-full">
              <Video size={11} /> Video
            </span>
          </div>
        </div>
      </div>}

      {storyMode && mediaFiles.length === 0 && (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="mx-auto flex items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.04] px-4 py-2.5 text-xs font-medium text-white/70 transition hover:bg-white/[0.08] hover:text-white"
        >
          <Upload size={15} />
          Choose photo or video
        </button>
      )}

      {/* Media previews */}
      {mediaFiles.length > 0 && (
        <div className="grid grid-cols-2  gap-2">
          <AnimatePresence mode="popLayout">
            {mediaFiles.map((media) => (
               <motion.div
                key={media.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                layout
                className={cn(
                  'relative overflow-hidden border',
                  storyMode
                    ? 'mx-auto aspect-[9/16] w-full max-w-[240px] rounded-xl'
                    : featuredPreview
                      ? 'col-span-2 rounded-2xl bg-black/40'
                      : 'aspect-square rounded-xl',
                  media.error ? 'border-red-500/30' : 'border-white/[0.06]'
                )}
              >
                {media.type === 'image' ? (
                  <img
                    src={resolveMediaUrl(media.url)}
                    alt={media.name}
                    className={cn(
                      storyMode || featuredPreview
                        ? 'max-h-[340px] w-full object-contain'
                        : 'h-full w-full object-cover'
                    )}
                  />
                ) : (
                  <video
                    src={resolveMediaUrl(media.url)}
                    className={cn(
                      storyMode || featuredPreview
                        ? 'max-h-[340px] w-full object-contain'
                        : 'h-full w-full object-cover'
                    )}
                    muted
                    playsInline
                  />
                )}

                {/* Overlay gradient */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30" />

                {/* Error badge */}
                {media.error && (
                  <div className="absolute top-2 left-2 flex items-center gap-1 bg-red-500/80 text-white text-[9px] px-2 py-0.5 rounded-full">
                    <FileWarning size={10} />
                    Error
                  </div>
                )}

                {/* File type badge */}
                <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm text-[10px] text-white px-2 py-0.5 rounded-full flex items-center gap-1">
                  {media.type === 'image' ? <Image size={10} /> : <Video size={10} />}
                  {media.type === 'image' ? 'Photo' : 'Video'}
                </div>

                {/* Progress bar */}
                {media.uploading && (
                  <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/[0.1]">
                    <motion.div
                      className="h-full bg-gradient-to-r from-[#d6a83f] to-[#c8c8cc]"
                      initial={{ width: 0 }}
                      animate={{ width: `${media.progress}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                )}

                {/* Completed indicator */}
                {media.progress === 100 && !media.error && (
                  <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-emerald-500/80 text-white text-[9px] px-2 py-0.5 rounded-full">
                    <CheckCircle2 size={10} />
                    Ready
                  </div>
                )}

                {/* Action buttons */}
                <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                  {media.error && (
                    <button
                      onClick={(e) => { e.stopPropagation(); retryUpload(media.id); }}
                      className="bg-amber-500/80 backdrop-blur-sm rounded-lg px-2 py-1 text-[10px] font-medium text-white hover:bg-amber-500 transition"
                    >
                      Retry
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); removeFile(media.id); }}
                    className="bg-black/60 backdrop-blur-sm rounded-lg p-1.5 text-white/70 hover:text-white hover:bg-black/80 transition"
                    aria-label={`Remove ${media.name}`}
                  >
                    <X size={12} />
                  </button>
                </div>

                {/* File name */}
                <div className="absolute bottom-8 left-2 right-2">
                  <p className="text-[10px] text-white/70 truncate drop-shadow-lg">
                    {media.name}
                  </p>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Upload all complete message */}
      {mediaFiles.length > 0 && mediaFiles.every((f) => f.progress === 100 && !f.error) && (
        <p className="text-[11px] text-emerald-400/80 text-center">
          {mediaFiles.length} file{mediaFiles.length !== 1 ? 's' : ''} uploaded successfully
        </p>
      )}
    </div>
  );
});

export default MediaUploader;
