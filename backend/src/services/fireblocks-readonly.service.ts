import { createHash, createPrivateKey, randomUUID, sign } from 'crypto';
import { getBlockchainNetwork } from '../config/blockchain-networks.config';
import { normalizeTronHex } from '../config/tron-address';
import { tonRawAddress } from '../config/ton-address';

export type FireblocksEnvironment = 'sandbox' | 'mainnet-us' | 'mainnet-eu';
const origins: Record<FireblocksEnvironment,string> = {
  sandbox:'https://sandbox-api.fireblocks.io',
  'mainnet-us':'https://api.fireblocks.io',
  'mainnet-eu':'https://eu-api.fireblocks.io',
};
const segment = (s: unknown): string => {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(s)) throw new Error('Invalid provider identifier');
  return s;
};
export function createReadOnlyClient(environment: FireblocksEnvironment, apiKey: string, pem: string, request: typeof fetch = fetch) {
  const origin = Object.prototype.hasOwnProperty.call(origins,environment) ? origins[environment] : null;
  if (!origin || !apiKey.trim()) throw new Error('Invalid Fireblocks configuration');
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength || 0) < 2048) throw new Error('RSA API authentication key required');
  async function get(path: string) {
    // Intentionally no generic request API, transaction creation or write methods.
    if (!/^\/v1\/(assets\/[A-Za-z0-9_-]+|vault\/accounts\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/addresses_paginated|vault\/accounts_paged|blockchains\/[A-Za-z0-9_-]+)$/.test(path)) throw new Error('Read-only endpoint not allowed');
    const iat=Math.floor(Date.now()/1000);
    const header=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
    const payload=Buffer.from(JSON.stringify({uri:path,nonce:randomUUID(),iat,exp:iat+25,sub:apiKey,bodyHash:createHash('sha256').update('').digest('hex')})).toString('base64url');
    const data=header+'.'+payload;
    const token=data+'.'+sign('RSA-SHA256',Buffer.from(data),key).toString('base64url');
    const response=await request(origin+path,{method:'GET',redirect:'error',signal:AbortSignal.timeout(12000),headers:{'X-API-Key':apiKey,Authorization:'Bearer '+token,Accept:'application/json'}});
    if(!response.ok) throw new Error('Fireblocks read-only request failed (HTTP '+response.status+')');
    const value=await response.json();
    if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Unexpected provider response');
    return value as Record<string,any>;
  }
  return {
    environment,
    listVaults:()=>get('/v1/vault/accounts_paged'),
    getAsset:(id:string)=>get('/v1/assets/'+segment(id)),
    getBlockchain:(id:string)=>get('/v1/blockchains/'+segment(id)),
    getAddresses:(vault:string,asset:string)=>get('/v1/vault/accounts/'+segment(vault)+'/'+segment(asset)+'/addresses_paginated'),
  };
}
export type ReadOnlyClient=ReturnType<typeof createReadOnlyClient>;
export type VaultMapping={network:string;assetId:string;blockchainId:string;vaultId:string;expectedAddress:string};
function normalize(network:string,v:unknown):string|null {
  if(network==='gram-ton') return tonRawAddress(v);
  if(network==='usdt-trc20') return normalizeTronHex(v);
  return typeof v==='string' && /^0x[0-9a-f]{40}$/i.test(v)?v.toLowerCase():null;
}
export async function verifyMainnetVault(client:ReadOnlyClient,mapping:VaultMapping) {
  if(client.environment==='sandbox') throw new Error('Sandbox addresses cannot be used for mainnet treasury');
  const chain=getBlockchainNetwork(mapping.network);
  if(!chain)throw new Error('Unknown VANTA payment network');
  const address=normalize(mapping.network,mapping.expectedAddress);
  if(!address || /^0x0{40}$|^410{40}$|^0:0{64}$/.test(address))throw new Error('Invalid treasury address');
  const asset=await client.getAsset(mapping.assetId);
  if(asset.legacyId!==mapping.assetId && asset.id!==mapping.assetId)throw new Error('Asset ID mismatch');
  if(asset.blockchainId!==mapping.blockchainId || asset.metadata?.deprecated!==false || asset.onchain?.decimals!==chain.tokenDecimals)throw new Error('Asset network or decimals mismatch');
  const native=!!(chain.native||chain.ton);
  if(native?asset.assetClass!=='NATIVE':asset.assetClass!=='FT'||normalize(mapping.network,asset.onchain?.address)!==normalize(mapping.network,chain.tokenContract))throw new Error('Asset contract or class mismatch');
  const blockchain=await client.getBlockchain(mapping.blockchainId);
  if(blockchain.id!==mapping.blockchainId)throw new Error('Provider blockchain ID mismatch');
  // Chain identity metadata varies by protocol/provider version. Require an
  // exact chain ID when returned, never infer it from a display symbol.
  const chainId=blockchain.chainId ?? blockchain.onchain?.chainId;
  if(chainId!==undefined && String(chainId)!==String(chain.chainId))throw new Error('Provider chain ID mismatch');
  const response=await client.getAddresses(mapping.vaultId,mapping.assetId);
  if(!Array.isArray(response.addresses))throw new Error('Invalid vault address response');
  const matching=response.addresses.filter((a:any)=>normalize(mapping.network,a.address)===address && !a.tag);
  if(matching.length!==1)throw new Error('Expected treasury address not found in vault page');
  return {network:mapping.network,assetId:mapping.assetId,blockchainId:mapping.blockchainId,vaultId:mapping.vaultId,address:mapping.expectedAddress,readOnlyMatch:true,chainIdReported:chainId!==undefined,requiresIndependentChainAndOwnershipReview:true};
}
