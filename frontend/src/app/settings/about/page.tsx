'use client';

/* ═══════════════════════════════════════════════════════════════
   About — new focused page
   Help, legal, guidelines and app info in one calm list.
   ═══════════════════════════════════════════════════════════════ */

import {
  FileText,
  HelpCircle,
  Info,
  Mail,
  Scale,
  Shield,
  Sparkles,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { SettingsGroup, SettingsLink } from '@/components/settings/SettingsUI';

const APP_VERSION = '0.1.0';

export default function AboutPage() {
  return (
    <div className="space-y-8 pb-10">
      <PageHeader title="About" back="/settings" />

      <div className="-mt-2">
        <p className="text-sm leading-relaxed text-white/45">
          VANTA is a premium social and creator platform for posts,
          reels, live rooms and meaningful connection.
        </p>
      </div>

      <SettingsGroup icon={HelpCircle} title="Support">
        <SettingsLink
          href="/settings/help"
          icon={HelpCircle}
          title="Help Center"
          description="Common questions and how-to guides"
        />
        <SettingsLink
          href="/contact"
          icon={Mail}
          title="Contact us"
          description="Reach our support team"
        />
      </SettingsGroup>

      <SettingsGroup icon={Scale} title="Legal">
        <SettingsLink
          href="/terms"
          icon={FileText}
          title="Terms of Service"
          description="The rules that keep VANTA safe"
        />
        <SettingsLink
          href="/privacy"
          icon={Shield}
          title="Privacy Policy"
          description="How we handle your data"
        />
        <SettingsLink
          href="/privacy-center"
          icon={Scale}
          title="Community Guidelines"
          description="What's allowed on VANTA"
        />
      </SettingsGroup>

      <SettingsGroup icon={Info} title="VANTA">
        <SettingsLink
          href="/settings/whats-new"
          icon={Sparkles}
          title="What's New"
          description="Recent features and updates"
        />
        <div className="flex min-h-[62px] items-center gap-3.5 px-4 py-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-white/[0.06] bg-white/[0.03] text-white/40">
            <Info size={17} strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-white">App version</p>
            <p className="mt-0.5 text-xs text-white/30">
              @vanta/app
            </p>
          </div>
          <span className="shrink-0 text-xs text-white/30">{APP_VERSION}</span>
        </div>
      </SettingsGroup>
    </div>
  );
}