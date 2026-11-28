import { prisma } from '../prisma';
import { appendAuditLog } from '../security/auditLog';
import { treasuryHash } from '../config/shop-treasury-hash';
import { shopLiveCryptoEnabled } from '../config/shop-crypto.config';
import { twoFactorAuth } from '../security/twoFactorAuth';
import { blockchainTxVerifier } from './blockchain-verifier.service';
import { getBlockchainNetwork,getMinBlockchainConfirmations } from '../config/blockchain-networks.config';

const unfulfilled=['PENDING','PROCESSING','PAID','EXPIRED'];
export async function openShopCryptoCase(payerId:string,orderId:string,input:Record<string,unknown>){
 const kind=input.kind==='REFUND'?'REFUND':input.kind==='RECONCILIATION'?'RECONCILIATION':null;
 const reason=typeof input.reason==='string'?input.reason.trim():'';
 if(!kind||reason.length<10||reason.length>500)throw new Error('Describe the payment issue in 10–500 characters');
 return prisma.$transaction(async tx=>{
  const i=await tx.shopCryptoInvoice.findFirst({where:{payerId,orderId}});
  if(!i)throw new Error('Invoice unavailable');
  await tx.$queryRaw`SELECT "id" FROM "ShopCryptoInvoice" WHERE "id" = ${i.id} FOR UPDATE`;
  const reportedHash=input.txHash==null||input.txHash===''?null:treasuryHash(i.network,input.txHash);
  if(input.txHash&&!reportedHash)throw new Error('Invalid transaction hash');
  const current=await tx.shopCryptoCase.findUnique({where:{invoiceId:i.id}});
  if(current)return current;
  const record=await tx.shopCryptoCase.create({data:{invoiceId:i.id,kind,reason,reportedHash}});
  await appendAuditLog(tx,{userId:payerId,action:'SHOP_CRYPTO_CASE_OPENED',metadata:{caseId:record.id,invoiceId:i.id,kind}});
  return record;
 });
}
export async function listShopCryptoCases(cursor?:string){
 const rows=await prisma.shopCryptoCase.findMany({orderBy:{id:'asc'},take:51,...(cursor?{cursor:{id:cursor},skip:1}:{}),include:{invoice:{select:{orderId:true,payerId:true,product:true,network:true,address:true,amountAtomic:true,transactionHash:true,paymentSender:true,verifiedAt:true,settledAt:true,treasuryTransfer:{select:{status:true}}}}}});
 return {cases:rows.slice(0,50),nextCursor:rows.length>50?rows[49].id:null};
}
async function stepUp(actor:string,code:unknown){
 if(typeof code!=='string'||!/^\d{6}$/.test(code))throw new Error('Fresh authenticator code required');
 const user=await prisma.user.findUnique({where:{id:actor},select:{role:true,status:true,twoFactorEnabled:true}});
 if(!user?.twoFactorEnabled||user.status!=='ACTIVE'||!['CEO','SUPER_ADMIN'].includes(user.role))throw new Error('Authorization unavailable');
 const verified=await twoFactorAuth.verifyLogin(actor,code);
 if(!verified.valid||verified.isBackupCode)throw new Error('Invalid authenticator code');
}
export async function reviewShopCryptoCase(actor:string,id:string,input:Record<string,unknown>){
 const action=input.action, note=typeof input.note==='string'?input.note.trim():'';
 if(!['REVIEW','REJECT','RESOLVE','AUTHORIZE_REFUND'].includes(String(action))||note.length<10||note.length>500)throw new Error('Review action and reason required');
 await stepUp(actor,input.code);
 return prisma.$transaction(async tx=>{
  const record=await tx.shopCryptoCase.findUnique({where:{id},include:{invoice:true}});
  if(!record||!['OPEN','REVIEWING'].includes(record.status))throw new Error('Case not reviewable');
  const i=record.invoice;
  await tx.$queryRaw`SELECT "id" FROM "ShopCryptoInvoice" WHERE "id" = ${i.id} FOR UPDATE`;
  const fresh=await tx.shopCryptoInvoice.findUniqueOrThrow({where:{id:i.id}});
  let data:{status:string;reviewedBy:string;reviewNote:string;refundDestination?:string;refundAuthorizedAt?:Date}={status:action==='REVIEW'?'REVIEWING':action==='REJECT'?'REJECTED':'RESOLVED',reviewedBy:actor,reviewNote:note};
  if(action==='RESOLVE' && record.kind==='REFUND')throw new Error('Refund cannot be marked resolved without verified outgoing payment');
  if(action==='AUTHORIZE_REFUND'){
   // Narrow release: verified, unfulfilled, unswept EVM stablecoin invoices
   // only. Never authorize from a user-submitted hash or arbitrary address.
   if(!shopLiveCryptoEnabled()||process.env.VANTA_SHOP_EXTERNAL_REFUNDS_ENABLED!=='true'||record.kind!=='REFUND'||!['usdt-bep20','usdc-base','usdt-erc20'].includes(fresh.network)||!fresh.verifiedAt||!fresh.transactionHash||fresh.settledAt||!fresh.paymentSender||!/^0x[0-9a-f]{40}$/.test(fresh.paymentSender)||fresh.address===fresh.paymentSender||input.destination!==fresh.paymentSender||input.senderOwnershipReviewed!==true)throw new Error('Refund requires verified unfulfilled payment and reviewed original sender');
   if(await tx.shopTreasuryTransfer.findUnique({where:{invoiceId:i.id}}))throw new Error('Treasury transfer exists; reconcile externally');
   const order=fresh.product==='coins'?await tx.purchaseOrder.findUnique({where:{id:fresh.orderId}}):await tx.verificationPurchase.findUnique({where:{id:fresh.orderId}});
   if(!order||order.userId!==fresh.payerId||order.paymentMode!=='live'||!unfulfilled.includes(order.status))throw new Error('Entitlement already fulfilled or order unavailable');
   data={...data,status:'REFUND_AUTHORIZED',refundDestination:fresh.paymentSender,refundAuthorizedAt:new Date()};
  }
  const claim=await tx.shopCryptoCase.updateMany({where:{id,status:record.status},data});
  if(claim.count!==1)throw new Error('Case changed');
  await appendAuditLog(tx,{userId:actor,action:'SHOP_CRYPTO_CASE_'+String(action),severity:'CRITICAL',metadata:{caseId:id,invoiceId:i.id,note,status:data.status,destination:data.refundDestination}});
  return tx.shopCryptoCase.findUniqueOrThrow({where:{id}});
 });
}
export async function verifyShopCryptoRefund(actor:string,id:string,input:Record<string,unknown>){
 const record=await prisma.shopCryptoCase.findUnique({where:{id},include:{invoice:true}});
 if(!record||record.status!=='REFUND_AUTHORIZED'||!record.refundDestination||!record.refundAuthorizedAt)throw new Error('No authorized refund');
 const i=record.invoice,network=getBlockchainNetwork(i.network),hash=treasuryHash(i.network,input.txHash);
 if(!network||network.native||network.tron||network.ton||!hash||hash===i.transactionHash||!i.verifiedAt||i.settledAt)throw new Error('Invalid refund evidence');
 await stepUp(actor,input.code);
 const amount=Number(BigInt(i.amountAtomic))/Number(BigInt(10)**BigInt(network.tokenDecimals));
 const proof=await blockchainTxVerifier.verifyTransaction({network:i.network,txHash:hash,expectedRecipient:record.refundDestination,expectedSender:i.address,expectedAmountUsd:amount,expectedAtomicAmount:i.amountAtomic,notBefore:new Date(Math.floor(record.refundAuthorizedAt.getTime()/1000)*1000),notAfter:new Date(),minConfirmations:Math.max(12,getMinBlockchainConfirmations())});
 if(!proof.verified||proof.txHash.toLowerCase()!==hash||proof.sender?.toLowerCase()!==i.address)throw new Error('Refund proof mismatch');
 return prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "ShopCryptoInvoice" WHERE "id" = ${i.id} FOR UPDATE`;
  const fresh=await tx.shopCryptoInvoice.findUniqueOrThrow({where:{id:i.id}});
  if(fresh.settledAt||fresh.transactionHash!==i.transactionHash||await tx.shopTreasuryTransfer.findUnique({where:{invoiceId:i.id}}))throw new Error('Invoice changed; reconcile externally');
  if(await tx.shopCryptoInvoice.findFirst({where:{network:i.network,transactionHash:hash}}))throw new Error('Refund hash belongs to incoming payment');
  const data={status:'REFUNDED',refundedAt:new Date(),refundedBy:actor,refundReason:record.reviewNote||'Verified crypto refund'};
  const where={id:i.orderId,userId:i.payerId,paymentMode:'live',status:{in:unfulfilled}};
  const order=i.product==='coins'?await tx.purchaseOrder.updateMany({where,data}):await tx.verificationPurchase.updateMany({where,data});
  if(order.count!==1)throw new Error('Order changed; reconcile externally');
  const claim=await tx.shopCryptoCase.updateMany({where:{id,status:'REFUND_AUTHORIZED',refundHash:null},data:{status:'REFUNDED',refundHash:hash,reviewedBy:actor}});
  if(claim.count!==1)throw new Error('Refund already recorded');
  await appendAuditLog(tx,{userId:actor,action:'SHOP_CRYPTO_REFUND_VERIFIED',severity:'CRITICAL',metadata:{caseId:id,invoiceId:i.id,proof}});
  return tx.shopCryptoCase.findUniqueOrThrow({where:{id}});
 });
}
