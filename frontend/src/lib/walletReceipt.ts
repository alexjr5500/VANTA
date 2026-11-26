export type WalletReceipt = { id: string; status: string; amount: number; fee: number; netAmount: number; createdAt?: string };
export function readWalletReceipt(value: unknown): WalletReceipt | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(row.id) || typeof row.status !== 'string' ||
      typeof row.amount !== 'number' || typeof row.fee !== 'number' || typeof row.netAmount !== 'number' ||
      ![row.amount,row.fee,row.netAmount].every(n=>Number.isFinite(n)&&n>=0)) return null;
  return {id:row.id,status:row.status,amount:row.amount,fee:row.fee,netAmount:row.netAmount,createdAt:typeof row.createdAt==='string'?row.createdAt:undefined};
}
export function downloadWalletReceipt(kind:'transfer'|'withdrawal', record:WalletReceipt, recipient?:string) {
  const text = ['VANTA '+kind+' record','Reference: '+record.id,'Status: '+record.status,'Date: '+(record.createdAt||'Unavailable'),
    'Currency: '+(kind==='transfer'?'VANTA':'USD / USDT'),'Amount: '+record.amount,'Fee: '+record.fee,'Net amount: '+record.netAmount,
    ...(recipient?['Recipient: '+recipient]:[]),kind==='withdrawal'?'A withdrawal request is not proof of external settlement.':'Internal VANTA coin transfer record.'].join('\n');
  const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='vanta-'+kind+'-'+record.id+'.txt';document.body.appendChild(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
