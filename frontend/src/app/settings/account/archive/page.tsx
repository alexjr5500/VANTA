'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { SettingsGroup } from '@/components/settings/SettingsUI';
import { useAuth } from '@/context/AuthContext';
import { exportApi } from '@/lib/complianceApi';

type ExportItem = { id: string; status: string; createdAt: string; expiresAt?: string | null };
const pending = (item: ExportItem) => ['PENDING', 'PROCESSING'].includes(item.status);
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Please try again.';

export default function ArchivePage() {
  const { token } = useAuth();
  const [items, setItems] = useState<ExportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const requestLock = useRef(false);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    if (!token) return;
    const current = ++generation.current;
    try {
      const result = await exportApi.getExports();
      if (!Array.isArray(result)) throw new Error('Unexpected archive response.');
      if (generation.current === current) { setItems(result); setError(''); }
    } catch (caught) {
      if (generation.current === current) setError(errorMessage(caught));
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    setItems([]);
    setLoading(true);
    setMessage('');
    setError('');
    if (token) void refresh();
    return () => { generation.current += 1; };
  }, [token, refresh]);

  const hasPending = items.some(pending);
  useEffect(() => {
    if (!token || !hasPending) return;
    const timer = window.setInterval(() => { void refresh(); }, 15000);
    return () => window.clearInterval(timer);
  }, [token, hasPending, refresh]);

  const requestArchive = async () => {
    if (!token || requestLock.current || hasPending) return;
    requestLock.current = true;
    setRequesting(true);
    setError('');
    setMessage('');
    try {
      await exportApi.requestExport();
      setMessage('Archive requested. You will be notified when it is ready.');
      await refresh();
    } catch (caught) { setError(errorMessage(caught)); }
    finally { requestLock.current = false; setRequesting(false); }
  };

  const download = async (id: string) => {
    if (!token || downloading) return;
    setDownloading(id);
    setError('');
    try { await exportApi.download(id); }
    catch (caught) { setError(errorMessage(caught)); }
    finally { setDownloading(null); }
  };

  return (
    <div className="space-y-5 pb-24">
      <PageHeader sticky bleed title="Download your data" back="/settings/account" />
      <p className="text-sm leading-6 text-[var(--foreground)] opacity-75">Request a ZIP archive of your VANTA account data. Completed archives are available for seven days.</p>
      <button type="button" onClick={() => void requestArchive()} disabled={!token || loading || requesting || hasPending}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--vanta-gold)] px-4 font-semibold text-[#1f2630] disabled:opacity-50">
        <Download size={18} aria-hidden="true" /> {requesting ? 'Requesting…' : hasPending ? 'Archive being prepared' : 'Request archive'}
      </button>
      {message && <p role="status" className="text-sm text-[var(--foreground)]">{message}</p>}
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <SettingsGroup title="Archive history" right={<button type="button" aria-label="Refresh archives" onClick={() => void refresh()} disabled={!token} className="p-2 text-[var(--vanta-gold)]"><RefreshCw size={17} /></button>}>
        {loading ? <p className="px-4 py-5 text-sm opacity-70">Loading archives…</p> : items.length === 0 ? <p className="px-4 py-5 text-sm opacity-70">{error ? 'Could not load archives.' : 'No archive requests yet.'}</p> : items.map((item) => {
          const expired = !!item.expiresAt && Date.parse(item.expiresAt) <= Date.now();
          return (
            <div key={item.id} className="flex min-h-16 items-center gap-3 px-4 py-3">
              <Download size={20} className="shrink-0 text-[var(--vanta-gold)]" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{expired ? 'Expired' : item.status.toLowerCase().replace(/^./, (letter) => letter.toUpperCase())}</p>
                <p className="text-xs opacity-65">{new Date(item.createdAt).toLocaleString()}</p>
                {item.expiresAt && !expired && <p className="text-xs opacity-65">Expires {new Date(item.expiresAt).toLocaleString()}</p>}
              </div>
              {item.status === 'COMPLETED' && !expired && <button type="button" disabled={downloading !== null} onClick={() => void download(item.id)} className="min-h-11 shrink-0 px-2 text-sm font-medium text-[var(--vanta-gold)] disabled:opacity-50">{downloading === item.id ? 'Downloading…' : 'Download'}</button>}
            </div>
          );
        })}
      </SettingsGroup>
    </div>
  );
}
