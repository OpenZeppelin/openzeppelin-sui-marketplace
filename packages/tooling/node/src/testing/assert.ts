import type {
  ObjectOwner,
  SuiClient,
  SuiEvent,
  SuiTransactionBlockResponse
} from "@mysten/sui/client"
import { normalizeSuiAddress } from "@mysten/sui/utils"

import {
  assertTransactionSuccess,
  findCreatedObjectIds
} from "@sui-oracle-market/tooling-core/transactions"
import { SUI_COIN_TYPE } from "@sui-oracle-market/tooling-core/constants"
import { formatObjectResponseError } from "./object-response.ts"

export const assertTransactionSucceeded = (
  result: SuiTransactionBlockResponse
) => assertTransactionSuccess(result)

export const assertTransactionFailed = (
  result: SuiTransactionBlockResponse,
  label = "transaction"
) => {
  const status = result.effects?.status?.status
  if (!status)
    throw new Error(`Expected ${label} to fail, but status was missing.`)
  if (status === "success")
    throw new Error(`Expected ${label} to fail, but it succeeded.`)
  return result.effects?.status?.error ?? "Unknown failure"
}

const formatObjectMissingError = (label: string, objectId: string) =>
  `Expected ${label} ${objectId} to exist, but it was not found.`

export const assertObjectOwnerById = async ({
  suiClient,
  objectId,
  expectedOwner,
  label = "object"
}: {
  suiClient: SuiClient
  objectId: string
  expectedOwner: string
  label?: string
}) => {
  const response = await suiClient.getObject({
    id: objectId,
    options: { showOwner: true }
  })

  if (!response.data) {
    const errorMessage = formatObjectResponseError(response.error)
    const fallback = formatObjectMissingError(label, objectId)
    throw new Error(errorMessage ? `${fallback} (${errorMessage})` : fallback)
  }

  assertOwnerAddress(response.data.owner, expectedOwner, `${label} owner`)
  return response.data.owner
}

export const assertEventByDigest = async ({
  suiClient,
  digest,
  eventType,
  predicate,
  label = "event"
}: {
  suiClient: SuiClient
  digest: string
  eventType?: string
  predicate?: (event: SuiEvent) => boolean
  label?: string
}) => {
  const response = await suiClient.queryEvents({
    query: { Transaction: digest }
  })

  const events = response.data ?? []
  const matchingEvent = events.find((event) => {
    if (eventType && event.type !== eventType) return false
    return predicate ? predicate(event) : true
  })

  if (!matchingEvent) {
    const typeLabel = eventType ? ` of type ${eventType}` : ""
    throw new Error(
      `Expected ${label}${typeLabel} for digest ${digest}, but none was found.`
    )
  }

  return matchingEvent
}

const matchFirstCapture = (
  message: string,
  patterns: RegExp[]
): string | undefined => {
  for (const pattern of patterns) {
    const match = message.match(pattern)
    if (match?.[1]) return match[1]
  }
  return undefined
}

const normalizeModuleName = (value: string | undefined) => {
  if (!value) return undefined
  const segments = value.split("::")
  return segments[segments.length - 1] ?? value
}

const parseAbortCode = (value: string | undefined) => {
  if (!value) return undefined
  const trimmed = value.trim()
  const parsed = trimmed.startsWith("0x")
    ? Number.parseInt(trimmed, 16)
    : Number(trimmed)
  return Number.isNaN(parsed) ? undefined : parsed
}

const parseMoveAbortDetails = (message: string) => {
  const moduleMatch = matchFirstCapture(message, [
    /module:\s*"?([^",}\s]+)"?/i,
    /module\s*=\s*"?([^",}\s]+)"?/i
  ])
  const functionMatch = matchFirstCapture(message, [
    /function_name:\s*"?([^",}\s]+)"?/i,
    /function:\s*"?([^",}\s]+)"?/i,
    /function\s*=\s*"?([^",}\s]+)"?/i
  ])
  const abortCodeMatch = matchFirstCapture(message, [
    /abort_code:\s*(0x[0-9a-fA-F]+|\d+)/i,
    /abort\s*code\s*:?\s*(0x[0-9a-fA-F]+|\d+)/i,
    /abort_code\s*=\s*(0x[0-9a-fA-F]+|\d+)/i,
    /MoveAbort[\s\S]*?,\s*(0x[0-9a-fA-F]+|\d+)\s*\)?/i
  ])

  return {
    module: normalizeModuleName(moduleMatch),
    functionName: functionMatch,
    abortCode: parseAbortCode(abortCodeMatch)
  }
}

