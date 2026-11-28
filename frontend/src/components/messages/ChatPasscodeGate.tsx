'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { LockKeyhole } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { chatLockKey, readChatLock, verifyChatPin } from '@/lib/chatPasscode';

type State = 'checking' | 'open' | 'locked' | 'error';

function DeviceGate({ userId, children }: { userId: string; children: ReactNode }) {
  const [state, setState] = useState<State>('checking');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const revision = useRef(0);
  const active = useRef(false);
  const inFlight = useRef(false);

  useEffect(() => {
    active.current = true;
    const check = () => {
      revision.current += 1;
      setPin('');
      setError('');
      try { setState(readChatLock(userId) ? 'locked' : 'open'); }
      catch { setState('error'); }
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') check(); };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === chatLockKey(userId)) check();
    };
    check();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', check);
    window.addEventListener('storage', onStorage);
    return () => {
      active.current = false;
      revision.current += 1;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', check);
      window.removeEventListener('storage', onStorage);
    };
  }, [userId]);

  const unlock = async () => {
    if (inFlight.current || pin.length !== 6) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    const current = revision.current;
    try {
      await verifyChatPin(userId, pin);
      if (active.current && current === revision.current && document.visibilityState === 'visible') setState('open');
    } catch (caught) {
      if (active.current && current === revision.current) setError(caught instanceof Error ? caught.message : 'Unable to unlock chat.');
    } finally {
      inFlight.current = false;
      if (active.current) { setPin(''); setBusy(false); }
    }
  };

  if (state === 'open') return <>{children}</>;
  return <div className="mx-auto flex min-h-[65vh] max-w-sm flex-col items-center justify-center gap-5 px-5 pb-20 text-center">
    <LockKeyhole size={36} className="text-[var(--vanta-gold)]" aria-hidden="true" />
    <h1 className="text-xl font-semibold">{state === 'checking' ? 'Checking chat lock' : 'Chat is locked'}</h1>
    {state === 'error' ? <p role="alert" className="text-sm opacity-80">Unable to read the device lock. Chat stays closed while the lock cannot be checked.</p> : state === 'locked' && <form className="w-full space-y-4" onSubmit={(event) => { event.preventDefault(); void unlock(); }}>
      <label className="block text-sm" htmlFor="unlock-chat">Enter your six-digit passcode</label>
      <input id="unlock-chat" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} disabled={busy} className="min-h-12 w-full rounded-xl border border-white/15 bg-[var(--surface)] px-4 text-center text-lg tracking-[0.4em]" />
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <button type="submit" disabled={busy || pin.length !== 6} className="min-h-12 w-full rounded-xl bg-[var(--vanta-gold)] font-semibold text-[#1f2630] disabled:opacity-50">{busy ? 'Checking…' : 'Unlock chat'}</button>
    </form>}
    <Link href="/settings/chat/passcode" className="text-sm text-[var(--vanta-gold)]">Manage chat passcode</Link>
    <Link href="/reels" className="text-sm opacity-70">Back to VANTA</Link>
  </div>;
}

export default function ChatPasscodeGate({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading || !user?.id) return <p role="status" className="p-5 text-sm opacity-70">Checking your account…</p>;
  return <DeviceGate key={user.id} userId={user.id}>{children}</DeviceGate>;
}
