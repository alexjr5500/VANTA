'use client';

import { Search, ShieldCheck } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { SettingsGroup, SettingsLink } from '@/components/settings/SettingsUI';

export default function CategoryPage() {
  return (
    <div className="space-y-4 pb-24">
      <PageHeader sticky bleed title="Explore" back="/settings" />
      <SettingsGroup>
        <SettingsLink href="/settings/content" icon={ShieldCheck} title="Content preferences" description="Manage sensitive content and media preferences" />
        <SettingsLink href="/discover" icon={Search} title="Open Explore" description="Discover posts and creators" />
      </SettingsGroup>
    </div>
  );
}
