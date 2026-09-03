'use client';

import React, { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { Smile, Paperclip, Send, Mic, Image, Camera, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { uploadMedia, validateImageFile, validateVideoFile, type UploadResult } from '@/lib/uploadService';

interface MessageInputProps {
  onSend: (content: string) => void;
  onAttachment: (type: string, file?: File, url?: string, fileId?: string) => void;
  disabled?: boolean;
}

export default function MessageInput({ onSend, onAttachment, disabled }: MessageInputProps) {
  const [message, setMessage] = useState('');
  const [showAttachments, setShowAttachments] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const { token } = useAuth();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const handleSend = () => {
    if (!message.trim() || disabled) return;
    onSend(message.trim());
    setMessage('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + 'px';
    }
  };

  const handleFileUpload = async (file: File, attachmentType: string) => {
    setUploading(true);
    setUploadError(null);
    setUploadProgress(0);

    // Validate file type
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    const validationError = isImage
      ? validateImageFile(file, 'Attachment')
      : isVideo
        ? validateVideoFile(file, 'Attachment')
        : file.size > 10 * 1024 * 1024
          ? 'File must be under 10MB'
          : null;

    if (validationError) {
      setUploadError(validationError);
      setUploading(false);
      return;
    }

    const result: UploadResult = await uploadMedia(file, token ?? '', {
      fieldName: 'file',
      path: '/api/upload/message',
      category: 'message',
      onProgress: ({ percent }) => setUploadProgress(percent),
    });

    if (result.url) {
      onAttachment(attachmentType, file, result.url, result.fileId);
      setUploading(false);
      setUploadProgress(0);
      setShowAttachments(false);
      setPendingFile(null);
    } else {
      setUploadError(result.error || 'Upload failed');
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleAttachmentClick = (type: string) => {
    setUploadError(null);
    if (type === 'Photo') {
      fileInputRef.current?.click();
      setPendingFile(null);
    } else if (type === 'Camera') {
      fileInputRef.current?.click();
      setPendingFile(null);
    } else if (type === 'File') {
      fileInputRef.current?.click();
      setPendingFile(null);
    } else if (type === 'Sticker') {
      // Stickers would go here
    }
    setShowAttachments(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');
      const attachmentType = isImage ? 'Photo' : isVideo ? 'Video' : 'File';
      handleFileUpload(file, attachmentType);
    }
    e.target.value = '';
  };

  const attachments = [
    { icon: Image, label: 'Photo', color: 'text-emerald-400', type: 'Photo' },
    { icon: Camera, label: 'Camera', color: 'text-white/70', type: 'Camera' },
    { icon: Paperclip, label: 'File', color: 'text-white/70', type: 'File' },
    { icon: Smile, label: 'Sticker', color: 'text-amber-400', type: 'Sticker' },
  ];

  return (
    <div className="border-t border-white/[0.06] bg-[#0e0e16]/50 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,application/pdf,text/plain"
        className="hidden"
        onChange={handleFileSelect}
        aria-hidden="true"
      />

      {/* Upload Progress */}
      {uploading && (
        <div className="px-4 py-2 border-b border-white/[0.04]">
          <div className="flex items-center gap-2">
            <Loader2 size={12} className="text-white/70 animate-spin shrink-0" />
            <div className="flex-1 h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
              <div
                className="h-full bg-[#b8b8b8] transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <span className="text-[10px] text-gray-500">{uploadProgress}%</span>
          </div>
        </div>
      )}

      {/* Upload Error */}
      {uploadError && (
        <div className="px-4 py-2 border-b border-red-500/10 bg-red-500/5">
          <p className="text-[11px] text-red-400">{uploadError}</p>
        </div>
      )}

      {/* Attachments Menu */}
      {showAttachments && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.04]"
        >
          {attachments.map((att, i) => {
            const Icon = att.icon;
            return (
              <motion.button
                key={att.label}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.05 }}
                className="flex flex-col items-center gap-1"
                onClick={() => handleAttachmentClick(att.type)}
                disabled={uploading}
              >
                <div className={cn('w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center hover:bg-white/[0.08] transition-all', att.color)}>
                  <Icon size={16} />
                </div>
                <span className="text-[9px] text-gray-500">{att.label}</span>
              </motion.button>
            );
          })}
          <button
            onClick={() => setShowAttachments(false)}
            className="ml-auto p-2 text-gray-500 hover:text-white transition"
          >
            <X size={14} />
          </button>
        </motion.div>
      )}

      {/* Input Row */}
      <div className="flex items-end gap-2 p-3">
        {/* Attachment Button */}
        <button
          onClick={() => setShowAttachments(!showAttachments)}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-gray-500 transition-all hover:bg-white/[0.05] hover:text-white"
          disabled={uploading}
          aria-label="Add attachment"
        >
          <Paperclip size={16} />
        </button>

        {/* Text Input */}
        <div className="flex-1 relative">
          <textarea
            ref={inputRef}
            value={message}
            onChange={e => { setMessage(e.target.value); handleInput(); }}
            onKeyDown={handleKeyDown}
            placeholder="Message..."
            rows={1}
            className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 pr-12 text-sm text-white placeholder-gray-500 outline-none focus:border-white/20 focus:bg-white/[0.06] transition-all resize-none max-h-[120px]"
            disabled={disabled || uploading}
          />
          <button
            className="absolute bottom-1/2 right-1 grid h-10 w-10 translate-y-1/2 place-items-center text-gray-500 transition hover:text-white"
            aria-label="Add emoji"
          >
            <Smile size={16} />
          </button>
        </div>

        {/* Voice / Send */}
        {message.trim() ? (
          <motion.button
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            onClick={handleSend}
            disabled={disabled || uploading}
            className="shrink-0 w-10 h-10 rounded-lg bg-[#f5f5f5] text-black flex items-center justify-center shadow-lg transition-all disabled:opacity-50"
          >
            <Send size={15} className="ml-0.5" />
          </motion.button>
        ) : (
          <motion.button
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            type="button"
            disabled
            title="Voice messages are not available"
            aria-label="Voice messages are not available"
            className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-white/[0.04] text-gray-600 opacity-50"
          >
            <Mic size={15} />
          </motion.button>
        )}
      </div>
    </div>
  );
}