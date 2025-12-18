import { getFullnodeUrl } from "@mysten/sui/client"
import type { NetworkName } from "./types.ts"

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

export const resolveRpcUrl = (
  network: NetworkName | string,
  RpcUrlOverride?: string
) => {
  if (RpcUrlOverride) return RpcUrlOverride

  const RpcUrl = resolveCommonRpcUrl(network)

  if (RpcUrl) return RpcUrl

  throw new Error("Provide an RPC URL for custom networks (via config or env).")
}

/**
 * Builds a human-friendly explorer link for a transaction digest.
 * Useful when surfacing publish results to developers coming from EVM scan-style flows.
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
