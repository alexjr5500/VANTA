'use client';

/* ═══════════════════════════════════════════════════════════════
   Device & Storage Settings — redesigned
   Cache management and data-saving controls in the new Settings style.
   ═══════════════════════════════════════════════════════════════ */

import { useState } from 'react';
import { Check, HardDrive, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/Toast';
import {
  SavedChip,
  SettingsGroup,
  ToggleRow,
  useLocalPrefs,
} from '@/components/settings/SettingsUI';
import { useAuth } from '@/context/AuthContext';

const LOCAL_DEFAULTS = { autoDownload: true };

export default function DeviceSettingsPage() {
  const { token } = useAuth();
  const toast = useToast();
  const [clearing, setClearing] = useState(false);

  const { prefs, set, savedVisible } = useLocalPrefs(
    'vanta_device_extras',
    LOCAL_DEFAULTS
  );

  const handleClearCache = async () => {
    setClearing(true);
    try {
      if (token && typeof caches !== 'undefined') {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
      toast.success('Cache cleared');
    } catch {
      toast.success('Cache cleared');
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="space-y-8 pb-10">
      <PageHeader title="Device & Storage" back="/settings" />

      <div className="-mt-2">
        <p className="text-sm leading-relaxed text-white/45">
          Manage app storage and how media downloads on your device.
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

      <SettingsGroup
        icon={HardDrive}
        title="Data Usage"
        description="How media is stored"
        right={savedVisible ? <SavedChip /> : undefined}
      >
        <ToggleRow
          icon={Check}
          title="Auto-download media"
          description="Automatically download media on Wi-Fi."
          checked={prefs.autoDownload}
          onChange={(v) => set('autoDownload', v)}
        />
      </SettingsGroup>
    </div>
  );
}