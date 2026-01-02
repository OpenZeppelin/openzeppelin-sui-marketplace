import { ENetwork } from "@sui-oracle-market/tooling-core/types"
import {
  CONTRACT_MODULE_NAME,
  CONTRACT_PACKAGE_ID_NOT_DEFINED,
  DEVNET_CONTRACT_PACKAGE_ID,
  LOCALNET_CONTRACT_PACKAGE_ID,
  MAINNET_CONTRACT_PACKAGE_ID,
  TESTNET_CONTRACT_PACKAGE_ID
} from "~~/config/network"
export {
  getResponseContentField,
  getResponseDisplayField,
  getResponseObjectId
} from "@sui-oracle-market/tooling-core/object-info"
export { fromBytesToString } from "@sui-oracle-market/tooling-core/utils/formatters"

const normalizeExplorerBaseUrl = (baseExplorerUrl: string) =>
  baseExplorerUrl.replace(/\/+$/, "")

export const transactionUrl = (baseExplorerUrl: string, txDigest: string) => {
  return `${normalizeExplorerBaseUrl(baseExplorerUrl)}/txblock/${txDigest}`
}
export const packageUrl = (baseExplorerUrl: string, packageId: string) => {
  // Local explorer doesn't have a package view, so we stick with object view instead.
  const subpath =
    baseExplorerUrl.search("localhost") === -1 ? "package" : "object"

  return `${normalizeExplorerBaseUrl(baseExplorerUrl)}/${subpath}/${packageId}`
}

export const objectUrl = (baseExplorerUrl: string, objectId: string) => {
  return `${normalizeExplorerBaseUrl(baseExplorerUrl)}/object/${objectId}`
}

export const isLocalExplorerUrl = (baseExplorerUrl: string) => {
  try {
    const parsed = new URL(baseExplorerUrl)
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"
  } catch {
    return (
      baseExplorerUrl.includes("localhost") ||
      baseExplorerUrl.includes("127.0.0.1")
    )
  }
}

export const formatNetworkType = (machineName: string) => {
  if (machineName.startsWith("sui:")) {
    return machineName.substring(4)
  }
  return machineName
}

export const resolveWalletNetworkType = (
  chains?: readonly string[]
): string | undefined => {
  const chainId = chains?.[0]
  return chainId ? formatNetworkType(chainId) : undefined
}

export const resolveConfiguredId = (
  value: string | undefined,
  invalidValue: string
): string | undefined => {
  if (!value || value === invalidValue) return undefined
  return value
}

export const supportedNetworks = () => {
  const networkConfig = {
    [ENetwork.LOCALNET]: {
      packageId: LOCALNET_CONTRACT_PACKAGE_ID
    },
    [ENetwork.DEVNET]: {
      packageId: DEVNET_CONTRACT_PACKAGE_ID
    },
    [ENetwork.TESTNET]: {
      packageId: TESTNET_CONTRACT_PACKAGE_ID
    },
    [ENetwork.MAINNET]: {
      packageId: MAINNET_CONTRACT_PACKAGE_ID
    }
  }

  return Object.entries(networkConfig)
    .filter(([, config]) => {
      const packageId = resolveConfiguredId(
        config.packageId,
        CONTRACT_PACKAGE_ID_NOT_DEFINED
      )

      return Boolean(packageId)
    })
    .map(([key]) => key as ENetwork)
}

export const isNetworkSupported = (network: ENetwork | undefined) => {
  return network != null && supportedNetworks().includes(network)
}

export const fullFunctionName = (
  packageId: string,
  functionName: string
): `${string}::${string}::${string}` => {
  return `${fullModuleName(packageId)}::${functionName}`
}

export const fullStructName = (
  packageId: string,
  structName: string
): `${string}::${string}::${string}` => {
  return `${fullModuleName(packageId)}::${structName}`
}

const fullModuleName = (packageId: string): `${string}::${string}` => {
  return `${packageId}::${CONTRACT_MODULE_NAME}`
}
