'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { HeartHandshake, Plus, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { listMyFundraisers } from '@/lib/fundraiserApi';
import { canCreateFundraiser } from '@/lib/canCreateFundraiser';
import ActiveFundraiserCard from './ActiveFundraiserCard';
import type { Fundraiser } from '@/types/fundraiser';

/**
 * Profile integration for VANTA Give — shows a compact live campaign card on
 * the user's own profile without redesigning the profile page. Renders nothing
 * when the user has no active fundraiser or the request fails.
 */
export default function ActiveFundraiserSection({ own }: { own: boolean }) {
  const { token, user } = useAuth();
  const fundraiserAllowed = canCreateFundraiser(user);
  const [active, setActive] = useState<Fundraiser | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!own || !token) {
      setChecked(true);
      return;
    }
    let mounted = true;
    listMyFundraisers(token)
      .then((list) => {
        if (!mounted) return;
        const live = list.find(
          (item) => item.status === 'PUBLISHED' || item.status === 'APPROVED'
        );
        setActive(live || null);
      })
      .catch(() => setActive(null))
      .finally(() => mounted && setChecked(true));
    return () => {
      mounted = false;
    };
  }, [own, token]);

  if (!checked || !own) return null;

  if (!active) {
    return (
      <div className="px-4 pb-1 sm:px-6">
        {fundraiserAllowed ? (
          <Link
            href="/give/start"
            className="flex min-h-[52px] items-center gap-3 rounded-2xl border border-dashed border-white/[0.12] bg-white/[0.01] px-4 text-left text-sm text-white/45 transition hover:border-[var(--gold-border)] hover:text-white/75"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/[0.1]">
              <HeartHandshake size={15} />
            </span>
            <span className="flex-1">
              Start a fundraiser
              <span className="block text-[11px] text-white/30">Raise money for a cause that matters</span>
            </span>
            <Plus size={16} className="text-white/30" />
          </Link>
        ) : (
          <div className="flex min-h-[52px] items-center gap-3 rounded-2xl border border-dashed border-white/[0.12] bg-white/[0.01] px-4 text-left text-sm text-white/45 opacity-70">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/[0.1]">
              <ShieldCheck size={15} className="text-[#d6a83f]" />
            </span>
            <span className="flex-1">
              Verification required to create a fundraiser
              <span className="block text-[11px] text-white/30">Verify your account to raise money for a cause</span>
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 sm:px-6">
      <ActiveFundraiserCard fundraiser={active as any} />
    </div>
  );
}