'use client';

import React, { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

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
  openPostModal: () => void;
  openStoryModal: () => void;
  openGoLiveModal: () => void;
  openReelUploader: () => void;
  closeAll: () => void;
}

const ContentCreationContext = createContext<ContentCreationState | null>(null);

export function ContentCreationProvider({ children }: { children: ReactNode }) {
  const [activeFlow, setActiveFlow] = useState<CreationFlow>(null);
  const [createHubOpen, setCreateHubOpen] = useState(false);
  const [liveDraft, setLiveDraftState] = useState<LiveDraft | null>(null);

  const setLiveDraft = useCallback((draft: LiveDraft) => setLiveDraftState(draft), []);
  const clearLiveDraft = useCallback(() => setLiveDraftState(null), []);

  const openCreateHub = useCallback(() => setCreateHubOpen(true), []);
  const closeCreateHub = useCallback(() => setCreateHubOpen(false), []);

  const openPostModal = useCallback(() => {
    setActiveFlow('post');
  }, []);

  const openGoLiveModal = useCallback(() => {
    setActiveFlow('live');
  }, []);

  const openStoryModal = useCallback(() => {
    setActiveFlow('story');
  }, []);

  const openReelUploader = useCallback(() => {
    setActiveFlow('reel');
  }, []);

  const closeAll = useCallback(() => {
    setActiveFlow(null);
    setCreateHubOpen(false);
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
        openPostModal,
        openStoryModal,
        openGoLiveModal,
        openReelUploader,
        closeAll,
      }}
    >
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