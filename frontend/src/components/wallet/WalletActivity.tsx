'use client';

import VantaCoinIcon from '@/components/ui/VantaCoinIcon';
import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/apiClient';

type Day = {date: string; incoming: number; outgoing: number; purchases: number; giftsSent: number; giftsReceived: number; transferFees: number; net: number};
type Report = {currency: string; days: number; buckets: Day[]; excluded: number};
export default function WalletActivity({token, hidden}: {token: string; hidden: boolean}) {
  const [days, setDays] = useState<7|30|90>(7);
  const [report, setReport] = useState<Report|null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    setReport(null); setLoading(true); setError(false);
    apiGet<Report>('/api/wallets/activity?days=' + days, token, {skipCache:true}).then(result => {
      if (!current) return;
      if (result.currency !== 'VANTA' || result.days !== days || !Array.isArray(result.buckets) || result.buckets.length !== days) throw new Error('Invalid report');
      setReport(result);
    }).catch(() => { if (current) setError(true); }).finally(() => { if (current) setLoading(false); });
    return () => {current = false;};
  }, [token, days, retry]);
  const sums = report?.buckets.reduce((a,b) => ({incoming:a.incoming+b.incoming,outgoing:a.outgoing+b.outgoing,purchases:a.purchases+b.purchases,giftsSent:a.giftsSent+b.giftsSent,giftsReceived:a.giftsReceived+b.giftsReceived,transferFees:a.transferFees+b.transferFees,net:a.net+b.net}), {incoming:0,outgoing:0,purchases:0,giftsSent:0,giftsReceived:0,transferFees:0,net:0});
  const max = Math.max(1, ...(report?.buckets.flatMap(b => [b.incoming,b.outgoing]) ?? []));
  return (
    <section className="space-y-4 border-b border-[var(--border)] px-1 pb-5" aria-label="Wallet activity">
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <h2 className="text-base font-semibold">Coin activity</h2>
        <div className="flex gap-1" aria-label="Activity period">
          {([7, 30, 90] as const).map(n => (
            <button key={n} type="button" aria-pressed={days === n} onClick={() => setDays(n)}
              className={'min-h-11 border-b-2 px-2 text-xs font-medium ' + (days === n ? 'border-[var(--vanta-gold)] text-[var(--vanta-gold-bright)]' : 'border-transparent text-[var(--text-secondary)]')}>
              {n}d
              <span className="sr-only"> days</span>
            </button>
          ))}
        </div>
      </div>
      {hidden ? <p className="text-sm text-[var(--text-secondary)]">Activity hidden</p>
        : loading ? <p role="status" className="text-sm">Loading activity…</p>
        : error || !report || !sums ? <p role="alert" className="text-sm">Activity unavailable. <button type="button" onClick={() => setRetry(v => v + 1)} className="min-h-11 text-[var(--vanta-gold-bright)]">Retry</button></p>
        : <>
          <dl className="grid grid-cols-2 gap-4">
            {Object.entries({ Received: sums.incoming, Spent: sums.outgoing }).map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-xs text-[var(--text-secondary)]">{label}</dt>
                <dd className="mt-1 flex flex-wrap items-center gap-1.5 text-xl font-semibold tabular-nums"><span className="min-w-0 break-all">{value.toLocaleString()}</span><VantaCoinIcon size={18}/></dd>
              </div>
            ))}
          </dl>
          {sums.incoming === 0 && sums.outgoing === 0 ? (
            <p className="py-3 text-sm text-[var(--text-secondary)]">No completed coin activity in this period.</p>
          ) : <>
            <svg viewBox="0 0 320 96" className="w-full" role="img" aria-label="Daily completed coin inflows and outflows; period totals are listed above">
              {[24,48,72,96].map(y => <line key={y} x1="0" x2="320" y1={y} y2={y} stroke="currentColor" opacity=".12"/>)}
              {report.buckets.map((b,i) => {const width = 320/days; return <g key={b.date}><rect x={i*width} y={96-b.incoming/max*90} width={width*.44} height={b.incoming/max*90} fill="var(--vanta-gold, #dfbd55)"/><rect x={i*width+width*.48} y={96-b.outgoing/max*90} width={width*.44} height={b.outgoing/max*90} fill="#9ca3af"/></g>})}
            </svg>
            <div className="flex justify-between text-xs text-[var(--text-secondary)]"><span>{report.buckets[0].date}</span><span>{report.buckets[days-1].date}</span></div>
            <p className="text-xs text-[var(--text-secondary)]">Gold: incoming · Grey: outgoing · UTC</p>
          </>}
          <details className="text-sm">
            <summary className="min-h-11 cursor-pointer py-3 text-[var(--text-secondary)]">Activity breakdown</summary>
            <dl className="space-y-3 pb-3">
              {Object.entries({ Purchased: sums.purchases, 'Gift coins sent': sums.giftsSent, 'Gift coins received': sums.giftsReceived, 'Transfer fees': sums.transferFees, 'Net movement': sums.net }).map(([label,value]) => (
                <div key={label} className="flex justify-between gap-3"><dt className="text-[var(--text-secondary)]">{label}</dt><dd className="min-w-0 break-all text-right font-medium tabular-nums">{value.toLocaleString()} <VantaCoinIcon size={14}/></dd></div>
              ))}
            </dl>
            <p className="text-xs leading-relaxed text-[var(--text-secondary)]">Completed VANTA coin ledger movement (UTC), excluding reserve, release and refund adjustments. Fees are included in outgoing transfers.{report.excluded>0?' Unclassified records omitted: '+report.excluded+'.':''}</p>
          </details>
        </>}
    </section>
  );
}
