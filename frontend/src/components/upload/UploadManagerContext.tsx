'use client';

import React, { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  cancelUpload,
  dismissUpload,
  getActiveUploadCount,
  getJobs,
  retryUpload,
  startUpload,
  subscribeUploads,
  type StartUploadInput,
  type UploadJob,
} from '@/lib/uploads/store';

interface UploadManagerApi {
  jobs: UploadJob[];
  activeCount: number;
  startUpload: (input: StartUploadInput) => UploadJob;
  retryUpload: (job: UploadJob) => void;
  cancelUpload: (job: UploadJob) => void;
  dismissUpload: (jobId: string) => void;
}

const UploadManagerContext = createContext<UploadManagerApi | null>(null);

/**
 * Reactive bridge over the singleton upload store. Re-renders subscribers
 * whenever any job changes (progress/phase), regardless of which page/composer
 * is currently mounted — the indicator stays live across VANTA navigation.
 */
export function UploadManagerProvider({ children }: { children: ReactNode }) {
  const [, setVersion] = useState(0);

  useEffect(() => subscribeUploads(() => setVersion((version) => version + 1)), []);

  const api: UploadManagerApi = {
    jobs: getJobs(),
    activeCount: getActiveUploadCount(),
    startUpload,
    retryUpload,
    cancelUpload,
    dismissUpload,
  };

  return <UploadManagerContext.Provider value={api}>{children}</UploadManagerContext.Provider>;
}

export function useUploadManager(): UploadManagerApi {
  const ctx = useContext(UploadManagerContext);
  if (!ctx) {
    throw new Error('useUploadManager must be used within an UploadManagerProvider');
  }
  return ctx;
}