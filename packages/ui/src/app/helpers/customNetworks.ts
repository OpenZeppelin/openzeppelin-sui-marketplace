import { ENetwork } from "@sui-oracle-market/tooling-core/types"
import type {
  TCustomNetworkConfig,
  TCustomNetworkDraft,
  TCustomNetworkErrors
} from "../types/TCustomNetwork"

export const CUSTOM_NETWORK_STORAGE_KEY = "sui-oracle-market.custom-networks"

const reservedNetworkKeys = new Set(Object.values(ENetwork))
const networkKeyPattern = /^[a-z0-9-]+$/

const trimValue = (value: string) => value.trim()

const isHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

const isSuiObjectId = (value: string) =>
  /^0x[a-fA-F0-9]+$/.test(value) && value.length >= 3

export const createEmptyCustomNetworkDraft = (): TCustomNetworkDraft => ({
  networkKey: "",
  label: "",
  rpcUrl: "",
  explorerUrl: "",
  contractPackageId: "",
  shopId: ""
})

export const normalizeCustomNetworkDraft = (
  draft: TCustomNetworkDraft
): TCustomNetworkDraft => ({
  networkKey: trimValue(draft.networkKey).toLowerCase(),
  label: trimValue(draft.label),
  rpcUrl: trimValue(draft.rpcUrl),
  explorerUrl: trimValue(draft.explorerUrl),
  contractPackageId: trimValue(draft.contractPackageId),
  shopId: trimValue(draft.shopId)
})

export const validateCustomNetworkDraft = ({
  draft,
  existingKeys = [],
  allowNetworkKey
}: {
  draft: TCustomNetworkDraft
  existingKeys?: string[]
  allowNetworkKey?: string
}):
  | { ok: true; network: TCustomNetworkConfig }
  | { ok: false; errors: TCustomNetworkErrors } => {
  const normalized = normalizeCustomNetworkDraft(draft)
  const errors: TCustomNetworkErrors = {}
  const normalizedAllowKey = allowNetworkKey?.toLowerCase()
  const normalizedExistingKeys = new Set(
    existingKeys.map((key) => key.toLowerCase())
  )

  if (!normalized.networkKey) {
    errors.networkKey = "Network key is required."
  } else if (!networkKeyPattern.test(normalized.networkKey)) {
    errors.networkKey = "Use lowercase letters, numbers, and hyphens only."
  } else if (
    normalizedAllowKey !== normalized.networkKey &&
    normalizedExistingKeys.has(normalized.networkKey)
  ) {
    errors.networkKey = "This network key is already configured."
  } else if (
    normalizedAllowKey !== normalized.networkKey &&
    reservedNetworkKeys.has(normalized.networkKey as ENetwork)
  ) {
    errors.networkKey = "This key is reserved for built-in networks."
  }

  if (!normalized.label) {
    errors.label = "Display label is required."
  }

  if (!normalized.rpcUrl) {
    errors.rpcUrl = "RPC URL is required."
  } else if (!isHttpUrl(normalized.rpcUrl)) {
    errors.rpcUrl = "Provide a valid http or https URL."
  }

  if (!normalized.explorerUrl) {
    errors.explorerUrl = "Explorer URL is required."
  } else if (!isHttpUrl(normalized.explorerUrl)) {
    errors.explorerUrl = "Provide a valid http or https URL."
  }

  if (!normalized.contractPackageId) {
    errors.contractPackageId = "Contract package ID is required."
  } else if (!isSuiObjectId(normalized.contractPackageId)) {
    errors.contractPackageId = "Provide a valid 0x... package ID."
  }

  if (!normalized.shopId) {
    errors.shopId = "Shop ID is required."
  } else if (!isSuiObjectId(normalized.shopId)) {
    errors.shopId = "Provide a valid 0x... shop ID."
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors }
  }

  return { ok: true, network: normalized }
}

export const parseStoredCustomNetworks = (
  value: string | null
): { networks: TCustomNetworkConfig[]; error?: string } => {
  if (!value) return { networks: [] }

  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) {
      return { networks: [], error: "Custom network data is malformed." }
    }

    const networks = parsed
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        networkKey: trimValue(String(entry.networkKey ?? "")).toLowerCase(),
        label: trimValue(String(entry.label ?? "")),
        rpcUrl: trimValue(String(entry.rpcUrl ?? "")),
        explorerUrl: trimValue(String(entry.explorerUrl ?? "")),
        contractPackageId: trimValue(String(entry.contractPackageId ?? "")),
        shopId: trimValue(String(entry.shopId ?? ""))
      }))
      .filter(
        (entry) =>
          entry.networkKey &&
          entry.label &&
          entry.rpcUrl &&
          entry.explorerUrl &&
          entry.contractPackageId &&
          entry.shopId
      )

    return { networks }
  } catch {
    return { networks: [], error: "Custom network data could not be loaded." }
  }
}
