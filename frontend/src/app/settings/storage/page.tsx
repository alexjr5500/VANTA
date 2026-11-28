'use client';

import { Database, Wifi } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { SettingsGroup, SettingsLink } from '@/components/settings/SettingsUI';

export default function CategoryPage() {
  return (
    <div className="space-y-4 pb-24">
      <PageHeader sticky bleed title="Storage and Data" back="/settings" />
      <SettingsGroup>
        <SettingsLink href="/settings/device" icon={Database} title="Device storage" description="Clear cached app data" />
        <SettingsLink href="/settings/content" icon={Wifi} title="Data usage" description="Manage media quality and data usage" />
      </SettingsGroup>
    </div>
  );
}
