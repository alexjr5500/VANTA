'use client';

import { useEffect, useRef, useState } from 'react';
import { AtSign, Phone, Search, Eye, Users } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { SelectRow, SettingsGroup, ToggleRow } from '@/components/settings/SettingsUI';
import { useAuth } from '@/context/AuthContext';
import { privacyApi } from '@/lib/complianceApi';

type Mode = 'everyone' | 'followers' | 'nobody';
type Prefs = { storyVisibility: Mode; groupInvites: Mode; communityInvites: Mode; onlineStatus: Mode; lastSeen: Mode; readReceipts: Mode; mentionPermissions: Mode; callPermissions: Mode; privacyCalls: string; profileSearchVisibility: boolean; searchVisibility: boolean; discoverability: boolean };
const options = [{ value: 'everyone', label: 'Everyone' }, { value: 'followers', label: 'Your followers' }, { value: 'nobody', label: 'Nobody' }];

export default function AudiencePage() {
  const { token } = useAuth();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    setPrefs(null);
    setError('');
    if (token) privacyApi.getSettings().then((result) => {
      if (active) setPrefs(result);
    }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Could not load privacy controls.'); });
    return () => { active = false; };
  }, [token]);

  const save = async (patch: Partial<Prefs>) => {
    if (!token || !prefs || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try { setPrefs(await privacyApi.updateSettings(patch)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save changes.'); }
    finally { lock.current = false; setBusy(false); }
  };
  const callMode = prefs && ([prefs.callPermissions, prefs.privacyCalls].some((mode) => ['nobody', 'noone'].includes(mode)) ? 'nobody' : [prefs.callPermissions, prefs.privacyCalls].some((mode) => ['followers', 'following'].includes(mode)) ? 'followers' : 'everyone');

  return (
    <div className="space-y-5 pb-24">
      <PageHeader sticky bleed title="Audience and discoverability" back="/settings/privacy" />
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {!prefs && !error && <p role="status" className="py-5 text-sm opacity-70">Loading privacy controls…</p>}
      {prefs && <>
        <SettingsGroup title="Audience and mentions">
          <SelectRow icon={AtSign} title="Who can mention you" value={prefs.mentionPermissions} options={options} disabled={busy} onSelect={(value) => void save({ mentionPermissions: value as Mode })} />
          <SelectRow icon={Phone} title="Who can call you" value={callMode || 'everyone'} options={options} disabled={busy} onSelect={(value) => void save({ callPermissions: value as Mode })} />
        </SettingsGroup>
        <SettingsGroup title="Visibility and invitations">
          <SelectRow icon={Eye} title="Who can view your stories" value={prefs.storyVisibility} options={options} disabled={busy} onSelect={value => void save({storyVisibility: value as Mode})} />
          <SelectRow icon={Users} title="Who can invite you to groups" value={prefs.groupInvites} options={options} disabled={busy} onSelect={value => void save({groupInvites: value as Mode})} />
          <SelectRow icon={Users} title="Who can invite you to channels and communities" value={prefs.communityInvites} options={options} disabled={busy} onSelect={value => void save({communityInvites: value as Mode})} />
        </SettingsGroup>
        <SettingsGroup title="Presence and receipts">
          <SelectRow icon={Eye} title="Who can see your online status" value={prefs.onlineStatus} options={options} disabled={busy} onSelect={value => void save({onlineStatus: value as Mode})} />
          <SelectRow icon={Eye} title="Who can see your last active time" value={prefs.lastSeen} options={options} disabled={busy} onSelect={value => void save({lastSeen: value as Mode})} />
          <SelectRow icon={Eye} title="Who can see your read receipts" value={prefs.readReceipts} options={options} disabled={busy} onSelect={value => void save({readReceipts: value as Mode})} />
        </SettingsGroup>
        <SettingsGroup title="Discoverability">
          <ToggleRow icon={Search} title="Appear in VANTA user search" description="Allow your profile to appear in VANTA search results. This does not control external search engines."
            checked={prefs.profileSearchVisibility && prefs.searchVisibility && prefs.discoverability} disabled={busy}
            onChange={(value) => void save({ profileSearchVisibility: value, searchVisibility: value, discoverability: value })} />
        </SettingsGroup>
      </>}
    </div>
  );
}
