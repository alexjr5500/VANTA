'use client';
import { useEffect, useState } from 'react';
import { KeyRound, Laptop } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { SettingsGroup, SettingsLink } from '@/components/settings/SettingsUI';
import { useAuth } from '@/context/AuthContext';
import { apiDelete, apiGet } from '@/lib/apiClient';

type Item = { id: string; provider?: string; email?: string | null; displayName?: string | null; deviceName?: string | null; userAgent?: string | null; createdAt: string; expiresAt?: string };
export function AccountAccessInventory({ kind }: { kind: 'connected' | 'trusted' }) {
  const { token } = useAuth();
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const trusted = kind === 'trusted';
  const path = '/api/settings/' + (trusted ? 'trusted-devices' : 'connected-accounts');
  useEffect(() => {
    let active = true;
    setItems(null); setError('');
    if (token) apiGet<{ items: Item[] }>(path, token, { skipCache: true })
      .then(result => { if (active) setItems(result.items); })
      .catch(() => { if (active) setError('Unable to load. Try again.'); });
    return () => { active = false; };
  }, [token, path, revision]);
  const remove = async (id: string) => {
    if (!token || busy || !window.confirm('Remove this trusted-device record? This does not end an existing session.')) return;
    setBusy(true); setError('');
    try { await apiDelete(path + '/' + encodeURIComponent(id), token); setRevision(value => value + 1); }
    catch { setError('Could not remove device. Try again.'); }
    finally { setBusy(false); }
  };
  return <div className="space-y-5 pb-24">
    <PageHeader sticky bleed title={trusted ? 'Trusted devices' : 'Connected accounts'} back="/settings/security" />
    <p className="text-sm opacity-75">{trusted ? 'Review active trusted-device records. To terminate a signed-in session, use Active Sessions.' : 'Review external identities already linked to your VANTA account. Connecting or disconnecting a sign-in method is not available here yet.'}</p>
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    <button type="button" onClick={() => setRevision(value => value + 1)} disabled={busy} className="min-h-10 text-sm text-[var(--vanta-gold)]">Refresh</button>
    <SettingsGroup title={trusted ? 'Trusted records' : 'Linked identities'}>
      {!items ? <p className="p-4 text-sm opacity-70">{error || 'Loading…'}</p> : !items.length ? <p className="p-4 text-sm opacity-70">{trusted ? 'No active trusted devices.' : 'No connected external sign-in accounts.'}</p> : items.map(item => <div key={item.id} className="flex items-start gap-3 px-4 py-3">
        {trusted ? <Laptop size={20} className="shrink-0 text-[var(--vanta-gold)]" /> : <KeyRound size={20} className="shrink-0 text-[var(--vanta-gold)]" />}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="break-words text-sm font-medium">{trusted ? item.deviceName || 'Trusted device' : item.provider === 'google' ? 'Google' : item.provider === 'telegram' ? 'Telegram' : item.provider}</p>
          <p className="break-words text-xs opacity-75">{trusted ? item.userAgent || 'Device details unavailable' : item.email || item.displayName || 'Verified provider identity'}</p>
          <p className="text-xs opacity-65">Added {new Date(item.createdAt).toLocaleDateString()}</p>
          {item.expiresAt && <p className="text-xs opacity-65">Expires {new Date(item.expiresAt).toLocaleDateString()}</p>}
        </div>
        {trusted && <button type="button" disabled={busy} onClick={() => void remove(item.id)} className="min-h-10 text-sm text-red-400 disabled:opacity-50">Remove</button>}
      </div>)}
    </SettingsGroup>
    {trusted && <SettingsGroup><SettingsLink href="/settings/security" title="Manage active sessions" /></SettingsGroup>}
  </div>;
}
