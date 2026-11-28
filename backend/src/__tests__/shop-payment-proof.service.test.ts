import { prisma } from '../prisma';
import { shopLiveCryptoEnabled,shopLiveGiftsEnabled } from '../config/shop-crypto.config';
import { requireShopPaymentProof,shopPaymentReference } from '../services/shop-payment-proof.service';
jest.mock('../prisma',()=>({prisma:{shopCryptoInvoice:{findFirst:jest.fn()},shopCryptoCase:{findUnique:jest.fn()}}}));
jest.mock('../config/shop-crypto.config',()=>({shopLiveCryptoEnabled:jest.fn(),shopLiveGiftsEnabled:jest.fn()}));
const hash='0x'+'a'.repeat(64);
const order={id:'order',userId:'payer',paymentMode:'live',paymentMethod:'usdt-bep20',recipientUserId:'recipient'};
describe('Dedicated live checkout proof',()=>{
 beforeEach(()=>{jest.resetAllMocks();(shopLiveCryptoEnabled as jest.Mock).mockReturnValue(true);(shopLiveGiftsEnabled as jest.Mock).mockReturnValue(true);(prisma.shopCryptoInvoice.findFirst as jest.Mock).mockResolvedValue({id:'invoice',network:'usdt-bep20',transactionHash:hash,verifiedAt:new Date()});(prisma.shopCryptoCase.findUnique as jest.Mock).mockResolvedValue(null);});
 test('binds verified invoice to payer, product, order, network and exact hash',async()=>{
  await expect(requireShopPaymentProof('coins',order,'invoice',hash)).resolves.toMatchObject({id:'invoice'});
  expect(prisma.shopCryptoInvoice.findFirst).toHaveBeenCalledWith({where:{id:'invoice',orderId:'order',payerId:'payer',product:'coins',network:'usdt-bep20',verifiedAt:{not:null},transactionHash:{not:null}}});
  await expect(requireShopPaymentProof('coins',order,'invoice','different')).rejects.toThrow('Verified dedicated');
 });
 test('rejects gift opt-out, sandbox, missing proof and refund holds',async()=>{
  (shopLiveGiftsEnabled as jest.Mock).mockReturnValue(false);
  await expect(requireShopPaymentProof('coins',order,'invoice',hash)).rejects.toThrow('unavailable');
  (shopLiveGiftsEnabled as jest.Mock).mockReturnValue(true);
  await expect(requireShopPaymentProof('coins',{...order,paymentMode:'test'},'invoice',hash)).rejects.toThrow();
  (prisma.shopCryptoCase.findUnique as jest.Mock).mockResolvedValue({kind:'REFUND',status:'OPEN'});
  await expect(requireShopPaymentProof('coins',order,'invoice',hash)).rejects.toThrow('refund review');
  (prisma.shopCryptoCase.findUnique as jest.Mock).mockResolvedValue({kind:'REFUND',status:'REJECTED'});
  await expect(requireShopPaymentProof('coins',order,'invoice',hash)).resolves.toBeTruthy();
  (prisma.shopCryptoInvoice.findFirst as jest.Mock).mockResolvedValue(null);
  await expect(requireShopPaymentProof('coins',order,'invoice',hash)).rejects.toThrow();
 });
 test('preserves non-EVM reference namespace',()=>{expect(shopPaymentReference('usdt-trc20','hash')).toBe('tron:hash');expect(shopPaymentReference('gram-ton','hash')).toBe('ton:hash');});
});
