import { getFullnodeUrl } from '@mysten/sui.js/client';
import type { NetworkName } from './types';

export function resolveRpcUrl(network: NetworkName, override?: string) {
  if (override) return override;
  switch (network) {
    case 'localnet':
    case 'devnet':
    case 'testnet':
    case 'mainnet':
      return getFullnodeUrl(network);
    case 'custom':
      throw new Error('Provide --rpc-url when using network=custom.');
    default:
      throw new Error(`Unsupported network ${network as string}`);
  }
}

export function buildExplorerUrl(digest: string, network: NetworkName) {
  const explorerNetwork = network === 'mainnet' ? '' : `?network=${network}`;
  return `https://explorer.sui.io/txblock/${digest}${explorerNetwork}`;
}
