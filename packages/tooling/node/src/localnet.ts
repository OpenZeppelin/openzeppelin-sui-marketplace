import os from "node:os"
import path from "node:path"

import { getFaucetHost } from "@mysten/sui/faucet"
import { createSuiClient } from "./describe-object.ts"

const FAUCET_SUPPORTED_NETWORKS = ["localnet", "devnet", "testnet"] as const

/**
 * Resolves a localnet config directory path.
 * - Uses `candidate` if provided
 * - Falls back to `SUI_LOCALNET_CONFIG_DIR` or `SUI_CONFIG_DIR`
 * - Expands `~` and `~/...`
 * - Defaults to `~/.sui/localnet`
 */
export const resolveLocalnetConfigDir = (candidate?: string) => {
  const raw =
    candidate?.trim() ||
    process.env.SUI_LOCALNET_CONFIG_DIR ||
    process.env.SUI_CONFIG_DIR

  const expanded =
    raw === "~"
      ? os.homedir()
      : raw?.startsWith("~/")
        ? path.join(os.homedir(), raw.slice(2))
        : raw

  const defaultDir = path.join(os.homedir(), ".sui", "localnet")
  const resolved = expanded && expanded.length ? expanded : defaultDir
  return path.resolve(resolved)
}

/**
 * Type guard for networks that expose the Sui faucet.
 */
export const isFaucetSupportedNetwork = (
  networkName: string
): networkName is "localnet" | "devnet" | "testnet" =>
  (FAUCET_SUPPORTED_NETWORKS as readonly string[]).includes(networkName)

/**
 * Derives a faucet URL that matches the provided localnet RPC host.
 */
export const deriveFaucetUrl = (rpcUrl: string) => {
  try {
    const faucetHost = getFaucetHost("localnet")
    const faucetUrl = new URL(faucetHost)
    const rpcHost = new URL(rpcUrl)
    faucetUrl.hostname = rpcHost.hostname
    faucetUrl.pathname = "/v2/gas"
    return faucetUrl.toString()
  } catch {
    return "http://127.0.0.1:9123/v2/gas"
  }
}

export type RpcSnapshot = {
  rpcUrl: string
  epoch: string
  protocolVersion: string
  latestCheckpoint: string
  validatorCount: number
  referenceGasPrice: bigint
  epochStartTimestampMs?: string | number
}

export type ProbeResult =
  | { status: "running"; snapshot: RpcSnapshot }
  | { status: "offline"; error: string }

export const getRpcSnapshot = async (rpcUrl: string): Promise<RpcSnapshot> => {
  const client = createSuiClient(rpcUrl)

  const [systemState, latestCheckpoint, referenceGasPrice] = await Promise.all([
    client.getLatestSuiSystemState(),
    client.getLatestCheckpointSequenceNumber(),
    client.getReferenceGasPrice()
  ])

  return {
    rpcUrl,
    epoch: systemState.epoch,
    protocolVersion: String(systemState.protocolVersion),
    latestCheckpoint,
    validatorCount: systemState.activeValidators?.length ?? 0,
    referenceGasPrice,
    epochStartTimestampMs: systemState.epochStartTimestampMs ?? undefined
  }
}

export const probeRpcHealth = async (rpcUrl: string): Promise<ProbeResult> => {
  try {
    return { status: "running", snapshot: await getRpcSnapshot(rpcUrl) }
  } catch (error) {
    return {
      status: "offline",
      error:
        error instanceof Error ? error.message : "Unable to reach localnet RPC"
    }
  }
}
