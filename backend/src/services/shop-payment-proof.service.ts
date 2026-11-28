import { prisma } from '../prisma';
import type { Prisma } from '@prisma/client';
import { shopLiveCryptoEnabled, shopLiveGiftsEnabled } from '../config/shop-crypto.config';
type Order = {id:string;userId:string;paymentMode:string|null;recipientUserId?:string|null;paymentMethod?:string|null;network?:string|null};
export function shopPaymentReference(network:string,hash:string) {return network==='usdt-trc20'?'tron:'+hash:network==='gram-ton'?'ton:'+hash:hash;}
/** Only a durable independently verified dedicated invoice may recover an expired order.
 * This is not a client-controlled assertion. Legacy calls never pass invoiceId.
 */
export async function requireShopPaymentProof(product:'coins'|'badge',order:Order,invoiceId:string,reference:unknown,db:Prisma.TransactionClient=prisma) {
 if(!shopLiveCryptoEnabled() || order.paymentMode!=='live' || (order.recipientUserId && !shopLiveGiftsEnabled()))throw new Error('Live checkout unavailable');
 const invoice=await db.shopCryptoInvoice.findFirst({where:{id:invoiceId,orderId:order.id,payerId:order.userId,product,network:product==='coins'?order.paymentMethod||'':order.network||'',verifiedAt:{not:null},transactionHash:{not:null}}});
 if(!invoice?.transactionHash || reference!==shopPaymentReference(invoice.network,invoice.transactionHash))throw new Error('Verified dedicated invoice required');
 const hold=await db.shopCryptoCase.findUnique({where:{invoiceId:invoice.id}});
 if(hold && hold.kind==='REFUND' && hold.status!=='REJECTED')throw new Error('Payment held for refund review');
 return invoice;
}
