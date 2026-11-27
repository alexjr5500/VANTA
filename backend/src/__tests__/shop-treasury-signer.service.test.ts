import { createHmac } from 'crypto';
import { validateSignerResult, verifySignerResponse, SettlementIntent } from '../services/shop-treasury-signer.service';
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
