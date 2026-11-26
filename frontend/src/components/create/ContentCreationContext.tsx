'use client';

import React, { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';
import type { QuoteRef } from '@/lib/quotePost';

type CreationFlow = 'post' | 'story' | 'live' | 'reel' | null;

/** Draft authored in the "+" Go Live modal, carried into the Live Studio so
 *  a user's setup (title, category, thumbnail) is never lost on navigation. */
export interface LiveDraft {
  title: string;
  category: string;
  thumbnailUrl?: string;
}

interface ContentCreationState {
  activeFlow: CreationFlow;
  createHubOpen: boolean;
  liveDraft: LiveDraft | null;
  setLiveDraft: (draft: LiveDraft) => void;
  clearLiveDraft: () => void;
  openCreateHub: () => void;
  closeCreateHub: () => void;
  /** Text pre-filled into the post composer (used by Quote). */
  postPrefill: string;
  /** Post being quoted in the composer (shown as a card, URL appended on publish). */
  quoteTarget: QuoteRef | null;
  openQuotePost: (prefill: string | QuoteRef) => void;
  openPostModal: () => void;
  openStoryModal: () => void;
  openGoLiveModal: () => void;
  reelFile: File | null;
  openReelUploader: () => void;
  closeAll: () => void;
}

const ContentCreationContext = createContext<ContentCreationState | null>(null);

export function ContentCreationProvider({ children }: { children: ReactNode }) {
  const [activeFlow, setActiveFlow] = useState<CreationFlow>(null);
  const [createHubOpen, setCreateHubOpen] = useState(false);
  const [postPrefill, setPostPrefill] = useState('');
  const [quoteTarget, setQuoteTarget] = useState<QuoteRef | null>(null);
  const [reelFile, setReelFile] = useState<File | null>(null);
  const reelInput = useRef<HTMLInputElement>(null);
  const [liveDraft, setLiveDraftState] = useState<LiveDraft | null>(null);

  const setLiveDraft = useCallback((draft: LiveDraft) => setLiveDraftState(draft), []);
  const clearLiveDraft = useCallback(() => setLiveDraftState(null), []);

  const openCreateHub = useCallback(() => setCreateHubOpen(true), []);
  const closeCreateHub = useCallback(() => setCreateHubOpen(false), []);

  const openPostModal = useCallback(() => {
    setPostPrefill('');
    setQuoteTarget(null);
    setActiveFlow('post');
  }, []);

  const openQuotePost = useCallback((prefill: string | QuoteRef) => {
    if (typeof prefill === 'string') { setPostPrefill(prefill); setQuoteTarget(null); }
    else { setPostPrefill(''); setQuoteTarget(prefill); }
    setActiveFlow('post');
  }, []);

  const openGoLiveModal = useCallback(() => {
    setActiveFlow('live');
  }, []);

  const openStoryModal = useCallback(() => {
    setActiveFlow('story');
  }, []);

  const openReelUploader = useCallback(() => {
    // Keep the input mounted and invoke the OS picker synchronously from the
    // original tap. A later effect can lose browser transient user activation.
    const input = reelInput.current;
    if (!input) return;
    input.value = '';
    input.click();
  }, []);

  const closeAll = useCallback(() => {
    setActiveFlow(null);
    setCreateHubOpen(false);
    setQuoteTarget(null);
    setReelFile(null);
  }, []);

  return (
    <ContentCreationContext.Provider
      value={{
        activeFlow,
        createHubOpen,
        liveDraft,
        setLiveDraft,
        clearLiveDraft,
        openCreateHub,
        closeCreateHub,
        postPrefill,
        quoteTarget,
        openQuotePost,
        openPostModal,
        openStoryModal,
        openGoLiveModal,
        reelFile,
        openReelUploader,
        closeAll,
      }}
    >
      <input
        ref={reelInput}
        type="file"
        accept="video/*,video/x-vanta-reel-picker,.mp4,.webm,.mov,.m4v"
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose or capture a Reel video"
        onChange={event => {
          const selected = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (!selected) return;
          setReelFile(selected);
          setActiveFlow('reel');
        }}
      />
      {children}
    </ContentCreationContext.Provider>
  );
}

export function useContentCreation() {
  const ctx = useContext(ContentCreationContext);
  if (!ctx) {
    throw new Error('useContentCreation must be used within a ContentCreationProvider');
  }
  return ctx;
}