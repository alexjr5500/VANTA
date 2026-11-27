'use client';

import { Bell, Mic } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { SettingsGroup, SettingsLink } from '@/components/settings/SettingsUI';

export default function CategoryPage() {
  return (
    <div className="space-y-4 pb-24">
      <PageHeader sticky bleed title="Spaces" back="/settings" />
      <SettingsGroup>
        <SettingsLink href="/settings/notifications" icon={Bell} title="Live notifications" description="Manage live notification preferences" />
        <SettingsLink href="/live" icon={Mic} title="Open live rooms" description="Browse live broadcasts" />
      </SettingsGroup>
    </div>
  );
}
