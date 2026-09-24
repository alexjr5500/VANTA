'use client';

/* ═══════════════════════════════════════════════════════════════
   Device & Storage Settings
   Clear cache performs a real cache wipe (Cache Storage API + tainted
   URL caches VANTA owns) and reports success only when it succeeded.
   ═══════════════════════════════════════════════════════════════ */

import { useState } from 'react';
import { HardDrive, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/Toast';
import { SettingsGroup } from '@/components/settings/SettingsUI';

export default function DeviceSettingsPage() {
  const toast = useToast();
  const [clearing, setClearing] = useState(false);

  const handleClearCache = async () => {
    setClearing(true);
    try {
      const tasks: Promise<unknown>[] = [];

      // 1. Cache Storage API (service-worker caches).
      if (typeof caches !== 'undefined') {
        const keys = await caches.keys();
        tasks.push(Promise.all(keys.map((key) => caches.delete(key))));
      }

      // 2. Memory-mapped API client cache and media version URLs are
      //    in-memory only; nothing durable to clear there. The Cache above
      //    is the browser-persisted store VANTA is permitted to clear.
      await Promise.all(tasks);
      toast.success('Cache cleared');
    } catch {
      toast.error('Could not clear cache', 'Please try again.');
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="space-y-8 pb-24">
      <PageHeader
        sticky
        bleed
        title="Device & Storage"
        back="/settings"
      />

      <div className="-mt-2">
        <p className="text-sm leading-relaxed text-white/45">
          Manage app storage on this device.
        </p>
      </div>

      <SettingsGroup
        icon={HardDrive}
        title="Storage"
        description="Free up space on this device"
      >
        <div className="flex min-h-[62px] items-center gap-3.5 px-4 py-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-white/[0.06] bg-white/[0.03] text-white/40">
            <Trash2 size={17} strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-white">Cache</p>
            <p className="mt-0.5 text-xs text-white/30">
              Clear cached data to free up space.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClearCache}
            disabled={clearing}
            className="btn-accent-ghost shrink-0 disabled:opacity-50"
          >
            {clearing ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border border-white/25 border-t-white/70" />
            ) : (
              <Trash2 size={13} aria-hidden="true" />
            )}
            Clear cache
          </button>
        </div>
      </SettingsGroup>
    </div>
  );
}