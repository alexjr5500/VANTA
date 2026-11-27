import { getBlockchainNetwork } from '../config/blockchain-networks.config';
import { expectedInvoiceAtomic, verifySpecialOutgoing, verifyTonSweep } from '../services/shop-treasury-chain.service';
import { tronAddressHex, TRON_USDT_ADDRESS } from '../config/tron-address';
import { ERC20_TRANSFER_EVENT_SIGNATURE } from '../config/blockchain-networks.config';
import { createHash } from 'crypto';
const hash='a'.repeat(64), blockHash='0x'+'f'.repeat(64);
const timestamp=Math.floor(Date.now()/1000)-20;
const dispatchStartedAt=new Date((timestamp-5)*1000);
const invoice={createdAt:new Date((timestamp-50)*1000),quoteUpdatedAt:new Date((timestamp-51)*1000),quotePrice8:'250000000000',startBlock:1};
const evmSource='0x'+'b'.repeat(40), evmDestination='0x'+'c'.repeat(40);
const amount='400000000000000';
const eth={network:'eth-erc20',source:evmSource,destination:evmDestination,amountAtomic:amount,transactionHash:'0x'+hash,dispatchStartedAt,invoice} as any;
const ethereum=getBlockchainNetwork('eth-erc20')!;
function ethRpc(patch:Record<string,unknown>={}) {
  return jest.fn(async (_chain,method,params)=>{
    if(method==='eth_chainId')return '0x1';
    if(method==='eth_getTransactionByHash')return {hash:eth.transactionHash,to:evmDestination,from:evmSource,input:'0x',value:'0x'+BigInt(amount).toString(16),blockNumber:'0x10',blockHash,...patch};
    if(method==='eth_getTransactionReceipt')return {transactionHash:eth.transactionHash,to:evmDestination,status:'0x1',blockNumber:'0x10',blockHash,gasUsed:'0x5208',effectiveGasPrice:'0x2'};
    if(method==='eth_getBlockByNumber')return params[0]==='finalized'?{number:'0x20'}:{number:'0x10',hash:blockHash,timestamp:'0x'+timestamp.toString(16)};
    throw new Error('Unexpected ETH RPC');
  });
}
function tronAddress(hex:string){
 const payload=Buffer.from(hex,'hex'), sha=(b:Buffer)=>createHash('sha256').update(b).digest();
 let n=BigInt('0x'+Buffer.concat([payload,sha(sha(payload)).subarray(0,4)]).toString('hex')), result='';
 const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
 while(n>BigInt(0)){result=alphabet[Number(n%BigInt(58))]+result;n/=BigInt(58);}return result;
}
const ts='41'+'b'.repeat(40),td='41'+'c'.repeat(40),contract=tronAddressHex(TRON_USDT_ADDRESS)!;
const tron={network:'usdt-trc20',source:tronAddress(ts),destination:tronAddress(td),amountAtomic:'1000000',transactionHash:hash,dispatchStartedAt,invoice} as any;
const pad=(a:string)=>a.slice(2).padStart(64,'0'), atomic=BigInt(tron.amountAtomic).toString(16).padStart(64,'0');
function tronRpc(sender=ts){
 return jest.fn(async(path:string)=>{
  if(path==='/walletsolidity/gettransactionbyid')return {txID:hash,ret:[{contractRet:'SUCCESS'}],raw_data:{contract:[{type:'TriggerSmartContract',parameter:{value:{contract_address:contract,owner_address:sender,data:'a9059cbb'+pad(td)+atomic}}}]}};
  if(path==='/walletsolidity/gettransactioninfobyid')return {id:hash,blockNumber:16,blockTimeStamp:timestamp*1000,fee:1000,receipt:{result:'SUCCESS',energy_fee:500,net_fee:500},log:[{address:contract.slice(2),topics:[ERC20_TRANSFER_EVENT_SIGNATURE.slice(2),pad(sender),pad(td)],data:atomic}]};
  if(path==='/walletsolidity/getblockbynum')return {blockID:'f'.repeat(64),block_header:{raw_data:{number:16,timestamp:timestamp*1000}},transactions:[{txID:hash}]};
  throw new Error('Unexpected TRON RPC');
 });
}
const tonSource='0:'+'b'.repeat(64),tonDestination='0:'+'c'.repeat(64),msgHash='d'.repeat(64),destHash='e'.repeat(64);
const ton={network:'gram-ton',source:tonSource,destination:tonDestination,amountAtomic:'1000000000',transactionHash:hash,dispatchStartedAt,invoice} as any;
const common={emulated:false,now:timestamp,mc_block_seqno:16,block_ref:{workchain:0},orig_status:'active',end_status:'active'};
const description={aborted:false,destroyed:false,compute_ph:{success:true,exit_code:0}};
const message={hash:msgHash,source:tonSource,destination:tonDestination,bounced:false,value:ton.amountAtomic,fwd_fee:'200',ihr_disabled:true};
const sourceTx={...common,hash,account:tonSource,description,out_msgs:[message],total_fees:'100'};
const destTx={...common,hash:destHash,account:tonDestination,description:{...description,credit_ph:{credit:ton.amountAtomic}},in_msg:message,out_msgs:[],total_fees:'300',account_state_before:{balance:'1000'},account_state_after:{balance:'1000000700'}};
function tonRpc(dest:Record<string,unknown>=destTx,src:Record<string,unknown>=sourceTx){
 return jest.fn(async(path:string)=>{
 if(path==='/api/v3/masterchainInfo')return {last:{global_id:-239,workchain:-1,seqno:20,root_hash:hash}};
 if(path==='/api/v3/transactions')return {transactions:[src]};
 if(path==='/api/v3/transactionsByMessage')return {transactions:[dest]};
 throw new Error('Unexpected TON API');
 });
}
describe('Controlled native and non-EVM outgoing settlement proofs',()=>{
 test('recalculates native invoice price from original quote, not current market',()=>{
  expect(expectedInvoiceAtomic(invoice as any,1,ethereum)).toBe(amount);
  expect(()=>expectedInvoiceAtomic({...invoice,quoteUpdatedAt:null} as any,1,ethereum)).toThrow();
 });
 test('native ETH exact finalized source transfer and actual gas fee',async()=>{
  await expect(verifySpecialOutgoing(eth,ethereum,ethRpc())).resolves.toBe(BigInt(42000));
  await expect(verifySpecialOutgoing(eth,ethereum,ethRpc({from:evmDestination}))).rejects.toThrow();
  await expect(verifySpecialOutgoing(eth,ethereum,ethRpc({value:'0x1'}))).rejects.toThrow();
 });
 test('TRON exact official USDT transfer from authorized source and fee',async()=>{
  const chain=getBlockchainNetwork('usdt-trc20')!;
  await expect(verifySpecialOutgoing(tron,chain,ethRpc(),tronRpc())).resolves.toBe(BigInt(1000));
  await expect(verifySpecialOutgoing(tron,chain,ethRpc(),tronRpc('41'+'e'.repeat(40)))).rejects.toThrow();
 });
 test('TON proves destination delivery, exact gross credit, net balance and fee',async()=>{
  await expect(verifyTonSweep(ton,tonRpc())).resolves.toBe(BigInt(600));
  await expect(verifyTonSweep(ton,tonRpc({...destTx,in_msg:{...message,hash:'f'.repeat(64)}}))).rejects.toThrow();
  await expect(verifyTonSweep(ton,tonRpc({...destTx,account_state_after:{balance:'1000'}}))).rejects.toThrow();
  await expect(verifyTonSweep(ton,tonRpc(destTx,{...sourceTx,out_msgs:[message,message]}))).rejects.toThrow();
 });
});