const ensureMoveAbort = (message: string, label: string) => {
  if (!/moveabort|move abort/i.test(message))
    throw new Error(`Expected ${label} to fail with MoveAbort, got: ${message}`)
}

export const assertMoveAbort = (
  result: SuiTransactionBlockResponse,
  {
    module,
    functionName,
    abortCode,
    label = "transaction"
  }: {
    module?: string
    functionName?: string
    abortCode?: number
    label?: string
  }
) => {
  const errorMessage = assertTransactionFailed(result, label)
  ensureMoveAbort(errorMessage, label)

  const details = parseMoveAbortDetails(errorMessage)

  if (module && details.module !== module) {
    const actual = details.module ?? "unknown"
    throw new Error(
      `Expected ${label} to abort in module ${module}, got ${actual}.`
    )
  }

  if (functionName && details.functionName !== functionName) {
    const actual = details.functionName ?? "unknown"
    throw new Error(
      `Expected ${label} to abort in ${module ?? "module"}::${functionName}, got ${actual}.`
    )
  }

  if (abortCode !== undefined && details.abortCode !== abortCode) {
    const actual =
      details.abortCode !== undefined ? String(details.abortCode) : "unknown"
    throw new Error(
      `Expected ${label} to abort with code ${abortCode}, got ${actual}.`
    )
  }

  return details
}

export const requireCreatedObjectId = (
  result: SuiTransactionBlockResponse,
  typeSuffix: string,
  label = typeSuffix
) => {
  const ids = findCreatedObjectIds(result, typeSuffix)
  const [objectId] = ids
  if (!objectId) {
    throw new Error(`Expected ${label} to be created, but none was found.`)
  }
  return objectId
}

const normalizeOwnerAddress = (owner: ObjectOwner | null | undefined) => {
  if (!owner) return undefined
  // Some Sui response types (e.g. balanceChanges entries) may use a plain
  // address string as the owner at runtime.
  if (typeof owner === "string") return normalizeSuiAddress(owner)
  if ("AddressOwner" in owner) return normalizeSuiAddress(owner.AddressOwner)
  if ("ObjectOwner" in owner) return normalizeSuiAddress(owner.ObjectOwner)
  if ("ConsensusAddressOwner" in owner)
    return normalizeSuiAddress(owner.ConsensusAddressOwner.owner)
  return undefined
}

export const assertOwnerAddress = (
  owner: ObjectOwner | null | undefined,
  expectedAddress: string,
  label = "owner"
) => {
  const normalizedExpected = normalizeSuiAddress(expectedAddress)
  const normalizedActual = normalizeOwnerAddress(owner)

  if (!normalizedActual)
    throw new Error(`Expected ${label} to be an address owner.`)
  if (normalizedActual !== normalizedExpected)
    throw new Error(
      `Expected ${label} to be ${normalizedExpected}, got ${normalizedActual}.`
    )
}

export const assertBalanceChange = (
  result: SuiTransactionBlockResponse,
  {
    owner,
    coinType = SUI_COIN_TYPE,
    delta
  }: {
    owner: string
    coinType?: string
    delta: bigint
  }
) => {
  const normalizedOwner = normalizeSuiAddress(owner)
  const change = (result.balanceChanges ?? []).find(
    (entry) =>
      normalizeOwnerAddress(entry.owner) === normalizedOwner &&
      entry.coinType === coinType
  )

  if (!change)
    throw new Error(
      `Expected a balance change for ${normalizedOwner} ${coinType}.`
    )

  const actual = BigInt(change.amount)
  if (actual !== delta)
    throw new Error(
      `Expected balance delta ${delta.toString()}, got ${actual.toString()}.`
    )
}
