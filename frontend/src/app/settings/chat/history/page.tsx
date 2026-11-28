'use client';

import { useEffect, useState } from 'react';
import { Phone, Video, RefreshCw } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { SettingsGroup } from '@/components/settings/SettingsUI';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/apiClient';

type CallItem = { id: string; username: string; direction: 'incoming' | 'outgoing'; type: string; status: string; createdAt: string; durationSeconds: number | null };
const labels: Record<string, string> = { RINGING: 'Ringing', ANSWERED: 'Answered', CANCELLED: 'Cancelled', DECLINED: 'Declined', ENDED: 'Ended', EXPIRED: 'Missed', UNREACHABLE: 'Unreachable' };

export default function HistoryPage() {
  const { token } = useAuth();
  const [items, setItems] = useState<CallItem[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setItems([]);
    if (token) apiGet<{ items: CallItem[] }>('/api/calls/history', token, { skipCache: true })
      .then(data => { if (active) setItems(data.items); })
      .catch(() => { if (active) setError('Could not load call history. Try again.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, revision]);

  return (
    <div className="space-y-5 pb-24">
      <PageHeader sticky bleed title="Call history" back="/settings/chat" />
      <p className="text-sm opacity-70">Your 50 most recent recorded incoming and outgoing calls.</p>
      <SettingsGroup right={<button type="button" aria-label="Refresh call history" onClick={() => setRevision(value => value + 1)} disabled={loading} className="p-2 text-[var(--vanta-gold)]"><RefreshCw size={18} /></button>} title="Recent calls">
        {loading ? <p role="status" className="p-4 text-sm">Loading calls…</p> : error ? <p role="alert" className="p-4 text-sm text-red-400">{error}</p> : items.length === 0 ? <p className="p-4 text-sm opacity-70">No recorded calls yet.</p> : items.map(item => {
          const Icon = item.type === 'VIDEO' ? Video : Phone;
          return <div key={item.id} className="flex items-center gap-3 px-4 py-3">
            <Icon size={21} className="shrink-0 text-[var(--vanta-gold)]" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">@{item.username}</p>
              <p className="text-xs opacity-70">{item.direction === 'incoming' ? 'Incoming' : 'Outgoing'} · {item.type === 'VIDEO' ? 'Video' : 'Audio'} · {labels[item.status] || item.status}</p>
              <p className="text-xs opacity-65">{new Date(item.createdAt).toLocaleString()}</p>
            </div>
            {item.durationSeconds !== null && <span className="text-xs tabular-nums opacity-75">{Math.floor(item.durationSeconds / 60)}:{String(item.durationSeconds % 60).padStart(2,'0')}</span>}
          </div>;
        })}
      </SettingsGroup>
    </div>
  );
}
