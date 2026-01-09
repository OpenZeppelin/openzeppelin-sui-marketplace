export const FAUCET_SUPPORTED_NETWORKS = [
  "localnet",
  "devnet",
  "testnet"
] as const

export type FaucetNetworkName = (typeof FAUCET_SUPPORTED_NETWORKS)[number]

/**
 * Type guard for networks that expose the Sui faucet.
 */
export const isFaucetSupportedNetwork = (
  networkName: string
): networkName is FaucetNetworkName =>
  (FAUCET_SUPPORTED_NETWORKS as readonly string[]).includes(networkName)

/**
 * Narrows a network name to the faucet-supported subset.
 */
export const asFaucetNetwork = (
  networkName: string
): FaucetNetworkName | undefined =>
  isFaucetSupportedNetwork(networkName) ? networkName : undefined
