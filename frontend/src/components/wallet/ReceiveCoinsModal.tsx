'use client';

import VantaCoinIcon from '@/components/ui/VantaCoinIcon';

import { useEffect, useState } from 'react';
import { X, Copy, Share2, Shield, RefreshCw } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/apiClient';
import Avatar from '@/components/ui/Avatar';
import { useWalletDialog } from './useWalletDialog';

type ReceiveData = { username: string; link: string; qrCode: string };
interface Props { open: boolean; walletId?: string; onClose: () => void }

export default function ReceiveCoinsModal({ open, onClose }: Props) {
  const { token, user } = useAuth();
  const [data, setData] = useState<ReceiveData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const ref = useWalletDialog<HTMLDivElement>(open, onClose);
  useEffect(() => {
    let current = true;
    setData(null); setNotice(''); setError('');
    if (!open || !token) return;
    setLoading(true);
    apiGet<ReceiveData>('/api/wallets/receive-link', token, { skipCache: true }).then(result => {
      if (current) setData(result);
    }).catch(() => { if (current) setError('Could not generate your receiving link.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [open, token, retry]);
  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setNotice(label + ' copied.'); }
    catch { setNotice('Copy unavailable. Select and copy the displayed text.'); }
  }
  async function share() {
    if (!data) return;
    if (navigator.share) {
      try { await navigator.share({ title: 'Receive VANTA Coins', url: data.link }); return; }
      catch (err) { if (err instanceof Error && err.name === 'AbortError') return; }
    }
    await copy(data.link, 'Receiving link');
  }
  if (!open) return null;
  return <div className="fixed inset-0 z-[101] grid place-items-center bg-black/70 p-3" onClick={onClose}>
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Receive VANTA Coins" onClick={event => event.stopPropagation()} className="vanta-wallet-ui w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background-secondary)] p-4 sm:p-6">
      <header className="flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--text-primary)]"><VantaCoinIcon size={24} decorative />Receive VANTA</h2><button type="button" aria-label="Close" onClick={onClose} className="grid h-11 w-11 place-items-center"><X size={20}/></button></header>
      <div className="flex flex-col items-center gap-2 py-4">
        <Avatar size="xl" src={typeof user?.avatar === 'string' ? user.avatar : undefined} alt={user?.username || 'Your profile'} verified={Boolean(user?.verified)}/>
        <p className="break-all font-semibold">@{user?.username}</p>
        {loading && <p role="status" className="text-sm text-[var(--text-secondary)]">Generating receiving QR…</p>}
        {data && <><div className="rounded-lg bg-white p-2"><img src={data.qrCode} alt="QR code for your VANTA receiving link" width={240} height={240} className="h-auto max-w-full"/></div><p className="text-center text-xs text-[var(--text-secondary)]">Scan using a phone camera or share the link.</p></>}
      </div>
      {error && <div role="alert" className="rounded-xl border border-[var(--border)] p-3 text-sm">{error}<button type="button" onClick={() => setRetry(v => v + 1)} className="ml-2 min-h-11 text-[var(--vanta-gold-bright)]"><RefreshCw size={14} className="inline"/> Retry</button></div>}
      <button type="button" disabled={!user?.username} onClick={() => copy('@' + user?.username, 'Username')} className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)]"><Copy size={16}/>Copy username</button>
      {data && <><p className="my-3 select-all break-all border-y border-[var(--border)] py-3 text-xs text-[var(--text-secondary)]">{data.link}</p><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => copy(data.link, 'Receiving link')} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--border)]"><Copy size={15}/>Copy link</button><button type="button" onClick={share} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--vanta-gold)] font-semibold text-black"><Share2 size={15}/>Share</button></div></>}
      {notice && <p role="status" className="mt-2 text-sm">{notice}</p>}
      <p className="mt-4 flex gap-2 text-xs leading-relaxed text-[var(--text-secondary)]"><Shield className="shrink-0 text-[var(--vanta-gold-bright)]" size={16}/>A receiving link identifies your account, not a payment authorization. Never share your PIN, password or verification code.</p>
    </div>
  </div>;
}
