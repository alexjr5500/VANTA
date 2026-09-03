'use client';

/* ═══════════════════════════════════════════════════════════════
   Payments Settings — redesigned
   Payment methods overview in the new Settings style.
   ═══════════════════════════════════════════════════════════════ */

import { CreditCard, WalletCards } from 'lucide-react';
import Link from 'next/link';
import PageHeader from '@/components/ui/PageHeader';
import { SettingsGroup } from '@/components/settings/SettingsUI';

export default function PaymentsSettingsPage() {
  return (
    <div className="space-y-8 pb-10">
      <PageHeader title="Payments" back="/settings" />

      <div className="-mt-2">
        <p className="text-sm leading-relaxed text-white/45">
          Manage coins, subscriptions and your balance.
        </p>
      </div>

      <SettingsGroup icon={CreditCard} title="Payment Methods">
        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-white/30">
            <CreditCard size={20} strokeWidth={1.8} />
          </span>
          <p className="mt-1 text-sm font-medium text-white/70">
            No payment methods yet
          </p>
          <p className="text-xs leading-relaxed text-white/30">
            Add a payment method to purchase coins and subscriptions.
          </p>
          <Link
            href="/balance"
            className="btn-accent mt-3"
          >
            <WalletCards size={15} aria-hidden="true" />
            Go to Balance
          </Link>
        </div>
      </SettingsGroup>
    </div>
  );
}