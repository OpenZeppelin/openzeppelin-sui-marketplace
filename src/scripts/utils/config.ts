import { existsSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { DEFAULT_KEYSTORE_PATH } from "./constants.ts"
import { resolveRpcUrl } from "./network.ts"
import type { DeepPartial } from "./type-utils.ts"
import type { NetworkName } from "./types.ts"
import { mergeDeepObjects } from "./utility.ts"

export type SuiAccountConfig = {
  keystorePath?: string
  accountIndex?: number
  accountAddress?: string
  accountPrivateKey?: string
  accountMnemonic?: string
}

export type SuiMoveConfig = {
  withUnpublishedDependencies?: boolean
}

export type SuiNetworkConfig = {
  networkName: string
  url: string
  faucetUrl?: string
  account: SuiAccountConfig
  accounts?: Record<string, SuiAccountConfig>
  gasBudget?: number
  move?: SuiMoveConfig
}

export type SuiPathsUserConfig = {
  move?: string
  deployments?: string
  objects?: string
  artifacts?: string
}

export type SuiUserConfig = {
  defaultNetwork?: NetworkName | string
  networks?: Partial<Record<NetworkName | string, SuiNetworkConfig>>
  paths?: SuiPathsUserConfig
}

export type SuiResolvedConfig = {
  defaultNetwork?: NetworkName | string
  currentNetwork: NetworkName | string
  networks: Partial<Record<NetworkName | string, SuiNetworkConfig>>
  paths: Required<SuiPathsUserConfig>
  network: SuiNetworkConfig
}

const DEFAULT_CONFIG_FILENAMES = [
  "sui.config.ts",
  "sui.config.ts",
  "sui.config.cjs",
  "sui.config.mjs"
]

const resolvePaths = (
  pathsConfig?: SuiPathsUserConfig
): Required<SuiPathsUserConfig> => ({
  move: path.resolve(process.cwd(), pathsConfig?.move ?? "move"),
  deployments: path.resolve(
    process.cwd(),
    pathsConfig?.deployments ?? "deployments"
  ),
  objects: path.resolve(process.cwd(), pathsConfig?.objects ?? "deployments"),
  artifacts: path.resolve(
    process.cwd(),
    pathsConfig?.artifacts ?? "deployments"
  )
})

const withDefault = (
  networkName: string,
  networkConfig?: Partial<SuiNetworkConfig>
): SuiNetworkConfig =>
  mergeDeepObjects(
    {
      url: resolveRpcUrl(networkName),
      networkName,
      account: {
        keystorePath: process.env.SUI_KEYSTORE_PATH || DEFAULT_KEYSTORE_PATH,
        accountIndex: Number(process.env.SUI_ACCOUNT_INDEX ?? 0),
        accountAddress: process.env.SUI_ACCOUNT_ADDRESS,
        accountPrivateKey: process.env.SUI_ACCOUNT_PRIVATE_KEY,
        accountMnemonic: process.env.SUI_ACCOUNT_MNEMONIC
      }
    },
    networkConfig || {}
  )

const resolveConfig = (userConfig: SuiUserConfig): SuiResolvedConfig => {
  const currentNetwork =
    userConfig.defaultNetwork ??
    (process.env.SUI_NETWORK as NetworkName | undefined) ??
    "localnet"

  return {
    currentNetwork,
    defaultNetwork: userConfig.defaultNetwork,
    networks: userConfig.networks || {},
    paths: resolvePaths(userConfig.paths),
    network: withDefault(currentNetwork, userConfig?.networks?.[currentNetwork])
  }
}

const findConfigPath = () =>
  DEFAULT_CONFIG_FILENAMES.map((filename) =>
    path.join(process.cwd(), filename)
  ).find((candidate) => existsSync(candidate))

export const defineSuiConfig = (
  config: DeepPartial<SuiUserConfig>
): DeepPartial<SuiUserConfig> => config

/**
 * Loads `sui.config.*`, merges env overrides, and returns a resolved config with defaults.
 * Why: Sui tooling expects network/account paths similar to Hardhat’s config, but here we
 * produce a fully resolved object so scripts can run non-interactively across networks.
 */
export const loadSuiConfig = async (): Promise<SuiResolvedConfig> => {
  const configPath = findConfigPath()
  if (!configPath) {
    return resolveConfig({})
  }

  try {
    const importedModule = await import(pathToFileURL(configPath).href)
    const config = (importedModule.default ??
      importedModule.config ??
      {}) as SuiUserConfig

    return resolveConfig(config)
  } catch (error) {
    throw new Error(
      `Failed to load Sui config from ${configPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

export const getNetworkConfig = (
  networkName: string,
  config: SuiResolvedConfig
): SuiNetworkConfig =>
  withDefault(
    networkName,
    config.networks[networkName || config.currentNetwork]
  )

export const getAccountConfig = (
  networkConfig: SuiNetworkConfig,
  accountName?: string
): SuiAccountConfig =>
  accountName
    ? networkConfig.accounts?.[accountName] || networkConfig.account
    : networkConfig.account
