'use client';

/* ═══════════════════════════════════════════════════════════════
   What's New — redesigned
   Recent platform updates in the new Settings style.
   ═══════════════════════════════════════════════════════════════ */

import { Bell, Gift, Globe, Radio, Sparkles } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { SettingsGroup } from '@/components/settings/SettingsUI';

const UPDATES = [
  {
    icon: Gift,
    title: 'Gift Store',
    desc: 'Send animated gifts during live streams.',
    date: 'July 2026',
  },
  {
    icon: Radio,
    title: 'Live Streaming',
    desc: 'Go live with real-time chat and viewer engagement.',
    date: 'June 2026',
  },
  {
    icon: Globe,
    title: 'Global Reach',
    desc: 'Multi-language support and regional settings.',
    date: 'June 2026',
  },
  {
    icon: Bell,
    title: 'Smart Notifications',
    desc: 'Enhanced notification preferences and filters.',
    date: 'May 2026',
  },
];

export default function WhatsNewPage() {
  return (
    <div className="space-y-8 pb-10">
      <PageHeader title="What's New" back="/settings" />

      <div className="-mt-2">
        <p className="text-sm leading-relaxed text-white/45">
          The latest features and improvements on VANTA.
        </p>
      </div>

      <SettingsGroup icon={Sparkles} title="Recent Updates">
        <div className="divide-y divide-white/[0.06]">
          {UPDATES.map((u, i) => {
            const Icon = u.icon;
            return (
              <div
                key={i}
                className="flex items-start gap-3.5 px-4 py-4"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-[rgba(59,130,246,0.25)] bg-[rgba(59,130,246,0.08)] text-[#7cabff]">
                  <Icon size={17} strokeWidth={1.9} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-white">{u.title}</p>
                    <span className="shrink-0 text-[10px] text-white/25">
                      {u.date}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-white/40">
                    {u.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </SettingsGroup>
    </div>
  );
}