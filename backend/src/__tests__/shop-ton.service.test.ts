import type { ShopCryptoInvoice } from '@prisma/client';
import { tonRawAddress, tonFriendlyAddress, shopTonAddresses } from '../config/ton-address';
import { gramAtomicFromQuote, parseGramQuote, verifyGram, tonHashHex, discoverGram, tonHead, gramPaymentUri } from '../services/shop-ton.service';

const address = '0:' + 'b'.repeat(64);
const sender = '0:' + 'd'.repeat(64);
const hash = 'a'.repeat(64);
const time = 1795800000000;
const amountAtomic = '1000000000';
const invoice = { network: 'gram-ton', address, amountAtomic, startBlock: 15, createdAt: new Date(time - 1000), expiresAt: new Date(time + 1000) } as ShopCryptoInvoice;
const tx = { hash: Buffer.from(hash, 'hex').toString('base64'), account: address, emulated: false, now: time / 1000, mc_block_seqno: 16, block_ref: { workchain: 0 }, orig_status: 'active', end_status: 'active',
  in_msg: { source: sender, destination: address, bounced: false, value: amountAtomic }, description: { aborted: false, destroyed: false, credit_ph: { credit: amountAtomic }, compute_ph: { success: true, exit_code: 0 } }, out_msgs: [] };
function mock(t: Record<string, unknown> = tx, chain = -239, height = 20, inclusion = true) {
  return jest.fn(async (path: string, query?: Record<string, string>) => {
    if (path === '/api/v3/masterchainInfo') return { last: { global_id: chain, workchain: -1, seqno: height, root_hash: hash } };
    if (path === '/api/v3/transactions') return { transactions: query?.mc_seqno && !inclusion ? [] : [t] };
    throw new Error('Unexpected API request');
  });
}
describe('TON native GRAM checkout', () => {
  test('canonicalizes a mainnet address and rejects checksum changes', () => {
    const friendly = tonFriendlyAddress(address);
    expect(friendly.startsWith('UQ')).toBe(true);
    expect(tonRawAddress(friendly)).toBe(address);
    expect(tonRawAddress(friendly.slice(0, -1) + (friendly.endsWith('A') ? 'B' : 'A'))).toBeNull();
    expect(gramPaymentUri(address, amountAtomic)).toBe('ton://transfer/' + friendly + '?amount=' + amountAtomic);
  });
  test('uses exact integer nanograms and a fresh native asset quote', () => {
    expect(gramAtomicFromQuote(1, '100000000')).toBe(amountAtomic);
    expect(gramAtomicFromQuote(1, '300000000')).toBe('333333334');
    expect(parseGramQuote({ 'the-open-network': { usd: 1, last_updated_at: time / 1000 } }, 1, time).amountAtomic).toBe(amountAtomic);
    expect(() => parseGramQuote({ 'the-open-network': { usd: 1, last_updated_at: time / 1000 - 301 } }, 1, time)).toThrow('stale');
  });
  test('canonicalizes hashes and verifies masterchain inclusion', async () => {
    expect(tonHashHex(tx.hash)).toBe(hash);
    await expect(verifyGram(invoice, tx.hash, mock())).resolves.toMatchObject({ verified: true, txHash: hash, asset: 'GRAM' });
  });
  test('rejects testnet and unfinalized or missing inclusion', async () => {
    await expect(tonHead(mock(tx, -3))).rejects.toThrow('mainnet');
    await expect(verifyGram(invoice, hash, mock(tx, -239, 15))).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' });
    await expect(verifyGram(invoice, hash, mock(tx, -239, 20, false))).rejects.toMatchObject({ code: 'RPC_ERROR' });
  });
  test('rejects bounced, emulated, incorrect amount and failed transactions', async () => {
    for (const patch of [{ emulated: true }, { in_msg: { ...tx.in_msg, bounced: true } }, { in_msg: { ...tx.in_msg, value: '1' } }, { description: { ...tx.description, aborted: true } }, { out_msgs: [{}] }, { mc_block_seqno: 14 }]) {
      await expect(verifyGram(invoice, hash, mock({ ...tx, ...patch }))).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' });
    }
  });
  test('discovers only candidate hashes and deduplicates friendly/raw addresses', async () => {
    await expect(discoverGram(invoice, mock())).resolves.toEqual([hash]);
    const old = process.env.VANTA_SHOP_TON_DEPOSIT_ADDRESSES;
    try {
      process.env.VANTA_SHOP_TON_DEPOSIT_ADDRESSES = address + ',' + tonFriendlyAddress(address);
      expect(shopTonAddresses()).toEqual([address]);
    } finally { if (old === undefined) delete process.env.VANTA_SHOP_TON_DEPOSIT_ADDRESSES; else process.env.VANTA_SHOP_TON_DEPOSIT_ADDRESSES = old; }
  });
});
