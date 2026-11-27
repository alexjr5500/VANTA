import { createHash } from 'crypto';
import type { ShopCryptoInvoice } from '@prisma/client';
import { tronAddressHex, TRON_USDT_ADDRESS, shopTronAddresses } from '../config/tron-address';
import { verifyTronUsdt, discoverTronUsdt } from '../services/shop-tron.service';
import { ERC20_TRANSFER_EVENT_SIGNATURE } from '../config/blockchain-networks.config';

function address(hex: string) {
  const payload = Buffer.from(hex, 'hex');
  const hash = (b: Buffer) => createHash('sha256').update(b).digest();
  const bytes = Buffer.concat([payload, hash(hash(payload)).subarray(0, 4)]);
  let n = BigInt('0x' + bytes.toString('hex')), result = '';
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  while (n > BigInt(0)) { result = alphabet[Number(n % BigInt(58))] + result; n /= BigInt(58); }
  return result;
}
const recipient = '41' + 'b'.repeat(40);
const sender = '41' + 'd'.repeat(40);
const receiving = address(recipient);
const contract = tronAddressHex(TRON_USDT_ADDRESS)!;
const hash = 'a'.repeat(64);
const time = 1795800000000;
const atomic = '1990000';
const topic = (v: string) => v.slice(2).padStart(64, '0');
const amount = BigInt(atomic).toString(16).padStart(64, '0');
const invoice = { network: 'usdt-trc20', address: receiving, amountAtomic: atomic, startBlock: 15, createdAt: new Date(time - 1000), expiresAt: new Date(time + 1000) } as ShopCryptoInvoice;
const tx = { txID: hash, ret: [{ contractRet: 'SUCCESS' }], raw_data: { contract: [{ type: 'TriggerSmartContract', parameter: { value: { contract_address: contract, owner_address: sender, data: 'a9059cbb' + topic(recipient) + amount } } }] } };
const info = { id: hash, blockNumber: 16, blockTimeStamp: time, receipt: { result: 'SUCCESS' }, log: [{ address: contract.slice(2), topics: [ERC20_TRANSFER_EVENT_SIGNATURE.slice(2), topic(sender), topic(recipient)], data: amount }] };
function mock(overrides: Record<string, unknown> = {}) {
  return jest.fn(async (path: string) => {
    if (Object.prototype.hasOwnProperty.call(overrides, path)) return overrides[path] as Record<string, unknown>;
    if (path === '/walletsolidity/gettransactionbyid') return tx;
    if (path === '/walletsolidity/gettransactioninfobyid') return info;
    if (path === '/walletsolidity/getblockbynum') return { blockID: 'f'.repeat(64), block_header: { raw_data: { number: 16, timestamp: time } }, transactions: [{ txID: hash }] };
    if (path.startsWith('/v1/accounts/')) return { data: [{ transaction_id: hash, type: 'Transfer', token_info: { address: TRON_USDT_ADDRESS }, to: receiving, value: atomic }] };
    throw new Error('Unexpected endpoint');
  });
}
describe('TRON USDT dedicated invoice', () => {
  test('validates the official contract and Base58Check', () => {
    expect(contract).toBe('41a614f803b6fd780986a42c78ec9c7f77e6ded13c');
    expect(tronAddressHex(receiving)).toBe(recipient);
    expect(tronAddressHex(receiving.slice(0, -1) + (receiving.endsWith('A') ? 'B' : 'A'))).toBeNull();
  });
  test('requires a successful solidified exact transfer', async () => {
    await expect(verifyTronUsdt(invoice, hash, mock())).resolves.toMatchObject({ verified: true, txHash: hash, amountAtomic: atomic });
  });
  test('rejects failed, counterfeit, short and out-of-window payments', async () => {
    await expect(verifyTronUsdt(invoice, hash, mock({ '/walletsolidity/gettransactioninfobyid': { ...info, receipt: { result: 'REVERT' } } }))).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' });
    for (const patch of [{ address: sender.slice(2) }, { data: '0'.repeat(64) }, { topics: [ERC20_TRANSFER_EVENT_SIGNATURE.slice(2), topic(sender), topic(sender)] }]) {
      await expect(verifyTronUsdt(invoice, hash, mock({ '/walletsolidity/gettransactioninfobyid': { ...info, log: [{ ...info.log[0], ...patch }] } }))).rejects.toMatchObject({ code: 'AMOUNT_MISMATCH' });
    }
    await expect(verifyTronUsdt({ ...invoice, startBlock: 17 }, hash, mock())).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' });
  });
  test('does not settle on an unconfirmed or missing block', async () => {
    await expect(verifyTronUsdt(invoice, hash, mock({ '/walletsolidity/gettransactionbyid': {} }))).rejects.toMatchObject({ code: 'TRANSACTION_PENDING' });
    await expect(verifyTronUsdt(invoice, hash, mock({ '/walletsolidity/getblockbynum': {} }))).rejects.toMatchObject({ code: 'RPC_ERROR' });
  });
  test('history only discovers candidate hashes', async () => {
    await expect(discoverTronUsdt(invoice, mock())).resolves.toEqual([hash]);
  });
  test('rejects malformed pool and the token contract itself', () => {
    const old = process.env.VANTA_SHOP_TRON_DEPOSIT_ADDRESSES;
    try {
      process.env.VANTA_SHOP_TRON_DEPOSIT_ADDRESSES = receiving + ',' + receiving;
      expect(shopTronAddresses()).toEqual([receiving]);
      process.env.VANTA_SHOP_TRON_DEPOSIT_ADDRESSES = receiving + ',' + TRON_USDT_ADDRESS;
      expect(shopTronAddresses()).toEqual([]);
    } finally { if (old === undefined) delete process.env.VANTA_SHOP_TRON_DEPOSIT_ADDRESSES; else process.env.VANTA_SHOP_TRON_DEPOSIT_ADDRESSES = old; }
  });
});
