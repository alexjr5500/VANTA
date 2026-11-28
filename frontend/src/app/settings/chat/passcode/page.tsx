'use client';

import { useEffect, useRef, useState } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { useAuth } from '@/context/AuthContext';
import { readChatLock, removeChatPin, setChatPin, validChatPin } from '@/lib/chatPasscode';

function PasscodeForm({ userId }: { userId: string }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const pending = useRef(false);
  useEffect(() => {
    try { setConfigured(!!readChatLock(userId)); }
    catch { setError('Cannot read the chat lock on this device.'); }
  }, [userId]);
  const submit = async (remove = false) => {
    if (pending.current || configured === null) return;
    setMessage('');
    setError('');
    if (configured && !validChatPin(current)) { setError('Enter your current six-digit passcode.'); return; }
    if (!remove && (!validChatPin(next) || next !== confirm)) { setError('Enter and confirm the same six-digit passcode.'); return; }
    if (remove && !window.confirm('Remove the chat screen lock from this device?')) return;
    pending.current = true;
    setBusy(true);
    try {
      if (remove) await removeChatPin(userId, current);
      else await setChatPin(userId, next, configured ? current : undefined);
      setConfigured(!remove);
      setMessage(remove ? 'Chat passcode removed.' : 'Chat passcode saved.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not update passcode.'); }
    finally {
      setCurrent(''); setNext(''); setConfirm(''); setBusy(false); pending.current = false;
    }
  };
  const inputs = [
    ...(configured ? [{ label: 'Current passcode', value: current, set: setCurrent }] : []),
    { label: 'New passcode', value: next, set: setNext },
    { label: 'Confirm new passcode', value: confirm, set: setConfirm },
  ];
  return <div className="space-y-5">
    <p className="text-sm leading-6 opacity-80">Lock the Chat screen on this device. Chat will lock when you leave the screen or background the app.</p>
    <p className="text-xs leading-5 opacity-70">This is a local screen lock, not encryption or account authentication. It does not protect notifications, call overlays, exports or direct API access. Clearing browser or app data removes the lock. Remember your passcode.</p>
    {configured !== null && <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <p className="text-sm font-medium">Passcode is {configured ? 'enabled' : 'disabled'} on this device.</p>
      {inputs.map(({ label, value, set }) => <label key={label} className="block space-y-2 text-sm"><span>{label}</span>
        <input type="password" inputMode="numeric" autoComplete="off" maxLength={6} disabled={busy} value={value} onChange={event => set(event.target.value.replace(/\D/g, '').slice(0, 6))} className="min-h-12 w-full rounded-xl border border-white/15 bg-[var(--surface)] px-3 tracking-widest" />
      </label>)}
      <button type="submit" disabled={busy} className="min-h-12 w-full rounded-xl bg-[var(--vanta-gold)] font-semibold text-[#1f2630] disabled:opacity-50">{busy ? 'Saving…' : configured ? 'Change passcode' : 'Enable passcode'}</button>
      {configured && <button type="button" disabled={busy} onClick={() => void submit(true)} className="min-h-12 w-full rounded-xl border border-red-400/50 text-sm font-medium text-red-400 disabled:opacity-50">Remove passcode</button>}
    </form>}
    {message && <p role="status" className="text-sm text-[var(--vanta-gold)]">{message}</p>}
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
  </div>;
}

export default function ChatPasscodePage() {
  const { user } = useAuth();
  return <div className="space-y-5 pb-24">
    <PageHeader sticky bleed title="Chat passcode" back="/settings/chat" />
    {user?.id ? <PasscodeForm key={user.id} userId={user.id} /> : <p role="status">Loading account…</p>}
  </div>;
}
