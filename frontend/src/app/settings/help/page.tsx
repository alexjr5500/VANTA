'use client';

/* ═══════════════════════════════════════════════════════════════
   Help Center — redesigned
   FAQ accordion and contact support in the new Settings style.
   ═══════════════════════════════════════════════════════════════ */

import { useState } from 'react';
import { ChevronDown, HelpCircle, Mail } from 'lucide-react';
import Link from 'next/link';
import PageHeader from '@/components/ui/PageHeader';
import { SettingsGroup } from '@/components/settings/SettingsUI';
import { cn } from '@/lib/utils';

const FAQS = [
  {
    q: 'How do I create a post?',
    a: 'Navigate to your profile and use the create post form to share content with your followers.',
  },
  {
    q: 'How do I start streaming?',
    a: 'Go to the Live page and click "Go Live" to start broadcasting to your audience.',
  },
  {
    q: 'How do I earn coins?',
    a: 'You can earn coins through gifts, subscriptions, and completing achievements on the platform.',
  },
  {
    q: 'How do I report an issue?',
    a: 'Use the contact form below or email our support team for assistance.',
  },
];

export default function HelpCenterPage() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="space-y-8 pb-10">
      <PageHeader title="Help Center" back="/settings" />

      <div className="-mt-2">
        <p className="text-sm leading-relaxed text-white/45">
          Answers to common questions. Need more help? We&apos;re here.
        </p>
      </div>

      <SettingsGroup icon={HelpCircle} title="Frequently Asked">
        <div className="divide-y divide-white/[0.06]">
          {FAQS.map((faq, i) => {
            const open = openIndex === i;
            return (
              <div key={i}>
                <button
                  type="button"
                  onClick={() => setOpenIndex(open ? null : i)}
                  aria-expanded={open}
                  className="flex min-h-[62px] w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
                >
                  <span className="text-sm font-medium text-white">{faq.q}</span>
                  <ChevronDown
                    size={15}
                    className={cn(
                      'shrink-0 text-white/25 transition-transform duration-200',
                      open && 'rotate-180'
                    )}
                    aria-hidden="true"
                  />
                </button>
                {open && (
                  <div className="px-4 pb-4">
                    <p className="text-sm leading-relaxed text-white/50">
                      {faq.a}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SettingsGroup>

      <SettingsGroup icon={Mail} title="Still stuck?">
        <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-white/30">
            <Mail size={20} strokeWidth={1.8} />
          </span>
          <p className="mt-1 text-sm font-medium text-white/70">
            Contact support
          </p>
          <p className="text-xs text-white/30">
            Our team replies within a day.
          </p>
          <Link href="/contact" className="btn-accent mt-3">
            Contact Support
          </Link>
        </div>
      </SettingsGroup>
    </div>
  );
}