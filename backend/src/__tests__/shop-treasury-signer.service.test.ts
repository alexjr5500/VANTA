import { createHmac } from 'crypto';
import { validateSignerResult, verifySignerResponse, SettlementIntent, requestCustody, SignerConfig } from '../services/shop-treasury-signer.service';
const intent: SettlementIntent = {
  requestId: 'req-1', policyId: 'policy-1', network: 'usdt-bep20', chainId: 56,
  tokenContract: '0x' + 'a'.repeat(40), source: '0x' + 'b'.repeat(40), destination: '0x' + 'c'.repeat(40),
  amountAtomic: '1000000000000000000', maxFeeAtomic: '1000000',
  incomingTransactionHash: '0x' + 'd'.repeat(64), expiresAt: '2026-11-27T22:00:00.000Z',
};
const valid = { ...intent, status: 'broadcast', transactionHash: '0x' + 'e'.repeat(64), approvedFeeAtomic: '500000' };
describe('Treasury custody response validation', () => {
  test('authenticates exact response bytes and request nonce', () => {
    const secret = 'test'.repeat(10), nonce = 'nonce', raw = JSON.stringify(valid);
    const signature = createHmac('sha256', secret).update('vanta-treasury-response-v1\n' + nonce + '\n' + raw).digest('hex');
    expect(() => verifySignerResponse(secret, nonce, raw, signature)).not.toThrow();
    expect(() => verifySignerResponse(secret, 'other', raw, signature)).toThrow();
    expect(() => verifySignerResponse(secret, nonce, raw + ' ', signature)).toThrow();
    expect(() => verifySignerResponse(secret, nonce, raw, null)).toThrow();
  });
  test('validates a bound broadcast but never treats it as verified settlement', () => {
    expect(validateSignerResult(valid, intent, false)).toEqual({ status: 'broadcast', transactionHash: valid.transactionHash });
  });
  test.each([{ destination: intent.source }, { source: intent.destination }, { chainId: 1 }, { tokenContract: intent.source }, { amountAtomic: '1' }, { maxFeeAtomic: '999' }, { approvedFeeAtomic: '1000001' }, { transactionHash: intent.incomingTransactionHash }, { requestId: 'other' }, { policyId: 'other' }, { expiresAt: '2027-01-01' }])('rejects mismatched intent %j', patch => {
    expect(() => validateSignerResult({ ...valid, ...patch }, intent, false)).toThrow();
  });
  test('not_found is permitted only for status lookup', () => {
    const missing = { requestId: intent.requestId, policyId: intent.policyId, status: 'not_found' };
    expect(validateSignerResult(missing, intent, true)).toEqual({ status: 'not_found' });
    expect(() => validateSignerResult(missing, intent, false)).toThrow();
  });
});

describe('Controlled custody protocol test (no signing or broadcast)', () => {
  const originalFetch = global.fetch;
  const config: SignerConfig = { origin:'https://custody.example.test',policyId:intent.policyId,secret:'test'.repeat(10),maxOrderCents:1000,dailyCapCents:10000,networks:[{network:'usdt-bep20',destination:intent.destination,maxFeeAtomic:intent.maxFeeAtomic}] };
  afterEach(() => { global.fetch=originalFetch; });
  test('authenticated PUT and status GET retain exact immutable intent', async () => {
    const stored = new Map<string,string>();
    const seen = new Set<string>();
    global.fetch = jest.fn(async (url,init) => {
      expect(String(url)).toBe(config.origin+'/v1/settlements/'+intent.requestId);
      expect(init?.redirect).toBe('error');
      const h = init!.headers as Record<string,string>;
      const body = String(init?.body || '');
      const path = '/v1/settlements/'+intent.requestId;
      expect(h['Idempotency-Key']).toBe(intent.requestId);
      expect(seen.has(h['X-Vanta-Nonce'])).toBe(false);
      seen.add(h['X-Vanta-Nonce']);
      const mac = createHmac('sha256',config.secret).update(['vanta-treasury-request-v1',init!.method,path,h['X-Vanta-Timestamp'],h['X-Vanta-Nonce'],body].join('\n')).digest('hex');
      expect(h['X-Vanta-Signature']).toBe(mac);
      if (init?.method==='PUT') {
        expect(JSON.parse(body)).toEqual(intent);
        expect(stored.has(intent.requestId)).toBe(false);
        stored.set(intent.requestId,body);
      } else expect(stored.get(intent.requestId)).toBe(JSON.stringify(intent));
      const payload = JSON.stringify({...intent,status:'accepted'});
      const signature = createHmac('sha256',config.secret).update('vanta-treasury-response-v1\n'+h['X-Vanta-Nonce']+'\n'+payload).digest('hex');
      return new Response(payload,{status:200,headers:{'X-Custody-Signature':signature}});
    }) as typeof fetch;
    await expect(requestCustody(config,intent,'submit')).resolves.toEqual({status:'accepted'});
    await expect(requestCustody(config,intent,'status')).resolves.toEqual({status:'accepted'});
    expect(stored.size).toBe(1);
    expect(seen.size).toBe(2);
  });
  test('rejects forged provider responses and cross-chain hashes', async () => {
    global.fetch=jest.fn(async()=>new Response(JSON.stringify(valid),{headers:{'X-Custody-Signature':'0'.repeat(64)}})) as typeof fetch;
    await expect(requestCustody(config,intent,'status')).rejects.toThrow('not authenticated');
    const tron={...intent,network:'usdt-trc20',incomingTransactionHash:'d'.repeat(64)};
    const ton={...intent,network:'gram-ton',incomingTransactionHash:'d'.repeat(64)};
    expect(validateSignerResult({...tron,status:'broadcast',transactionHash:'e'.repeat(64),approvedFeeAtomic:'1'},tron,false).transactionHash).toBe('e'.repeat(64));
    expect(()=>validateSignerResult({...tron,status:'broadcast',transactionHash:valid.transactionHash,approvedFeeAtomic:'1'},tron,false)).toThrow();
    expect(()=>validateSignerResult({...ton,status:'broadcast',transactionHash:Buffer.from('d'.repeat(64),'hex').toString('base64'),approvedFeeAtomic:'1'},ton,false)).toThrow();
  });
});
