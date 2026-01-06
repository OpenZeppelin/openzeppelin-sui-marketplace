import { getFullnodeUrl } from "@mysten/sui/client"
import type { NetworkName } from "./types.ts"

/**
 * Resolves a default fullnode RPC URL for known Sui networks.
 * Sui exposes canonical RPC endpoints for named networks.
 */
export const resolveCommonRpcUrl = (
  network: NetworkName | string
): string | undefined => {
  switch (network) {
    case "localnet":
    case "devnet":
    case "testnet":
    case "mainnet":
      return getFullnodeUrl(network)
    default:
      return undefined
  }
}

/**
 * Returns an RPC URL for the given network, honoring an override when provided.
 * Throws for custom networks to force explicit configuration.
 */
export const resolveRpcUrl = (
  network: NetworkName | string,
  rpcUrlOverride?: string
) => {
  if (rpcUrlOverride) return rpcUrlOverride

  const rpcUrl = resolveCommonRpcUrl(network)

  if (rpcUrl) return rpcUrl

  throw new Error("Provide an RPC URL for custom networks (via config or env).")
}

/**
 * Builds a human-friendly explorer link for a transaction digest.
 * Useful when surfacing publish results in CLI output.
 */
export const buildExplorerUrl = (digest: string, network: NetworkName) => {
  const explorerNetwork = network === "mainnet" ? "" : `?network=${network}`
  return `https://explorer.sui.io/txblock/${digest}${explorerNetwork}`
}

/**
 * Guards mock-publishing flows to localnet only.
 * Why: dev-only packages (mock Pyth/coins) must not leak to shared networks; this enforces that intent.
 */
export const assertLocalnetNetwork = (networkName: string) => {
  if (networkName !== "localnet")
    throw new Error(
      `setup-local only seeds mock packages on localnet. Provided network "${networkName}" is not supported.`
    )
}
