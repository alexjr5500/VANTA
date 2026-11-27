'use client';
import { useEffect, useState } from 'react';
import { KeyRound, Laptop } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { SettingsGroup, SettingsLink } from '@/components/settings/SettingsUI';
import { useAuth } from '@/context/AuthContext';
import { apiDelete, apiGet, apiPost } from '@/lib/apiClient';

type Item = { id: string; provider?: string; email?: string | null; displayName?: string | null; deviceName?: string | null; userAgent?: string | null; createdAt: string; expiresAt?: string };
export function AccountAccessInventory({ kind }: { kind: 'connected' | 'trusted' }) {
  const { token } = useAuth();
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [disconnectId,setDisconnectId] = useState('');
  const [password,setPassword] = useState('');
  const [code,setCode] = useState('');
  const [notice,setNotice] = useState('');
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
  const disconnect = async () => {
    if (!token || !disconnectId || !password || busy) return;
    setBusy(true);setError('');setNotice('');
    try {
      await apiPost(path+'/'+encodeURIComponent(disconnectId)+'/disconnect',{password,code},token,undefined,{noRetry:true});
      setDisconnectId('');setRevision(value=>value+1);setNotice('Sign-in account disconnected. Other sessions ended.');
    } catch (caught) {setError(caught instanceof Error?caught.message:'Could not disconnect account.');}
    finally {setPassword('');setCode('');setBusy(false);}
  };
  return <div className="space-y-5 pb-24">
    <PageHeader sticky bleed title={trusted ? 'Trusted devices' : 'Connected accounts'} back="/settings/security" />
    <p className="text-sm opacity-75">{trusted ? 'Review active trusted-device records. To terminate a signed-in session, use Active Sessions.' : 'Review external identities already linked to your VANTA account. Disconnect a sign-in method after confirming your verified VANTA password. Connecting a new identity is not available here yet.'}</p>
    {notice && <p role="status" className="text-sm text-[var(--vanta-gold)]">{notice}</p>}
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
        {!trusted && <button type="button" disabled={busy} onClick={()=>{setDisconnectId(item.id);setPassword('');setCode('');setError('');}} className="min-h-10 text-sm text-red-400 disabled:opacity-50">Disconnect</button>}
        {trusted && <button type="button" disabled={busy} onClick={() => void remove(item.id)} className="min-h-10 text-sm text-red-400 disabled:opacity-50">Remove</button>}
      </div>)}
    </SettingsGroup>
    {!trusted && disconnectId && <SettingsGroup title="Confirm disconnection">
      <form className="space-y-3 p-4" onSubmit={event=>{event.preventDefault();void disconnect();}}>
        <p className="text-sm opacity-75">Your VANTA email must be verified and you must have a working password. Other sessions will end. If 2FA is enabled, enter a fresh authenticator code.</p>
        <label className="block text-sm">Current password<input type="password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} className="settings-input w-full" /></label>
        <label className="block text-sm">Authenticator code (if enabled)<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={event=>setCode(event.target.value.replace(/\D/g,'').slice(0,6))} className="settings-input w-full" /></label>
        <button type="submit" disabled={busy||!password} className="min-h-11 w-full rounded-lg border border-red-400/50 text-red-400 disabled:opacity-50">Disconnect and end other sessions</button>
        <button type="button" disabled={busy} onClick={()=>{setDisconnectId('');setPassword('');setCode('');}} className="min-h-10 w-full text-sm opacity-75">Cancel</button>
      </form>
    </SettingsGroup>}
    {trusted && <SettingsGroup><SettingsLink href="/settings/security" title="Manage active sessions" /></SettingsGroup>}
  </div>;
}
