// ============================================================================
// VANTA BLOCKCHAIN NETWORKS — SERVER-SIDE CHAIN/TOKEN/RPC CATALOG
// ============================================================================
// Authoritative network definitions for the supported crypto payment rails.
//
//   usdt-bep20  -> Tether USD (USDT) on BNB Smart Chain (BEP-20), chainId 56
//   usdc-base   -> USD Coin (USDC)  on Base mainnet,            chainId 8453
//
// The token contract and decimals below are FIXED (the token contract is the
// on-chain identity of the asset) and can never be influenced by a client.
// RPC endpoints are configurable server-side via env for operator flexibility:
//
//   VANTA_BSC_RPC_URL   (default: public BSC dataseed)
//   VANTA_BASE_RPC_URL  (default: public Base RPC)
// ============================================================================

export type BlockchainNetworkId = 'usdt-bep20' | 'usdc-base';

export interface BlockchainNetworkConfig {
  id: BlockchainNetworkId;
  chainName: string;
  chainId: number;
  tokenName: string;
  /** ERC-20/BEP-20 token contract address (lowercase). The on-chain identity of the asset. */
  tokenContract: string;
  /** Number of decimals the token contract uses for its balances/transfers. */
  tokenDecimals: number;
  /** JSON-RPC endpoint for the chain (resolved from env per network). */
  rpcUrl: string;
}

/** Keccak-256("Transfer(address,address,uint256)") — the ERC-20 Transfer event signature. */
export const ERC20_TRANSFER_EVENT_SIGNATURE = '0xddf252ad1be2c89b69c2b608fc26bd2742204fa22e51d0b52488e1c4bccf45d9b';

export function resolveNetworkRpcUrl(networkId: BlockchainNetworkId): string {
  const envName = networkId === 'usdt-bep20' ? 'VANTA_BSC_RPC_URL' : 'VANTA_BASE_RPC_URL';
  const configured = (process.env[envName] || '').trim();
  if (configured) return configured;
  return networkId === 'usdt-bep20' ? 'https://bsc-dataseed1.binance.org' : 'https://mainnet.base.org';
}

export const BLOCKCHAIN_NETWORKS: Readonly<Record<BlockchainNetworkId, BlockchainNetworkConfig>> = Object.freeze({
  'usdt-bep20': Object.freeze({
    id: 'usdt-bep20',
    chainName: 'BNB Smart Chain (BEP-20)',
    chainId: 56,
    tokenName: 'USDT',
    tokenContract: '0x55d398326f99059ff775485246999027b3197955', // Tether USD (BSC-USD), 18 decimals
    tokenDecimals: 18,
    rpcUrl: resolveNetworkRpcUrl('usdt-bep20'),
  }),
  'usdc-base': Object.freeze({
    id: 'usdc-base',
    chainName: 'Base',
    chainId: 8453,
    tokenName: 'USDC',
    tokenContract: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USD Coin on Base, 6 decimals
    tokenDecimals: 6,
    rpcUrl: resolveNetworkRpcUrl('usdc-base'),
  }),
});

export function getBlockchainNetwork(id: unknown): BlockchainNetworkConfig | null {
  if (typeof id !== 'string') return null;
  const network = BLOCKCHAIN_NETWORKS[id as BlockchainNetworkId];
  return network || null;
}

/** Minimum on-chain confirmations before a payment may be accepted. */
export function getMinBlockchainConfirmations(): number {
  const raw = (process.env.VANTA_BLOCKCHAIN_MIN_CONFIRMATIONS || '').trim();
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed >= 0) return Math.trunc(parsed);
  return 1;
}

/** Maximum USD tolerance between the order amount and the verified on-chain amount. */
export function getBlockchainAmountToleranceUsd(): number {
  const raw = (process.env.VANTA_BLOCKCHAIN_AMOUNT_TOLERANCE_USD || '').trim();
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 0.005;
}

/** RPC request timeout (ms) before on-chain verification is considered unavailable. */
export function getBlockchainRpcTimeoutMs(): number {
  const raw = (process.env.VANTA_BLOCKCHAIN_RPC_TIMEOUT_MS || '').trim();
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed >= 1000) return Math.trunc(parsed);
  return 8000;
}