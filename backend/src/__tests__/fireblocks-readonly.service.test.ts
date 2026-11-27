import { generateKeyPairSync, verify, createHash } from 'crypto';
import { createReadOnlyClient, verifyMainnetVault } from '../services/fireblocks-readonly.service';
const keys=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
describe('Fireblocks read-only preflight',()=>{
  test('uses official sandbox origin and a short-lived RS256 JWT bound to GET path',async()=>{
    const request=jest.fn(async(url,init)=>{
      expect(url).toBe('https://sandbox-api.fireblocks.io/v1/vault/accounts_paged');
      expect(init.method).toBe('GET');expect(init.redirect).toBe('error');
      const [h,p,s]=init.headers.Authorization.slice(7).split('.');
      expect(verify('RSA-SHA256',Buffer.from(h+'.'+p),keys.publicKey,Buffer.from(s,'base64url'))).toBe(true);
      const claims=JSON.parse(Buffer.from(p,'base64url').toString());
      expect(claims).toMatchObject({uri:'/v1/vault/accounts_paged',sub:'viewer-example',bodyHash:createHash('sha256').update('').digest('hex')});
      expect(claims.exp-claims.iat).toBe(25);
      return new Response(JSON.stringify({accounts:[]}));
    }) as unknown as typeof fetch;
    const client=createReadOnlyClient('sandbox','viewer-example',keys.privateKey,request);
    await expect(client.listVaults()).resolves.toEqual({accounts:[]});
    expect(()=>client.getAsset('../transactions')).toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });
  test('mainnet address match requires exact asset contract, decimals and vault address',async()=>{
    const address='0x'+'a'.repeat(40);
    const asset={legacyId:'configured_asset',blockchainId:'chain-id',assetClass:'FT',metadata:{deprecated:false},onchain:{decimals:6,address:'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'}};
    const client={environment:'mainnet-us',getAsset:jest.fn(async()=>asset),getBlockchain:jest.fn(async()=>({id:'chain-id',chainId:8453})),getAddresses:jest.fn(async()=>({addresses:[{address}]}))} as any;
    const mapping={network:'usdc-base',assetId:'configured_asset',blockchainId:'chain-id',vaultId:'1',expectedAddress:address};
    await expect(verifyMainnetVault(client,mapping)).resolves.toMatchObject({readOnlyMatch:true,requiresIndependentChainAndOwnershipReview:true});
    await expect(verifyMainnetVault({...client,environment:'sandbox'},mapping)).rejects.toThrow('Sandbox');
    await expect(verifyMainnetVault(client,{...mapping,expectedAddress:'0x'+'b'.repeat(40)})).rejects.toThrow('not found');
    client.getAsset.mockResolvedValue({...asset,onchain:{...asset.onchain,address}});
    await expect(verifyMainnetVault(client,mapping)).rejects.toThrow('contract');
  });
});
