import type { SuiClient } from "@mysten/sui/client"

import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import {
  getCoinBalanceSummary,
  getCoinBalances
} from "@sui-oracle-market/tooling-core/address"
import { resolveCoinOwnership } from "@sui-oracle-market/tooling-core/coin"
import {
  listCurrencyRegistryEntries,
  resolveCurrencyObjectId
} from "@sui-oracle-market/tooling-core/coin-registry"
import { getSuiDynamicFieldObject } from "@sui-oracle-market/tooling-core/dynamic-fields"
import {
  getAllOwnedObjectsByFilter,
  getObjectSafe,
  getSuiObject
} from "@sui-oracle-market/tooling-core/object"
import { getSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { ensureFoundedAddress, withTestnetFaucetRetry } from "./address.ts"
import type { SuiNetworkConfig, SuiResolvedConfig } from "./config.ts"
import { maybeLogDevInspect } from "./dev-inspect.ts"
import { loadKeypair } from "./keypair.ts"
import { syncLocalnetMoveEnvironmentChainId } from "./move.ts"
import {
  publishMovePackageWithFunding,
  publishPackage,
  publishPackageWithLog
} from "./publish.ts"
import {
  getImmutableSharedObject,
  getMutableSharedObject
} from "./shared-objects.ts"
import { executeTransactionWithSummary } from "./transactions-execution.ts"
import { executeTransactionOnce, signAndExecute } from "./transactions.ts"

export type ToolingContext = {
  suiClient: SuiClient
  suiConfig: SuiResolvedConfig
}

type WithTestnetFaucetRetryArgs = Parameters<typeof withTestnetFaucetRetry>[0]

export type Tooling = ToolingContext & {
  loadedEd25519KeyPair: Ed25519Keypair
  network: SuiNetworkConfig
  toJSON: () => SanitizedTooling
  getSuiObject: (
    args: Parameters<typeof getSuiObject>[0]
  ) => ReturnType<typeof getSuiObject>
  getObjectSafe: (
    args: Parameters<typeof getObjectSafe>[0]
  ) => ReturnType<typeof getObjectSafe>
  getSuiSharedObject: (
    args: Parameters<typeof getSuiSharedObject>[0]
  ) => ReturnType<typeof getSuiSharedObject>
  getImmutableSharedObject: (
    args: Parameters<typeof getImmutableSharedObject>[0]
  ) => ReturnType<typeof getImmutableSharedObject>
  getMutableSharedObject: (
    args: Parameters<typeof getMutableSharedObject>[0]
  ) => ReturnType<typeof getMutableSharedObject>
  getSuiDynamicFieldObject: (
    args: Parameters<typeof getSuiDynamicFieldObject>[0]
  ) => ReturnType<typeof getSuiDynamicFieldObject>
  getAllOwnedObjectsByFilter: (
    args: Parameters<typeof getAllOwnedObjectsByFilter>[0]
  ) => ReturnType<typeof getAllOwnedObjectsByFilter>
  getCoinBalanceSummary: (
    args: Parameters<typeof getCoinBalanceSummary>[0]
  ) => ReturnType<typeof getCoinBalanceSummary>
  getCoinBalances: (
    args: Parameters<typeof getCoinBalances>[0]
  ) => ReturnType<typeof getCoinBalances>
  resolveCoinOwnership: (
    args: Parameters<typeof resolveCoinOwnership>[0]
  ) => ReturnType<typeof resolveCoinOwnership>
  listCurrencyRegistryEntries: (
    args: Parameters<typeof listCurrencyRegistryEntries>[0]
  ) => ReturnType<typeof listCurrencyRegistryEntries>
  resolveCurrencyObjectId: (
    args: Parameters<typeof resolveCurrencyObjectId>[0]
  ) => ReturnType<typeof resolveCurrencyObjectId>
  signAndExecute: (
    args: Parameters<typeof signAndExecute>[0]
  ) => ReturnType<typeof signAndExecute>
  executeTransactionWithSummary: (
    args: Parameters<typeof executeTransactionWithSummary>[0]
  ) => ReturnType<typeof executeTransactionWithSummary>
  executeTransactionOnce: (
    args: Parameters<typeof executeTransactionOnce>[0]
  ) => ReturnType<typeof executeTransactionOnce>
  maybeLogDevInspect: (
    args: Parameters<typeof maybeLogDevInspect>[0]
  ) => ReturnType<typeof maybeLogDevInspect>
  ensureFoundedAddress: (
    args: Parameters<typeof ensureFoundedAddress>[0]
  ) => ReturnType<typeof ensureFoundedAddress>
  withTestnetFaucetRetry: <T>(
    args: WithTestnetFaucetRetryArgs,
    transactionRun: () => Promise<T>
  ) => Promise<T>
  syncLocalnetMoveEnvironmentChainId: (
    args: Parameters<typeof syncLocalnetMoveEnvironmentChainId>[0]
  ) => ReturnType<typeof syncLocalnetMoveEnvironmentChainId>
  publishPackageWithLog: (
    args: Parameters<typeof publishPackageWithLog>[0]
  ) => ReturnType<typeof publishPackageWithLog>
  publishMovePackageWithFunding: (
    args: Parameters<typeof publishMovePackageWithFunding>[0]
  ) => ReturnType<typeof publishMovePackageWithFunding>
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
  move?: SuiNetworkConfig["contracts"]
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
 * Creates a tooling facade that binds Sui client + config to helper methods.
 * Provides a single entrypoint for scripts with shared network and account state.
 */
export const createTooling = async ({
  suiClient,
  suiConfig
}: ToolingContext): Promise<Tooling> => {
  const loadedEd25519KeyPair = await loadKeypair(suiConfig.network.account)
  const toJSON = (): SanitizedTooling => ({
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

  const tooling: Tooling = {
    suiClient,
    suiConfig,
    loadedEd25519KeyPair,
    network: suiConfig.network,
    toJSON,
    getSuiObject: async (args) => getSuiObject(args, { suiClient }),
    getObjectSafe: async (args) => getObjectSafe(args, { suiClient }),
    getSuiSharedObject: async (args) => getSuiSharedObject(args, { suiClient }),
    getImmutableSharedObject: async (args) =>
      getImmutableSharedObject(args, { suiClient, suiConfig }),
    getMutableSharedObject: async (args) =>
      getMutableSharedObject(args, { suiClient, suiConfig }),
    getSuiDynamicFieldObject: async (args) =>
      getSuiDynamicFieldObject(args, { suiClient }),
    getAllOwnedObjectsByFilter: async (args) =>
      getAllOwnedObjectsByFilter(args, { suiClient }),
    resolveCoinOwnership: async (args) =>
      resolveCoinOwnership(args, { suiClient }),
    getCoinBalanceSummary: async (args) =>
      getCoinBalanceSummary(args, { suiClient }),
    getCoinBalances: async (args) => getCoinBalances(args, { suiClient }),
    listCurrencyRegistryEntries: async (args) =>
      listCurrencyRegistryEntries(args, { suiClient }),
    resolveCurrencyObjectId: async (args) =>
      resolveCurrencyObjectId(args, { suiClient }),
    signAndExecute: async (args) =>
      signAndExecute(args, { suiClient, suiConfig }),
    executeTransactionWithSummary: async (args) =>
      executeTransactionWithSummary(args, { suiClient, suiConfig }),
    executeTransactionOnce: async (args) =>
      executeTransactionOnce(args, { suiClient, suiConfig }),
    maybeLogDevInspect: async (args) =>
      maybeLogDevInspect(
        {
          ...args,
          senderAddress:
            args.senderAddress ?? loadedEd25519KeyPair.toSuiAddress()
        },
        { suiClient, suiConfig }
      ),
    ensureFoundedAddress: async (args) =>
      ensureFoundedAddress(args, { suiClient, suiConfig }),
    withTestnetFaucetRetry: async (args, transactionRun) =>
      withTestnetFaucetRetry(args, transactionRun, { suiClient, suiConfig }),
    syncLocalnetMoveEnvironmentChainId: async (args) =>
      syncLocalnetMoveEnvironmentChainId(args, { suiClient, suiConfig }),
    publishPackageWithLog: async (args) =>
      publishPackageWithLog(args, { suiClient, suiConfig }),
    publishMovePackageWithFunding: async (args) =>
      publishMovePackageWithFunding(args, { suiClient, suiConfig }),
    publishPackage: async (publishPlan) =>
      publishPackage(publishPlan, { suiClient, suiConfig })
  }

  return tooling
}
