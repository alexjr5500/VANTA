'use client';

import { useState } from 'react';
import { Mic, Video, Wifi } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { SettingsGroup, SettingsLink } from '@/components/settings/SettingsUI';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/apiClient';

type TestKind = 'connection' | 'microphone' | 'camera';

export default function TroubleshootingPage() {
  const { token } = useAuth();
  const [busy, setBusy] = useState<TestKind | null>(null);
  const [results, setResults] = useState<Partial<Record<TestKind, string>>>({});
  const test = async (kind: TestKind) => {
    if (busy) return;
    setBusy(kind);
    let result: string;
    let stream: MediaStream | undefined;
    try {
      if (kind === 'connection') {
        if (!token) throw new Error('Sign in to test the connection.');
        await apiGet('/api/messages/unread/count', token, { skipCache: true });
        result = 'Chat server responded successfully.';
      } else {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Media access is unavailable on this device or browser.');
        stream = await navigator.mediaDevices.getUserMedia(kind === 'microphone' ? { audio: true } : { video: true });
        result = kind === 'microphone' ? 'Microphone access succeeded.' : 'Camera access succeeded.';
      }
    } catch (error) {
      result = error instanceof Error ? error.message : 'Test failed. Check device permissions and try again.';
    } finally {
      stream?.getTracks().forEach(track => track.stop());
      setBusy(null);
    }
    setResults(prev => ({ ...prev, [kind]: result }));
  };
  const checks = [{ kind: 'connection', title: 'Chat connection', Icon: Wifi }, { kind: 'microphone', title: 'Microphone access', Icon: Mic }, { kind: 'camera', title: 'Camera access', Icon: Video }] as const;

  return <div className="space-y-5 pb-24">
    <PageHeader sticky bleed title="Chat troubleshooting" back="/settings/chat" />
    <p className="text-sm opacity-75">Run individual checks. Camera and microphone tests request device access, then stop immediately; they do not record or upload media.</p>
    <SettingsGroup title="Diagnostics">
      {checks.map(({ kind, title, Icon }) => <div key={kind} className="flex items-center gap-3 px-4 py-3">
        <Icon size={21} className="shrink-0 text-[var(--vanta-gold)]" aria-hidden="true" />
        <div className="min-w-0 flex-1"><p className="text-sm font-medium">{title}</p>{results[kind] && <p role="status" className="mt-1 text-xs opacity-75">{results[kind]}</p>}</div>
        <button type="button" disabled={busy !== null} onClick={() => void test(kind)} className="min-h-11 px-2 text-sm text-[var(--vanta-gold)] disabled:opacity-50">{busy === kind ? 'Testing…' : 'Test'}</button>
      </div>)}
    </SettingsGroup>
    <SettingsGroup title="More help">
      <SettingsLink href="/settings/notifications" title="Notification settings" />
      <SettingsLink href="/settings/help" title="Help Center" />
    </SettingsGroup>
  </div>;
}
