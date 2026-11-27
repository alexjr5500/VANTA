import { readFileSync } from 'fs';
import { createReadOnlyClient, FireblocksEnvironment, verifyMainnetVault, VaultMapping } from '../src/services/fireblocks-readonly.service';
const networks=['usdt-bep20','usdc-base','usdt-erc20','eth-erc20','usdt-trc20','gram-ton'];
async function main() {
  const environment=(process.env.FIREBLOCKS_PREFLIGHT_ENV||'sandbox') as FireblocksEnvironment;
  const apiKey=process.env.FIREBLOCKS_PREFLIGHT_API_KEY;
  const keyPath=process.env.FIREBLOCKS_PREFLIGHT_KEY_FILE;
  if(!apiKey||!keyPath)throw new Error('Provide a read-only API user and local API authentication key file');
  const client=createReadOnlyClient(environment,apiKey,readFileSync(keyPath,'utf8'));
  if(environment==='sandbox'){
    const vaults=await client.listVaults();
    if(!Array.isArray(vaults.accounts))throw new Error('Unexpected sandbox vault response');
    console.log(JSON.stringify({environment,connectedReadOnly:true,vaultsOnFirstPage:vaults.accounts.length,productionActivation:false},null,2));
    return;
  }
  const manifestPath=process.env.FIREBLOCKS_PREFLIGHT_MAPPING_FILE;
  if(!manifestPath)throw new Error('Mainnet read-only review requires explicit public vault mapping file');
  const mapping=JSON.parse(readFileSync(manifestPath,'utf8')) as VaultMapping[];
  if(!Array.isArray(mapping)||mapping.length!==6||networks.some(n=>mapping.filter(m=>m.network===n).length!==1))throw new Error('Map all six VANTA rails exactly once');
  const results=[];
  for(const m of mapping)results.push(await verifyMainnetVault(client,m));
  console.log(JSON.stringify({environment,connectedReadOnly:true,results,productionActivation:false},null,2));
}
main().catch(e=>{console.error('Preflight failed: '+(e instanceof Error && /^(Invalid |Unknown |Expected |Fireblocks read-only|Provide |Mainnet |Map all|Sandbox |Unexpected |RSA |Asset |Provider )/.test(e.message)?e.message:'Check local credential, manifest and provider configuration'));process.exitCode=1;});
