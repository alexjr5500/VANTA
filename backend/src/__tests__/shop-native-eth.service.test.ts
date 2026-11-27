import type { ShopCryptoInvoice } from '@prisma/client';
import { getBlockchainNetwork } from '../config/blockchain-networks.config';
import { atomicDisplay, ethAtomicFromQuote, quoteEth, verifyNativeEth } from '../services/shop-native-eth.service';

const network = getBlockchainNetwork('eth-erc20')!;
const now = 1795800000000;
const hash = '0x' + 'a'.repeat(64);
const address = '0x' + 'b'.repeat(40);
const blockHash = '0x' + 'c'.repeat(64);
const price = '250000000000'; // 2500 USD with 8 decimals
const wei = '400000000000000';
const invoice = { address, amountAtomic: wei, startBlock: 15, createdAt: new Date(now - 1000), expiresAt: new Date(now + 1000) } as ShopCryptoInvoice;
const words = (...numbers: bigint[]) => '0x' + numbers.map(n => n.toString(16).padStart(64, '0')).join('');
const encode = (n: number | bigint) => '0x' + n.toString(16);
const tx = { hash, to: address, from: '0x' + 'd'.repeat(40), input: '0x', value: encode(BigInt(wei)), blockNumber: '0x10', blockHash };
const receipt = { transactionHash: hash, status: '0x1', to: address, blockNumber: '0x10', blockHash };
function rpcWith(overrides: Record<string, unknown> = {}) {
  return jest.fn(async (_net, method, params) => {
    if (Object.prototype.hasOwnProperty.call(overrides, method)) return overrides[method];
    switch (method) {
      case 'eth_chainId': return '0x1';
      case 'eth_call': return params[0].data === '0x313ce567' ? '0x8' : words(BigInt(10), BigInt(price), BigInt(now / 1000 - 5), BigInt(now / 1000 - 5), BigInt(10));
      case 'eth_getTransactionByHash': return tx;
      case 'eth_getTransactionReceipt': return receipt;
      case 'eth_getBlockByNumber': return params[0] === 'finalized' ? { number: '0x20' } : { number: '0x10', hash: blockHash, timestamp: encode(now / 1000) };
      default: throw new Error('Unexpected RPC call');
    }
  });
}
describe('native ETH shop checkout', () => {
  test('uses exact integer wei and displays the complete amount', () => {
    expect(ethAtomicFromQuote(1, price)).toBe(wei);
    expect(atomicDisplay(wei, 18)).toBe('0.0004');
    expect(ethAtomicFromQuote(1, '300000000000')).toBe('333333333333334');
  });
  test('takes a fresh server-derived quote', async () => {
    await expect(quoteEth(network, 1, rpcWith(), now)).resolves.toMatchObject({ amountAtomic: wei, quotePrice8: price });
  });
  test('rejects a stale feed', async () => {
    await expect(quoteEth(network, 1, rpcWith(), now + 3600001)).rejects.toThrow('stale');
  });
  test('accepts an exact finalized direct transfer', async () => {
    await expect(verifyNativeEth(network, invoice, hash, rpcWith())).resolves.toMatchObject({ verified: true, txHash: hash, amountAtomic: wei });
  });
  test('rejects wrong chain, wrong amount and wrong recipient', async () => {
    await expect(verifyNativeEth(network, invoice, hash, rpcWith({ eth_chainId: '0x38' }))).rejects.toThrow('Wrong Ethereum network');
    await expect(verifyNativeEth(network, invoice, hash, rpcWith({ eth_getTransactionByHash: { ...tx, value: encode(BigInt(wei) - BigInt(1)) } }))).rejects.toMatchObject({ code: 'AMOUNT_MISMATCH' });
    await expect(verifyNativeEth(network, invoice, hash, rpcWith({ eth_getTransactionByHash: { ...tx, to: tx.from } }))).rejects.toMatchObject({ code: 'AMOUNT_MISMATCH' });
  });
  test('rejects failed, old or nonfinal transactions', async () => {
    await expect(verifyNativeEth(network, invoice, hash, rpcWith({ eth_getTransactionReceipt: { ...receipt, status: '0x0' } }))).rejects.toThrow();
    await expect(verifyNativeEth(network, { ...invoice, startBlock: 17 }, hash, rpcWith())).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' });
    await expect(verifyNativeEth(network, invoice, hash, rpcWith({ eth_getBlockByNumber: { number: '0x0f' } }))).rejects.toMatchObject({ code: 'LOW_CONFIRMATIONS' });
  });
});
