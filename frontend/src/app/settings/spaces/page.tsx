'use client';

import { useEffect, useRef, useState } from 'react';
import { Bell, Mic, Users } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { SettingsGroup, SettingsLink, SelectRow } from '@/components/settings/SettingsUI';
import { DefaultSectionSetting } from '@/components/settings/DefaultSectionSetting';
import { useAuth } from '@/context/AuthContext';
import { privacyApi } from '@/lib/complianceApi';

type Mode = 'everyone' | 'followers' | 'nobody';
type Privacy = { liveStreamVisibility: string; privacyLiveStream: string };
const modes = [{value:'everyone',label:'Everyone'}, {value:'followers',label:'Your followers'}, {value:'nobody',label:'Nobody'}];

export default function SpacesSettingsPage() {
  const { token } = useAuth();
  const [settings, setSettings] = useState<Privacy | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    setSettings(null); setError('');
    if (token) privacyApi.getSettings().then(data => { if (active) setSettings(data); }).catch(() => { if (active) setError('Could not load live privacy settings.'); });
    return () => { active = false; };
  }, [token]);
  const save = async (mode: string) => {
    if (!token || !settings || lock.current || !modes.some(item => item.value === mode)) return;
    lock.current = true; setBusy(true); setError('');
    try { setSettings(await privacyApi.updateSettings({liveStreamVisibility: mode as Mode})); }
    catch { setError('Could not save live visibility. Try again.'); }
    finally { lock.current = false; setBusy(false); }
  };
  const current = settings && ([settings.liveStreamVisibility,settings.privacyLiveStream].some(value => ['nobody','noone','none'].includes(value)) ? 'nobody' : [settings.liveStreamVisibility,settings.privacyLiveStream].some(value => ['followers','following'].includes(value)) ? 'followers' : 'everyone');

  return <div className="space-y-5 pb-24">
    <PageHeader sticky bleed title="Spaces" back="/settings" />
    <DefaultSectionSetting area="live" />
    <SettingsGroup title="Live audience">
      {settings ? <SelectRow icon={Users} title="Who can view your live broadcasts in discovery" value={current || 'everyone'} options={modes} disabled={busy} onSelect={value => void save(value)} /> : <p className="p-4 text-sm opacity-70">{error || 'Loading audience settings…'}</p>}
      {error && settings && <p role="alert" className="p-4 text-sm text-red-400">{error}</p>}
    </SettingsGroup>
    <SettingsGroup title="Notifications and broadcasts">
      <SettingsLink href="/settings/notifications" icon={Bell} title="Live notifications" description="Manage alerts for live broadcasts and interactions" />
      <SettingsLink href="/live" icon={Mic} title="Open live rooms" description="Browse live broadcasts" />
    </SettingsGroup>
  </div>;
}
