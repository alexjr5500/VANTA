'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, RefreshCcw, ShieldCheck, Wallet } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPost } from '@/lib/apiClient';

type Network = { network: string; asset: string; decimals: number; destination: string | null };
type Transfer = { automation?: boolean; lastFailure?: string | null; maxFeeAtomic?: string | null; id: string; network: string; source: string; destination: string; amountAtomic: string; status: string; authorizedAt: string; transactionHash: string | null; verifiedAt: string | null };
type Invoice = { id: string; orderId: string; network: string; address: string; amountAtomic: string; transactionHash: string; settledAt: string; treasuryTransfer: Transfer | null };
type Total = { network: string; amountAtomic: string; count: number; status: string };
type Snapshot = { networks: Network[]; totals: Total[]; invoices: Invoice[]; nextCursor: string | null; instructionsEnabled: boolean; automaticBroadcast: boolean; enabled?: boolean; policyId?: string | null };
function formatAtomic(value: string, decimals: number) {
  if (!/^[0-9]+$/.test(value) || !Number.isInteger(decimals) || decimals < 1 || decimals > 18) return 'Unavailable';
  const padded = value.padStart(decimals + 1, '0');
  return padded.slice(0, -decimals) + (padded.slice(-decimals).replace(/0+$/, '') ? '.' + padded.slice(-decimals).replace(/0+$/, '') : '');
}
const label = (s: string) => s.toLowerCase().replace(/_/g, ' ');
const panel = 'rounded-2xl border border-white/10 bg-white/[0.03] p-4';
const btn = 'rounded-lg border border-white/15 px-3 py-2 text-sm font-medium disabled:opacity-40';
export default function TreasuryPage() {
  const { token, user } = useAuth();
  const allowed = user?.role === 'CEO' || user?.role === 'SUPER_ADMIN';
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [code, setCode] = useState('');
  const [destination, setDestination] = useState('');
  const [hash, setHash] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (cursor?: string) => {
    if (!token || !allowed) return;
    setLoading(true); setError('');
    try {
      const snapshot = await apiGet<Snapshot>('/api/admin/treasury' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''), token, { skipCache: true });
      setData(snapshot);
    } catch (e) { setError(e instanceof Error ? e.message : 'Treasury data unavailable'); }
    finally { setLoading(false); }
  }, [token, allowed]);
  useEffect(() => { void load(); }, [load]);
  const choose = (i: Invoice) => { setSelected(i); setCode(''); setHash(''); setDestination(''); setNotice(''); setError(''); };
  const close = () => { setSelected(null); setCode(''); setHash(''); setDestination(''); };
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setNotice('Copied public payment information.'); }
    catch { setError('Clipboard unavailable. Select the text to copy manually.'); }
  };
  const submit = async (action: 'authorize' | 'broadcast' | 'verify') => {
    if (!token || !selected || busy) return;
    const transfer = selected.treasuryTransfer;
    if (action !== 'authorize' && !transfer) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const path = action === 'authorize' ? '/api/admin/treasury/authorize' : '/api/admin/treasury/' + encodeURIComponent(transfer!.id) + '/' + action;
      const payload = action === 'authorize' ? { invoiceId: selected.id, destination, code } : action === 'broadcast' ? { transactionHash: hash.trim(), code } : {};
      await apiPost<Transfer>(path, payload, token, undefined, { noRetry: true });
      setNotice(action === 'authorize' ? 'Transfer instruction authorized. No funds have moved.' : action === 'broadcast' ? 'Broadcast recorded. Awaiting independent verification.' : 'Outgoing transfer verified.');
      close(); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Treasury operation failed'); }
    finally { setCode(''); setBusy(false); }
  };
  if (!allowed) return <div className={panel}>Treasury is restricted to the CEO and super administrators.</div>;
  const net = data?.networks.find(n => n.network === selected?.network);
  return <div className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs uppercase tracking-wider text-gray-400">Finance · custody</p><h1 className="mt-1 text-2xl font-bold">Treasury Management</h1><p className="mt-1 text-sm text-gray-400">Verified shop receipts, transfer instructions and settlement records.</p></div>
      <button className={btn} onClick={() => void load()} disabled={loading}><RefreshCcw size={15} className="mr-2 inline"/>Refresh</button>
    </header>
    <div className={panel}><ShieldCheck size={20} className="mb-2 text-amber-300"/><p className="font-semibold">External custody required</p><p className="mt-1 text-sm text-gray-400">No private keys are stored or requested. Automatic transfers, when configured, are submitted to an external policy-controlled custody signer. Manual instructions must be signed by your approved custody wallet. Destination addresses are managed in protected server configuration.</p><p className="mt-2 text-xs">Automatic settlement: {data?.automaticBroadcast ? 'Enabled for configured stablecoin networks' : 'Disabled / custody setup required'}</p><p className="mt-2 text-xs">{data?.instructionsEnabled ? 'Manual instruction authorization enabled' : 'Manual instruction authorization disabled'}</p></div>
    {error && <p role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
    {notice && <p role="status" className="rounded-xl bg-white/5 p-3 text-sm">{notice}</p>}
    {loading && <p role="status" className="text-sm text-gray-400">Loading treasury data…</p>}
    {data && <>
      <h2 className="font-semibold">Treasury receiving wallets</h2>
      <div className="grid gap-3 sm:grid-cols-2">{data.networks.map(n => <div key={n.network} className={panel}><div className="flex items-center gap-2"><Wallet size={16}/><span className="font-semibold">{n.asset} · {n.network}</span></div><p className="mt-2 break-all text-sm text-gray-300">{n.destination || 'Not configured'}</p>{n.destination && <button className={'mt-2 '+btn} onClick={() => void copy(n.destination!)}><Copy size={14} className="mr-1 inline"/>Copy address</button>}<div className="mt-3 space-y-1 text-xs text-gray-400">{data.totals.filter(t => t.network === n.network).map(t => <p key={t.status}>{label(t.status)}: {formatAtomic(t.amountAtomic, n.decimals)} {n.asset} ({t.count} orders)</p>)}{!data.totals.some(t => t.network === n.network) && <p>No verified eligible receipts recorded.</p>}</div></div>)}</div>
      <p className="text-xs text-gray-400">Totals represent verified, completed shop invoice amounts grouped by status, not current wallet balances or net profit. Network fees and refunds are separate.</p>
      <h2 className="font-semibold">Settlement queue and history</h2>
      {!data.invoices.length && <p className={panel}>No settled invoice records.</p>}
      {data.invoices.map(i => { const n = data.networks.find(x => x.network === i.network); const t = i.treasuryTransfer; return <div key={i.id} className={panel}><div className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{n ? formatAtomic(i.amountAtomic,n.decimals) + ' ' + n.asset : i.amountAtomic + ' atomic units'}</span><span className="text-xs text-gray-400">{label(t?.status || 'AWAITING_AUTHORIZATION')}</span></div><p className="mt-2 break-all text-xs text-gray-400">Order {i.orderId}</p><p className="mt-1 break-all text-xs">Incoming transaction: {i.transactionHash}</p>{t?.transactionHash && <p className="mt-1 break-all text-xs">Outgoing transaction: {t.transactionHash}</p>}<button className={'mt-3 '+btn} onClick={() => choose(i)}>View settlement</button></div>; })}
      {data.nextCursor && <button className={btn} onClick={() => void load(data.nextCursor!)} disabled={loading}>Next page</button>}
    </>}
    {selected && <section className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label="Treasury settlement">
      <div className="max-h-[85dvh] w-full max-w-xl overflow-y-auto rounded-2xl border border-white/15 bg-[#191d21] p-5 space-y-4">
        <div className="flex justify-between gap-2"><h2 className="font-semibold">Settlement instruction</h2><button onClick={close} disabled={busy} className={btn}>Close</button></div>
        <p className="break-all text-xs text-gray-400">Order {selected.orderId}</p>
        <p className="text-sm">Network: {selected.network}</p><p className="text-sm">Amount: {net ? formatAtomic(selected.amountAtomic,net.decimals) + ' ' + net.asset : selected.amountAtomic}</p>
        <p className="break-all text-sm">Source: {selected.address}</p><p className="break-all text-sm">Destination: {selected.treasuryTransfer?.destination || net?.destination || 'Not configured'}</p>
        <p className="text-xs text-amber-200">Check source, asset, network and destination in your custody wallet. Fees are separate. Do not broadcast twice. An authorization is not a payment.</p>
        {!selected.treasuryTransfer && <>
          <label className="block text-sm">Confirm exact configured destination<input value={destination} onChange={e => setDestination(e.target.value)} className="mt-1 w-full rounded-lg border border-white/15 bg-black/20 p-2" autoComplete="off"/></label>
          <label className="block text-sm">Fresh authenticator code<input type="password" inputMode="numeric" maxLength={6} value={code} onChange={e => setCode(e.target.value)} className="mt-1 w-full rounded-lg border border-white/15 bg-black/20 p-2" autoComplete="off"/></label>
          <button className={btn} disabled={busy || !data?.instructionsEnabled || !net?.destination || destination !== net.destination || !/^\d{6}$/.test(code)} onClick={() => void submit('authorize')}>Authorize transfer instruction</button>
        </>}
        {selected.treasuryTransfer && <>
          <p className="text-sm">Status: {label(selected.treasuryTransfer.status)}</p>
          <button className={btn} disabled={selected.treasuryTransfer.automation} onClick={() => void copy(JSON.stringify({ network: selected.treasuryTransfer!.network, source: selected.treasuryTransfer!.source, destination: selected.treasuryTransfer!.destination, amountAtomic: selected.treasuryTransfer!.amountAtomic, reference: selected.treasuryTransfer!.id }, null, 2))}>Copy authorized instruction</button>
          {selected.treasuryTransfer.automation && <p className="text-xs text-amber-200">Managed by the automatic settlement worker. Do not manually broadcast this instruction. {selected.treasuryTransfer.lastFailure || ''}</p>}
          {!selected.treasuryTransfer.automation && selected.treasuryTransfer.status === 'AUTHORIZED' && <>
            <label className="block text-sm">Externally broadcast transaction hash<input value={hash} onChange={e => setHash(e.target.value)} className="mt-1 w-full rounded-lg border border-white/15 bg-black/20 p-2" autoComplete="off"/></label>
            <label className="block text-sm">Fresh authenticator code<input type="password" inputMode="numeric" maxLength={6} value={code} onChange={e => setCode(e.target.value)} className="mt-1 w-full rounded-lg border border-white/15 bg-black/20 p-2" autoComplete="off"/></label>
            <button className={btn} disabled={busy || !hash.trim() || !/^\d{6}$/.test(code)} onClick={() => void submit('broadcast')}>Record external broadcast</button>
          </>}
          {!selected.treasuryTransfer.automation && selected.treasuryTransfer.status === 'SUBMITTED_UNVERIFIED' && <><p className="break-all text-xs">{selected.treasuryTransfer.transactionHash}</p>{['usdt-bep20','usdc-base','usdt-erc20'].includes(selected.network) ? <button className={btn} disabled={busy} onClick={() => void submit('verify')}>Verify outgoing transaction</button> : <p className="text-sm text-amber-200">Outgoing verification for this network is not implemented. Reconcile with the custody wallet; status remains unverified.</p>}</>}
        </>}
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      </div>
    </section>}
  </div>;
}
