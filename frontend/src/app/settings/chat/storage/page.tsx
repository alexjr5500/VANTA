'use client';

import { useEffect, useState } from 'react';
import { Database, Download, Wifi } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/apiClient';
import PageHeader from '@/components/ui/PageHeader';
import { SettingsGroup, SettingsLink, ToggleRow } from '@/components/settings/SettingsUI';

import { readChatDataSaver, writeChatDataSaver } from '@/lib/chatDataSaver';

const format = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1) + ' MB';

export default function ChatStoragePage() {
  const { token } = useAuth();
  const [uploads, setUploads] = useState<{ totalBytes: number; fileCount: number; categories: { type: string; bytes: number; count: number }[] } | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setUploads(null); setUploadError('');
    if (token) apiGet<NonNullable<typeof uploads>>('/api/messages/storage-usage', token, { skipCache: true })
      .then(data => { if (active) setUploads(data); })
      .catch(() => { if (active) setUploadError('Could not load chat uploads.'); });
    return () => { active = false; };
  }, [token, revision]);
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
  }, [revision]);

  return <div className="space-y-5 pb-24">
    <PageHeader sticky bleed title="Storage and data" back="/settings/chat" />
    <SettingsGroup title="Data usage">
      <ToggleRow icon={Wifi} title="Reduce chat media data usage" description="Do not load voice notes or video previews until you choose to play or open them." checked={dataSaver} disabled={!dataReady} onChange={changeDataSaver} />
      {dataError && <p role="alert" className="px-4 py-2 text-sm text-red-400">{dataError}</p>}
    </SettingsGroup>
    <SettingsGroup title="Message retention">
      <div className="space-y-2 px-4 py-4">
        <p className="text-sm font-medium">Group auto-expiry</p>
        <p className="text-sm opacity-70">When creating a group, its owner can choose a message expiry duration. Expired messages and their protected attachments are hidden from supported chat views and signed media access. This does not erase server files or copies previously downloaded.</p>
        <p className="text-xs opacity-65">Private attachments are served without a persistent browser-cache policy. There is no separate automatic deletion of your chat uploads from this device setting.</p>
      </div>
    </SettingsGroup>
    <SettingsGroup title="Your uploaded chat media">
      <div className="space-y-3 px-4 py-4">
        <p className="text-sm opacity-70">Server-recorded sizes of active chat uploads owned by your account. These are not device cache sizes or media uploaded by other people.</p>
        {uploads ? <>
          <p className="text-xl font-semibold">{format(uploads.totalBytes)} <span className="text-xs font-normal opacity-65">· {uploads.fileCount} files</span></p>
          {uploads.categories.map(category => <div key={category.type} className="space-y-1">
            <div className="flex justify-between text-sm"><span>{category.type.toLowerCase().replace(/^./, letter => letter.toUpperCase())} ({category.count})</span><span>{format(category.bytes)}</span></div>
            <div className="h-1.5 rounded-full bg-white/10"><div className="h-full rounded-full bg-[var(--vanta-gold)]" style={{ width: (uploads.totalBytes ? Math.min(100, category.bytes / uploads.totalBytes * 100) : 0) + '%' }} /></div>
          </div>)}
        </> : <p role={uploadError ? 'alert' : 'status'} className="text-sm opacity-75">{uploadError || 'Checking uploaded media…'}</p>}
        <button type="button" onClick={() => setRevision(value => value + 1)} className="min-h-10 text-sm text-[var(--vanta-gold)]">Refresh usage</button>
      </div>
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
