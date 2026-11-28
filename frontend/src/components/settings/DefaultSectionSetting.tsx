'use client';
import { useEffect, useState } from 'react';
import { SelectRow, SettingsGroup } from '@/components/settings/SettingsUI';
import { SECTION_OPTIONS, readDefaultSection, writeDefaultSection, type SectionArea } from '@/lib/defaultSection';

export function DefaultSectionSetting({area}: {area: SectionArea}) {
  const [value,setValue] = useState<string>('forYou');
  const [ready,setReady] = useState(false);
  const [error,setError] = useState('');
  useEffect(() => { setValue(readDefaultSection(area)); setReady(true); }, [area]);
  return <SettingsGroup title="Default view" description="Choose the section that opens first on this device.">
    <SelectRow title="Start on" value={value} options={SECTION_OPTIONS[area].map(item => ({...item}))} disabled={!ready} onSelect={next => {
      try { writeDefaultSection(area,next); setValue(next); setError(''); }
      catch { setError('Could not save default view.'); }
    }} />
    {error && <p role="alert" className="px-4 py-2 text-sm text-red-400">{error}</p>}
  </SettingsGroup>;
}
