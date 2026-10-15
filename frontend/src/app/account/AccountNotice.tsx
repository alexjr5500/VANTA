// Shared presentational pieces for the restricted-account screens.
// Kept dependency-light so both /account/suspended and /account/banned reuse
// identical VANTA branding, appeal copy, and form fields.
import type { ReactNode } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import VantaLogo from '@/components/ui/VantaLogo';

export function AccountNoticeShell({
  eyebrow,
  icon,
  title,
  description,
  children,
}: {
  eyebrow: string;
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center px-5 pb-16 pt-10 sm:pt-14">
      <VantaLogo size={34} showText />
      <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/40">{eyebrow}</p>
      <section aria-labelledby="account-notice-title" className="mt-4 w-full rounded-3xl border border-amber-400/25 bg-[#151312] p-6 text-center shadow-[0_24px_80px_rgba(0,0,0,0.5)] sm:p-8">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-400/10 text-amber-300" aria-hidden>
          {icon}
        </span>
        <h1 id="account-notice-title" className="mt-4 text-2xl font-bold text-white">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-white/60">{description}</p>
        {children}
      </section>
    </main>
  );
}

export function NoticeRows({ rows }: { rows: Array<{ label: string; value: ReactNode } | null> }) {
  const visible = rows.filter(Boolean) as Array<{ label: string; value: ReactNode }>;
  if (visible.length === 0) return null;
  return (
    <dl className="mt-6 space-y-2 rounded-2xl bg-black/40 p-4 text-left text-sm">
      {visible.map((row) => (
        <div key={row.label} className="flex items-center justify-between gap-3">
          <dt className="shrink-0 text-white/45">{row.label}</dt>
          <dd className="text-right text-white/85">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function InlineStatus({ tone, children }: { tone: 'success' | 'danger' | 'info'; children: ReactNode }) {
  const classes =
    tone === 'success'
      ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
      : tone === 'danger'
        ? 'border-red-500/25 bg-red-500/10 text-red-200'
        : 'border-white/10 bg-black/40 text-white/70';
  return (
    <p role="status" className={`mt-3 rounded-2xl border p-3 text-sm ${classes}`}>
      {children}
    </p>
  );
}

export function AbuseNote() {
  return (
    <p className="mt-6 flex items-start gap-1.5 text-center text-xs leading-relaxed text-white/35">
      <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
      Abusing the appeal process may delay review. Nothing on this screen grants
      access to posting, messaging, or any other restricted feature.
    </p>
  );
}

export function CenteredSpinner({ label }: { label: string }) {
  return (
    <p className="mt-6 inline-flex items-center gap-2 text-sm text-white/50" role="status">
      <Loader2 size={15} className="animate-spin" aria-hidden /> {label}
    </p>
  );
}
