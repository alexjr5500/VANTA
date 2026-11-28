'use client';

/* ═══════════════════════════════════════════════════════════════
   Device & Storage Settings
   Clear cache performs a real cache wipe (Cache Storage API + tainted
   URL caches VANTA owns) and reports success only when it succeeded.
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react';
import { HardDrive, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/Toast';
import { SettingsGroup } from '@/components/settings/SettingsUI';

export default function DeviceSettingsPage() {
  const toast = useToast();
  const [clearing, setClearing] = useState(false);
  const [estimate, setEstimate] = useState<number|null>(null);
  const [count,setCount]=useState<number|null>(null);
  const [revision,setRevision]=useState(0);
  const lock=useRef(false);
  useEffect(()=>{let active=true;void (async()=>{try{const e=await navigator.storage?.estimate?.();if(active)setEstimate(typeof e?.usage==='number'?e.usage:null);}catch{if(active)setEstimate(null);}try{const keys=typeof caches!=='undefined'?await caches.keys():null;if(active)setCount(keys?.length??null);}catch{if(active)setCount(null);}})();return()=>{active=false;};},[revision]);

  const handleClearCache = async () => {
    if (lock.current) return;
    if (typeof caches === 'undefined') {toast.error('Cache storage unavailable','This browser does not expose Cache Storage.');return;}
    if (!window.confirm('Clear VANTA browser Cache Storage? Chat messages, account data, drafts and downloaded files will not be deleted.')) return;
    lock.current=true;setClearing(true);
    try {
      const keys=await caches.keys();
      const results=await Promise.allSettled(keys.map(key=>caches.delete(key)));
      const failed=results.filter(result=>result.status==='rejected').length;
      const removed=results.filter(result=>result.status==='fulfilled'&&result.value).length;
      if(failed)toast.error('Cache partially cleared',removed+' cache stores removed; some could not be cleared.');
      else toast.success(removed?removed+' cache stores cleared':'No cache stores to clear');
    }catch{toast.error('Could not clear cache','Please try again.');}
    finally{lock.current=false;setClearing(false);setRevision(value=>value+1);}
  };

  return (
    <div className="space-y-6 pb-24">
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

      <SettingsGroup title="Storage usage">
        <div className="p-4 space-y-2"><p className="text-xl font-semibold">{estimate===null?'Unavailable':(estimate/1048576).toFixed(1)+' MB'}</p><p className="text-xs opacity-75">Estimated total origin storage, not just cached media. {count===null?'Cache store count unavailable.':count+' Cache Storage stores.'}</p><button type="button" disabled={clearing} onClick={()=>setRevision(value=>value+1)} className="text-sm min-h-10 text-[var(--vanta-gold)]">Refresh usage</button></div>
      </SettingsGroup>
      <SettingsGroup
        icon={HardDrive}
        title="Storage"
        description="Free up space on this device"
      >
        <div className="flex min-h-14 items-center gap-3 px-3.5 py-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-white/[0.06] bg-white/[0.03] text-white/40">
            <Trash2 size={17} strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-white">Cache</p>
            <p className="mt-0.5 text-xs text-white/30">
              Clear browser Cache Storage only. Does not clear Android system cache or delete messages.
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