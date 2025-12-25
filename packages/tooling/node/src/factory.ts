import type { SuiClient } from "@mysten/sui/client"

import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import { getSuiDynamicFieldObject } from "@sui-oracle-market/tooling-core/dynamic-fields"
import {
  getAllOwnedObjectsByFilter,
  getObjectSafe,
  getSuiObject
} from "@sui-oracle-market/tooling-core/object"
import { getSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { ensureFoundedAddress, withTestnetFaucetRetry } from "./address.ts"
import type { SuiNetworkConfig, SuiResolvedConfig } from "./config.ts"
import { loadKeypair } from "./keypair.ts"
import { publishPackage, publishPackageWithLog } from "./publish.ts"
import { executeTransactionOnce, signAndExecute } from "./transactions.ts"

export type ToolingContext = {
  suiClient: SuiClient
  suiConfig: SuiResolvedConfig
}

type WithTestnetFaucetRetryArgs = Parameters<typeof withTestnetFaucetRetry>[0]

export type Tooling = ToolingContext & {
  loadedEd25519KeyPair: Ed25519Keypair
  network: SuiNetworkConfig
  getSuiObject: (
    args: Parameters<typeof getSuiObject>[0]
  ) => ReturnType<typeof getSuiObject>
  getObjectSafe: (
    args: Parameters<typeof getObjectSafe>[0]
  ) => ReturnType<typeof getObjectSafe>
  getSuiSharedObject: (
    args: Parameters<typeof getSuiSharedObject>[0]
  ) => ReturnType<typeof getSuiSharedObject>
  getSuiDynamicFieldObject: (
    args: Parameters<typeof getSuiDynamicFieldObject>[0]
  ) => ReturnType<typeof getSuiDynamicFieldObject>
  getAllOwnedObjectsByFilter: (
    args: Parameters<typeof getAllOwnedObjectsByFilter>[0]
  ) => ReturnType<typeof getAllOwnedObjectsByFilter>
  signAndExecute: (
    args: Parameters<typeof signAndExecute>[0]
  ) => ReturnType<typeof signAndExecute>
  executeTransactionOnce: (
    args: Parameters<typeof executeTransactionOnce>[0]
  ) => ReturnType<typeof executeTransactionOnce>
  ensureFoundedAddress: (
    args: Parameters<typeof ensureFoundedAddress>[0]
  ) => ReturnType<typeof ensureFoundedAddress>
  withTestnetFaucetRetry: <T>(
    args: WithTestnetFaucetRetryArgs,
    transactionRun: () => Promise<T>
  ) => Promise<T>
  publishPackageWithLog: (
    args: Parameters<typeof publishPackageWithLog>[0]
  ) => ReturnType<typeof publishPackageWithLog>
  publishPackage: (
    publishPlan: Parameters<typeof publishPackage>[0]
  ) => ReturnType<typeof publishPackage>
}

type SanitizedAccount = {
  accountIndex?: number
  accountAddress?: string
  keystorePath?: string
}

type SanitizedNetwork = {
  networkName?: string
  url?: string
  faucetUrl?: string
  gasBudget?: number
  move?: SuiNetworkConfig["move"]
  account?: SanitizedAccount
  accounts?: Record<string, SanitizedAccount>
}

type SanitizedTooling = {
  network?: SanitizedNetwork
  suiConfig?: {
    currentNetwork?: SuiResolvedConfig["currentNetwork"]
    defaultNetwork?: SuiResolvedConfig["defaultNetwork"]
    paths?: SuiResolvedConfig["paths"]
    network?: SanitizedNetwork
    networks?: Record<string, SanitizedNetwork>
  }
  hasSuiClient: boolean
  hasKeypair: boolean
}

const sanitizeAccount = (
  account: SuiNetworkConfig["account"]
): SanitizedAccount => ({
  accountIndex: account.accountIndex,
  accountAddress: account.accountAddress,
  keystorePath: account.keystorePath
})

const sanitizeNetwork = (
  network: SuiNetworkConfig | undefined
): SanitizedNetwork | undefined => {
  if (!network) return undefined

  return {
    networkName: network.networkName,
    url: network.url,
    faucetUrl: network.faucetUrl,
    gasBudget: network.gasBudget,
    move: network.move,
    account: sanitizeAccount(network.account),
    accounts: network.accounts
      ? Object.fromEntries(
          Object.entries(network.accounts).map(([name, account]) => [
            name,
            sanitizeAccount(account)
          ])
        )
      : undefined
  }
}

const sanitizeNetworks = (
  networks: SuiResolvedConfig["networks"]
): Record<string, SanitizedNetwork> =>
  Object.fromEntries(
    Object.entries(networks).flatMap(([name, network]) =>
      network ? [[name, sanitizeNetwork(network) ?? {}]] : []
    )
  )

/**
 * Creates a tooling façade that binds Sui client + config to helper methods.
 * This gives EVM-style scripts a single entrypoint similar to a Hardhat Runtime Environment.
 */
export const createTooling = async ({
  suiClient,
  suiConfig
}: ToolingContext): Promise<Tooling> => {
  const loadedEd25519KeyPair = await loadKeypair(suiConfig.network.account)
  const tooling: Tooling = {
    suiClient,
    suiConfig,
    loadedEd25519KeyPair,
    network: suiConfig.network,
    getSuiObject: async (args) => getSuiObject(args, { suiClient }),
    getObjectSafe: async (args) => getObjectSafe(args, { suiClient }),
    getSuiSharedObject: async (args) => getSuiSharedObject(args, { suiClient }),
    getSuiDynamicFieldObject: async (args) =>
      getSuiDynamicFieldObject(args, { suiClient }),
    getAllOwnedObjectsByFilter: async (args) =>
      getAllOwnedObjectsByFilter(args, { suiClient }),
    signAndExecute: async (args) =>
      signAndExecute(args, { suiClient, suiConfig }),
    executeTransactionOnce: async (args) =>
      executeTransactionOnce(args, { suiClient, suiConfig }),
    ensureFoundedAddress: async (args) =>
      ensureFoundedAddress(args, { suiClient, suiConfig }),
    withTestnetFaucetRetry: async (args, transactionRun) =>
      withTestnetFaucetRetry(args, transactionRun, { suiClient, suiConfig }),
    publishPackageWithLog: async (args) =>
      publishPackageWithLog(args, { suiClient, suiConfig }),
    publishPackage: async (publishPlan) =>
      publishPackage(publishPlan, { suiClient, suiConfig })
  }

  return Object.assign(tooling, {
    toJSON: (): SanitizedTooling => ({
      network: sanitizeNetwork(suiConfig.network),
      suiConfig: {
        currentNetwork: suiConfig.currentNetwork,
        defaultNetwork: suiConfig.defaultNetwork,
        paths: suiConfig.paths,
        network: sanitizeNetwork(suiConfig.network),
        networks: sanitizeNetworks(suiConfig.networks)
      },
      hasSuiClient: Boolean(suiClient),
      hasKeypair: Boolean(loadedEd25519KeyPair)
    })
  })
}
