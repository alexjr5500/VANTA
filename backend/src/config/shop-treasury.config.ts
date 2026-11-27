import { getBlockchainNetwork } from './blockchain-networks.config';
import { shopCryptoAddresses } from './shop-crypto.config';
import { tronAddressHex, TRON_USDT_ADDRESS } from './tron-address';
import { tonRawAddress } from './ton-address';

export const TREASURY_NETWORKS = ['usdt-bep20', 'usdc-base', 'usdt-erc20', 'eth-erc20', 'usdt-trc20', 'gram-ton'] as const;
const keys: Record<string, string> = {
  'usdt-bep20': 'VANTA_TREASURY_BSC_ADDRESS', 'usdc-base': 'VANTA_TREASURY_BASE_ADDRESS',
  'usdt-erc20': 'VANTA_TREASURY_ETHEREUM_ADDRESS', 'eth-erc20': 'VANTA_TREASURY_ETHEREUM_ADDRESS',
  'usdt-trc20': 'VANTA_TREASURY_TRON_ADDRESS', 'gram-ton': 'VANTA_TREASURY_TON_ADDRESS',
};
export function treasuryAddress(network: string): string | null {
  const chain = getBlockchainNetwork(network);
  if (!chain || !TREASURY_NETWORKS.some(n => n === network)) return null;
  const value = (process.env[keys[network]] || '').trim();
  let normalized: string | null;
  if (chain.ton) normalized = tonRawAddress(value);
  else if (chain.tron) normalized = tronAddressHex(value) && value !== TRON_USDT_ADDRESS && tronAddressHex(value) !== '41' + '0'.repeat(40) ? value : null;
  else normalized = /^0x[0-9a-fA-F]{40}$/.test(value) && value.toLowerCase() !== '0x' + '0'.repeat(40) && value.toLowerCase() !== chain.tokenContract.toLowerCase() ? value.toLowerCase() : null;
  if (!normalized || normalized === '0:' + '0'.repeat(64) || shopCryptoAddresses(network).includes(normalized)) return null;
  return normalized;
}
export function treasuryInstructionsEnabled(): boolean {
  return process.env.VANTA_TREASURY_INSTRUCTIONS_ENABLED === 'true';
}
