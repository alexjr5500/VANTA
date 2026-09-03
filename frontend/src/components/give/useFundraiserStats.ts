'use client';

import { useMemo } from 'react';

interface FundraiserLike {
  targetAmount: number;
  raisedAmount: number;
  supporterCount: number;
  currency?: string | null;
  deadline?: string | null;
}

export function formatCurrencyValue(amount: number, currency = 'USD'): string {
  const abs = Math.abs(amount || 0);
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(abs);
  } catch {
    return `${abs.toLocaleString()} ${currency}`;
  }
}

export function formatCompactNumber(value: number): string {
  const n = value || 0;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function daysLeftFrom(deadline?: string | null): number {
  if (!deadline) return 0;
  const diff = new Date(deadline).getTime() - Date.now();
  return Math.ceil(diff / 86_400_000);
}

export function useFundraiserStats(fundraiser: FundraiserLike) {
  return useMemo(() => {
    const target = Number(fundraiser.targetAmount) || 0;
    const raised = Number(fundraiser.raisedAmount) || 0;
    const currency = fundraiser.currency || 'USD';
    const percentFunded = target > 0 ? Math.min(100, (raised / target) * 100) : 0;
    const daysLeft = daysLeftFrom(fundraiser.deadline);
    const deadlinePassed = Boolean(fundraiser.deadline && new Date(fundraiser.deadline).getTime() <= Date.now());
    const showDays = daysLeft > 0 && !deadlinePassed;
    return {
      percentFunded,
      raisedLabel: formatCurrencyValue(raised, currency),
      targetLabel: formatCurrencyValue(target, currency),
      daysLeft,
      deadlinePassed,
      deadlineText: deadlinePassed
        ? new Date(fundraiser.deadline as string).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        : `${daysLeft} days left`,
      showDays,
      supportersLabel: formatCompactNumber(fundraiser.supporterCount || 0),
    };
  }, [fundraiser]);
}