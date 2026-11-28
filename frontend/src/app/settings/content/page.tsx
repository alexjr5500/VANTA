'use client';

/* ═══════════════════════════════════════════════════════════════
   Content & Media Settings
   Autoplay and data-usage preferences are device-local (per-device
   behavior) and are actually consumed by the app's video surfaces
   through useContentPrefs. Settings that VANTA does not implement
   (offline downloads) are intentionally not offered.
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPut } from '@/lib/apiClient';
import { Play, Wifi, Video, SlidersHorizontal } from 'lucide-react';
import { DefaultSectionSetting } from '@/components/settings/DefaultSectionSetting';
import PageHeader from '@/components/ui/PageHeader';
import {
  SavedChip,
  SelectRow,
  SettingsGroup,
  SettingsLink,
  ToggleRow,
  useLocalPrefs,
} from '@/components/settings/SettingsUI';

const LOCAL_DEFAULTS = {
  autoplay: true,
  homeAutoplay: false,
  lowerData: false,
  quality: 'auto' as string,
};

type LocalKey = keyof typeof LOCAL_DEFAULTS;

export default function ContentMediaSettingsPage() {
  const { prefs, set, savedVisible } = useLocalPrefs(
    'vanta_content_extras',
    LOCAL_DEFAULTS
  );

  const toggle = (key: LocalKey, value: boolean) => set(key, value);
  const {token}=useAuth();
  const [hide,setHide]=useState<boolean|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const lock=useRef(false);
  useEffect(()=>{let active=true;setHide(null);setError('');if(token)apiGet<{hideSensitiveContent:boolean}>('/api/settings/privacy',token,{skipCache:true}).then(data=>{if(active)setHide(data.hideSensitiveContent!==false);}).catch(()=>{if(active)setError('Could not load preference');});return()=>{active=false;};},[token]);
  const saveSensitive=async(value:boolean)=>{if(!token||lock.current)return;lock.current=true;setBusy(true);setError('');try{await apiPut('/api/settings/privacy',{hideSensitiveContent:value},token);setHide(value);}catch{setError('Could not save preference');}finally{lock.current=false;setBusy(false);}};

  return (
    <div className="space-y-8 pb-24">
      <PageHeader
        sticky
        bleed
        title="Timeline"
        back="/settings"
      />

      <div className="-mt-2">
        <p className="text-sm leading-relaxed text-white/45">
          Control how content plays and uses your data on this device.
        </p>
      </div>

      <DefaultSectionSetting area="timeline" />
      <SettingsGroup title="External links"><SettingsLink href="/settings/content/external-links" title="Open links" description="Choose how external websites open on this device" /></SettingsGroup>
      <SettingsGroup
        icon={Play}
        title="Playback"
        description="How videos behave as you scroll"
        right={savedVisible ? <SavedChip /> : undefined}
      >
        <ToggleRow
          icon={Play}
          title="Video Autoplay"
          description="Automatically play videos while browsing your feed."
          checked={prefs.homeAutoplay}
          onChange={(v) => toggle('homeAutoplay', v)}
        />
        <ToggleRow
          icon={Video}
          title="Reels autoplay"
          description="Play Reels automatically as you watch."
          checked={prefs.autoplay}
          onChange={(v) => toggle('autoplay', v)}
        />
        <SelectRow
          icon={Video}
          title="Media quality"
          description="Preferred video sharpness"
          value={prefs.quality}
          onSelect={(v) => set('quality', v)}
          options={[
            { value: 'auto', label: 'Auto', description: 'Let VANTA pick the best quality.' },
            { value: 'hd', label: 'High definition (1080p)', description: 'Use more data for sharper video.' },
            { value: 'sd', label: 'Standard (480p)', description: 'Saves data with lighter video.' },
          ]}
        />
      </SettingsGroup>

      <SettingsGroup
        icon={Wifi}
        title="Data Usage"
        description="Keep your data plan in check"
        right={savedVisible ? <SavedChip /> : undefined}
      >
        <ToggleRow
          icon={Wifi}
          title="Lower data usage"
          description="Play lighter versions of media on mobile data."
          checked={prefs.lowerData}
          onChange={(v) => toggle('lowerData', v)}
        />
      </SettingsGroup>

      <SettingsGroup title="Sensitive content in feeds">
        <ToggleRow title="Hide labeled sensitive posts and reels" description="Filter moderator-labeled material from supported Timeline, Trending, Explore and Reels feeds. Accounts under 18 or without a birth date always use the restrictive filter. This is not a complete content safety filter." checked={hide!==false} disabled={hide===null||busy} onChange={value=>void saveSensitive(value)} />
        {error&&<p role="alert" className="px-4 py-2 text-sm text-red-400">{error}</p>}
      </SettingsGroup>
      <SettingsGroup icon={SlidersHorizontal} title="Storage">
        <SettingsLink
          href="/settings/device"
          icon={SlidersHorizontal}
          title="Device & storage"
          description="Clear cache and manage stored data"
        />
      </SettingsGroup>
    </div>
  );
}