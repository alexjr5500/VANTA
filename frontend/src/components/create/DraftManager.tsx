'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Trash2, Calendar, Clock, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Draft {
  id: string;
  content: string;
  media: { type: 'image' | 'video'; url: string; name: string }[];
  createdAt: string;
  visibility: 'public' | 'followers';
}

const STORAGE_KEY = 'vanta_drafts';
// Legacy key from the pre-VANTA app: still read on load so existing drafts are
// not lost during the migration to the vanta_* storage key.
const LEGACY_STORAGE_KEY = 'sparklive_drafts';

function loadDrafts(): Draft[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveDrafts(drafts: Draft[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // Storage full or unavailable
  }
}

interface DraftManagerProps {
  onSelectDraft: (draft: Draft) => void;
  onClose: () => void;
  className?: string;
}

export default function DraftManager({ onSelectDraft, onClose, className }: DraftManagerProps) {
  const [drafts, setDrafts] = useState<Draft[]>([]);

  useEffect(() => {
    setDrafts(loadDrafts());
  }, []);

  const handleDelete = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = drafts.filter((d) => d.id !== id);
    setDrafts(updated);
    saveDrafts(updated);
  }, [drafts]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={cn(
        'w-full max-h-[400px] rounded-2xl border border-white/[0.08] bg-[#0e0e16]/95 backdrop-blur-2xl shadow-2xl overflow-hidden',
        className
      )}
      role="dialog"
      aria-label="Saved drafts"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-[#d6a83f]" />
          <h3 className="text-sm font-semibold text-white">Saved Drafts</h3>
          <span className="text-[10px] text-gray-500 bg-white/[0.04] px-2 py-0.5 rounded-full">
            {drafts.length}
          </span>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-gray-400 hover:text-white hover:bg-white/[0.05] transition"
          aria-label="Close drafts"
        >
          <X size={14} />
        </button>
      </div>

      <div className="overflow-y-auto max-h-[340px] scrollbar-hide">
        {drafts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-gray-500">
            <FileText size={32} className="mb-2 opacity-30" />
            <p className="text-sm font-medium">No saved drafts</p>
            <p className="text-xs mt-1">Drafts will appear here when you save them</p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {drafts.map((draft) => (
              <button
                key={draft.id}
                onClick={() => onSelectDraft(draft)}
                className="w-full text-left rounded-xl p-3 hover:bg-white/[0.04] transition group"
                aria-label={`Load draft from ${formatDate(draft.createdAt)}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white/90 line-clamp-2 leading-relaxed">
                      {draft.content || (draft.media.length > 0 ? `📎 ${draft.media.length} media file(s)` : 'Empty draft')}
                    </p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="flex items-center gap-1 text-[10px] text-gray-500">
                        <Calendar size={10} />
                        {formatDate(draft.createdAt)}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-gray-500">
                        <Clock size={10} />
                        {formatTime(draft.createdAt)}
                      </span>
                      {draft.visibility && (
                        <span className="text-[10px] uppercase tracking-wider text-gray-600">
                          {draft.visibility}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDelete(draft.id, e)}
                    className="shrink-0 rounded-lg p-1.5 text-gray-500 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all"
                    aria-label={`Delete draft from ${formatDate(draft.createdAt)}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// Helper function to save a draft from the CreatePostModal
export function savePostDraft(content: string, media: { type: 'image' | 'video'; url: string; name: string }[], visibility: 'public' | 'followers') {
  const drafts = loadDrafts();
  const newDraft: Draft = {
    id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    content,
    media,
    createdAt: new Date().toISOString(),
    visibility,
  };
  drafts.unshift(newDraft);
  saveDrafts(drafts);
  return newDraft;
}

// Helper to delete a draft by id
export function deleteDraft(id: string) {
  const drafts = loadDrafts().filter((d) => d.id !== id);
  saveDrafts(drafts);
}