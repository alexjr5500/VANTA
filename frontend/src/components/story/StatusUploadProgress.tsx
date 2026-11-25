'use client';

import { useSyncExternalStore } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { getJobs, subscribeUploads, retryUpload, cancelUpload, dismissUpload, type UploadJob } from '@/lib/uploads/store';

const empty: UploadJob[] = [];
const serverSnapshot = () => empty;

export default function StatusUploadProgress() {
  const jobs = useSyncExternalStore(subscribeUploads, getJobs, serverSnapshot).filter(job => job.kind === 'story' && job.phase !== 'completed');
  if (!jobs.length) return null;
  return (
    <div className="space-y-1.5 border-t border-white/[0.06] px-3 py-2" aria-label="Status uploads">
      {jobs.map(job => {
        const failed = job.phase === 'failed' || job.phase === 'cancelled';
        const active = job.phase === 'starting' || job.phase === 'uploading';
        const label = failed ? 'Status upload failed' : job.phase === 'processing' ? 'Publishing Status…' : job.phase === 'starting' ? 'Preparing Status…' : `Uploading Status · ${Math.round(job.progress)}%`;
        return (
          <div key={job.id} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className={failed ? 'text-[#ff9b9b]' : 'text-[#dfbd55]'} role="status">{label}</span>
                <span className="max-w-[42%] truncate text-white/45">{job.fileName}</span>
              </div>
              {!failed && <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="Status upload" aria-valuenow={Math.round(job.progress)} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-[#c9a227]" style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }} /></div>}
              {failed && job.error && <p className="mt-0.5 break-words text-[11px] leading-4 text-white/65">{job.error}</p>}
            </div>
            {failed && <button type="button" aria-label="Retry Status upload" disabled={job.disabled} onClick={() => retryUpload(job)} className="grid h-8 w-8 shrink-0 place-items-center text-[#dfbd55] disabled:opacity-40"><RefreshCw size={15} /></button>}
            {(failed || active) && <button type="button" aria-label={failed ? 'Dismiss Status upload' : 'Cancel Status upload'} onClick={() => failed ? dismissUpload(job.id) : cancelUpload(job)} className="grid h-8 w-8 shrink-0 place-items-center text-white/50"><X size={16} /></button>}
          </div>
        );
      })}
    </div>
  );
}
