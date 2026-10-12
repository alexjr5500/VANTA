// VANTA Console — shared presentation formatters.
// Presentation-only helpers; every value passed in comes from real API data.

export const fmtNumber = (n: number | null | undefined): string =>
  Number(n || 0).toLocaleString('en-US');

export const fmtCompact = (n: number | null | undefined): string => {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return '0';
  if (Math.abs(v) < 1000) return String(v);
  return Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
};

export const fmtCurrency = (n: number | null | undefined): string =>
  '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtCompactCurrency = (n: number | null | undefined): string => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1_000_000) return '$' + (v / 1_000_000).toFixed(2) + 'M';
  if (Math.abs(v) >= 10_000) return '$' + (v / 1_000).toFixed(1) + 'K';
  return fmtCurrency(v);
};

export const fmtDate = (iso: string | number | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const fmtDateTime = (iso: string | number | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

export const timeAgo = (iso: string | number | null | undefined): string => {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(iso);
};

export const fmtDuration = (seconds: number | null | undefined): string => {
  const s = Number(seconds || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
};
