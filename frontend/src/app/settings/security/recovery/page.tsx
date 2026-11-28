'use client';
import { useEffect, useRef, useState } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { SettingsGroup } from '@/components/settings/SettingsUI';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPost } from '@/lib/apiClient';

export default function RecoveryPage() {
  const { token } = useAuth();
  const [remaining,setRemaining] = useState<number|null>(null);
  const [enabled,setEnabled] = useState<boolean|null>(null);
  const [code,setCode] = useState('');
  const [fresh,setFresh] = useState<string[]>([]);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    if (token) Promise.all([apiGet<{enabled:boolean}>('/api/auth/2fa/status',token,{skipCache:true}),apiGet<{remainingCodes:number}>('/api/auth/2fa/backup-codes',token,{skipCache:true})])
      .then(([status,codes]) => {if(active){setEnabled(status.enabled);setRemaining(codes.remainingCodes);}}).catch(()=>{if(active)setError('Could not load recovery-code status.');});
    return () => {active=false;};
  },[token]);
  const generate = async () => {
    if(!token || !enabled || lock.current || !/^\d{6}$/.test(code) || !window.confirm('Replace your existing recovery codes? Old codes will stop working.')) return;
    lock.current=true;setBusy(true);setError('');setFresh([]);
    try {
      const result=await apiPost<{backupCodes:string[]}>('/api/auth/2fa/regenerate-backup-codes',{token:code},token,undefined,{noRetry:true});
      setFresh(result.backupCodes);setRemaining(result.backupCodes.length);
    } catch {setError('Could not regenerate codes. Use a fresh authenticator code and try again.');}
    finally{setCode('');lock.current=false;setBusy(false);}
  };
  return <div className="space-y-5 pb-24">
    <PageHeader sticky bleed title="Recovery codes" back="/settings/security" />
    <p className="text-sm opacity-75">Recovery codes can help you sign in if your authenticator is unavailable. Each code is single-use.</p>
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    <SettingsGroup title="Recovery status">
      <p className="p-4 text-sm">{enabled===null?'Status unavailable or loading.':!enabled?'Enable two-factor authentication first.':remaining+' unused codes'}</p>
    </SettingsGroup>
    {enabled && <SettingsGroup title="Generate new recovery codes">
      <form className="space-y-3 p-4" onSubmit={event=>{event.preventDefault();void generate();}}>
        <p className="text-sm opacity-75">Enter a fresh authenticator code. Generating new codes invalidates the previous set.</p>
        <input aria-label="Authenticator code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={event=>setCode(event.target.value.replace(/\D/g,'').slice(0,6))} maxLength={6} className="settings-input w-full" />
        <button type="submit" disabled={busy||code.length!==6} className="btn-accent w-full disabled:opacity-50">{busy?'Generating…':'Generate recovery codes'}</button>
      </form>
    </SettingsGroup>}
    {fresh.length>0 && <SettingsGroup title="Save these codes now">
      <div className="p-4 space-y-3"><p className="text-sm opacity-75">Store these somewhere safe. They will not be displayed again.</p><div className="grid grid-cols-2 gap-2">{fresh.map(value=><code key={value} className="rounded bg-[var(--surface)] p-2 text-center text-sm">{value}</code>)}</div><button type="button" onClick={()=>setFresh([])} className="min-h-10 text-sm text-[var(--vanta-gold)]">Hide codes</button></div>
    </SettingsGroup>}
  </div>;
}
