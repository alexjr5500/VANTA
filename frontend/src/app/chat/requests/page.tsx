'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { SettingsGroup } from '@/components/settings/SettingsUI';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPost, apiPut } from '@/lib/apiClient';

type Peer = { id: string; username: string };
type RequestItem = { id: string; sender: Peer; recipient: Peer; status: 'PENDING' | 'ACCEPTED' | 'DECLINED'; createdAt: string };
type Inbox = { incoming: RequestItem[]; outgoing: RequestItem[] };
export default function ChatRequestsPage() {
  const { token } = useAuth();
  const router = useRouter();
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const lock = useRef(false);
  useEffect(() => { setUsername(new URLSearchParams(window.location.search).get('to') || ''); }, []);
  useEffect(() => {
    let active = true;
    setInbox(null);
    setError('');
    if (token) apiGet<Inbox>('/api/messages/requests', token, { skipCache: true })
      .then(data => { if (active) setInbox(data); })
      .catch(() => { if (active) setError('Could not load requests.'); });
    return () => { active = false; };
  }, [token, revision]);

  const run = async (action: () => Promise<void>) => {
    if (!token || lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not complete action.'); }
    finally { lock.current = false; setBusy(false); }
  };

  const submit = () => run(async () => {
    const result = await apiPost<RequestItem>('/api/messages/requests', { username }, token);
    setNotice(result.status === 'PENDING' ? 'Request is pending approval.' : result.status === 'ACCEPTED' ? 'This contact has already approved your request.' : 'This contact has declined your request.');
    setUsername(''); setRevision(value => value + 1);
  });

  const review = (item: RequestItem, status: 'ACCEPTED' | 'DECLINED') => run(async () => {
    await apiPut('/api/messages/requests/' + encodeURIComponent(item.id), { status }, token);
    setNotice(status === 'ACCEPTED' ? 'Request accepted. This person may now start a chat, subject to your privacy settings.' : 'Request declined.');
    setRevision(value => value + 1);
  });
  const openChat = (peer: Peer) => run(async () => {
    const result = await apiPost<{ conversation: { id: string } }>('/api/messages/start', { participantIds: [peer.id] }, token);
    router.push('/chat?conversation=' + encodeURIComponent(result.conversation.id));
  });

  return <div className="space-y-5 pb-24">
    <PageHeader sticky bleed title="Message requests" back="/chat" />
    <p className="text-sm opacity-75">Request permission to start a direct chat. No message content is sent before approval. Account privacy and blocks still apply.</p>
    <SettingsGroup title="Send a contact request">
      <form className="space-y-3 p-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <label className="block text-sm" htmlFor="request-username">VANTA username</label>
        <input id="request-username" value={username} onChange={event => setUsername(event.target.value)} maxLength={31} placeholder="@username" className="min-h-12 w-full rounded-xl border border-white/15 bg-[var(--surface)] px-3" />
        <button type="submit" disabled={busy || !username.trim() || !token} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--vanta-gold)] font-semibold text-[#1f2630] disabled:opacity-50"><UserPlus size={18} /> Send request</button>
      </form>
    </SettingsGroup>
    {notice && <p role="status" className="text-sm text-[var(--vanta-gold)]">{notice}</p>}
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    <button type="button" disabled={busy} onClick={() => setRevision(value => value + 1)} className="min-h-10 text-sm text-[var(--vanta-gold)]">Refresh requests</button>
    <SettingsGroup title="Incoming requests">
      {!inbox ? <p className="p-4 text-sm opacity-70">{error ? 'Inbox unavailable.' : 'Loading…'}</p> : inbox.incoming.length === 0 ? <p className="p-4 text-sm opacity-70">No pending incoming requests.</p> : inbox.incoming.map(item => <div key={item.id} className="space-y-2 px-4 py-3">
        <p className="text-sm font-medium">@{item.sender.username}</p><p className="text-xs opacity-65">{new Date(item.createdAt).toLocaleString()}</p>
        <div className="flex gap-3"><button type="button" disabled={busy} onClick={() => void review(item, 'ACCEPTED')} className="min-h-11 flex-1 rounded-xl bg-[var(--vanta-gold)] text-sm font-medium text-[#1f2630] disabled:opacity-50">Accept</button><button type="button" disabled={busy} onClick={() => void review(item, 'DECLINED')} className="min-h-11 flex-1 rounded-xl border border-white/20 text-sm disabled:opacity-50">Decline</button></div>
      </div>)}
    </SettingsGroup>
    <SettingsGroup title="Outgoing requests">
      {!inbox ? <p className="p-4 text-sm opacity-70">{error ? 'Inbox unavailable.' : 'Loading…'}</p> : inbox.outgoing.length === 0 ? <p className="p-4 text-sm opacity-70">No outgoing requests.</p> : inbox.outgoing.map(item => <div key={item.id} className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">@{item.recipient.username}</p><p className="text-xs opacity-65">{item.status === 'PENDING' ? 'Pending' : item.status === 'ACCEPTED' ? 'Accepted' : 'Declined'}</p></div>
        {item.status === 'ACCEPTED' && <button type="button" disabled={busy} onClick={() => void openChat(item.recipient)} className="min-h-11 px-2 text-sm text-[var(--vanta-gold)] disabled:opacity-50">Open chat</button>}
      </div>)}
    </SettingsGroup>
  </div>;
}
