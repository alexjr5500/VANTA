'use client';

import { Accessibility, Contrast, Type } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { SelectRow, SettingsGroup, ToggleRow } from '@/components/settings/SettingsUI';
import { useAccessibility, type FontSize } from '@/context/AccessibilityContext';

const fontOptions = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Default' },
  { value: 'large', label: 'Large' },
  { value: 'extra-large', label: 'Extra large' },
];

export default function AccessibilitySettingsPage() {
  const { highContrast, toggleHighContrast, reducedMotion, toggleReducedMotion, fontSize, setFontSize } = useAccessibility();
  return (
    <div className="space-y-4 pb-24">
      <PageHeader sticky bleed title="Accessibility" back="/settings" />
      <SettingsGroup>
        <ToggleRow icon={Contrast} title="High contrast" description="Increase the contrast of the interface." checked={highContrast} onChange={toggleHighContrast} />
        <ToggleRow icon={Accessibility} title="Reduce motion" description="Reduce interface animations." checked={reducedMotion} onChange={toggleReducedMotion} />
        <SelectRow icon={Type} title="Font size" value={fontSize} options={fontOptions}
          onSelect={(value) => { if (fontOptions.some((option) => option.value === value)) setFontSize(value as FontSize); }} />
      </SettingsGroup>
    </div>
  );
}
