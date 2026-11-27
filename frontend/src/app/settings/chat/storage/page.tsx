'use client';

import { useEffect, useState } from 'react';
import { Database, Download, Wifi } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { SettingsGroup, SettingsLink, ToggleRow } from '@/components/settings/SettingsUI';

import { readChatDataSaver, writeChatDataSaver } from '@/lib/chatDataSaver';

const format = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1) + ' MB';

export default function ChatStoragePage() {
  const [dataSaver, setDataSaver] = useState(false);
  const [dataReady, setDataReady] = useState(false);
  const [dataError, setDataError] = useState('');
  useEffect(() => { setDataSaver(readChatDataSaver()); setDataReady(true); }, []);
  const changeDataSaver = (enabled: boolean) => {
    try { writeChatDataSaver(enabled); setDataSaver(enabled); setDataError(''); }
    catch { setDataError('Could not save your device preference.'); }
  };
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (navigator.storage?.estimate) {
          const result = await navigator.storage.estimate();
          if (active) setEstimate(result);
        }
      } catch { /* Unsupported storage context. */ }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, []);

  return <div className="space-y-5 pb-24">
    <PageHeader sticky bleed title="Storage and data" back="/settings/chat" />
    <SettingsGroup title="Data usage">
      <ToggleRow icon={Wifi} title="Reduce chat media data usage" description="Do not load voice notes or video previews until you choose to play or open them." checked={dataSaver} disabled={!dataReady} onChange={changeDataSaver} />
      {dataError && <p role="alert" className="px-4 py-2 text-sm text-red-400">{dataError}</p>}
    </SettingsGroup>
    <SettingsGroup title="Device storage">
      <div className="px-4 py-4 space-y-2">
        <p className="text-lg font-semibold">{loading ? 'Checking…' : typeof estimate?.usage === 'number' ? format(estimate.usage) : 'Unavailable'}</p>
        <p className="text-sm opacity-70">Estimated storage used by VANTA in this browser or WebView, not chat-only usage.</p>
        {typeof estimate?.quota === 'number' && <p className="text-xs opacity-65">Estimated browser quota: {format(estimate.quota)}</p>}
      </div>
      <SettingsLink href="/settings/device" icon={Database} title="Manage app cache" description="Free device cache without deleting chat history" />
      <SettingsLink href="/settings/content" icon={Wifi} title="Media and data preferences" description="Configure feed and video data usage" />
      <SettingsLink href="/settings/account/archive" icon={Download} title="Download your data" />
    </SettingsGroup>
  </div>;
}
