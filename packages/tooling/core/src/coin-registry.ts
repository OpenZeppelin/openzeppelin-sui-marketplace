import type { SuiObjectResponse } from "@mysten/sui/client"
import { deriveObjectID, normalizeSuiObjectId } from "@mysten/sui/utils"

import { SUI_COIN_REGISTRY_ID } from "./constants.ts"
import type { ToolingCoreContext } from "./context.ts"
import { getAllDynamicFields } from "./dynamic-fields.ts"
import { readMoveString } from "./utils/formatters.ts"
import { formatTypeName, parseTypeNameFromString } from "./utils/type-name.ts"

type DynamicFieldName = {
  value?: {
    pos0?: string
  }
}

const extractClaimedObjectId = (fieldName: DynamicFieldName) => {
  const candidate = fieldName.value?.pos0
  if (!candidate) return undefined
  try {
    return normalizeSuiObjectId(candidate)
  } catch {
    return undefined
  }
}

/**
 * Derives the shared Currency object ID for a coin type and registry.
 */
export const deriveCurrencyObjectId = (coinType: string, registryId: string) =>
  normalizeSuiObjectId(
    deriveObjectID(
      registryId,
      `0x2::coin_registry::CurrencyKey<${coinType}>`,
      new Uint8Array()
    )
  )

export type CurrencyRegistryEntry = {
  currencyId: string
  coinType: string
  symbol?: string
  name?: string
  decimals?: number
  description?: string
  iconUrl?: string
}

const CURRENCY_TYPE_REGEX = /^0x2::coin_registry::Currency<(.+)>$/i

const isCurrencyTypeMatch = (
  objectType: string | undefined,
  normalizedCoinType: string
) => {
  if (!objectType) return false
  const match = objectType.match(CURRENCY_TYPE_REGEX)
  if (!match?.[1]) return false

  try {
    const normalizedCandidate = formatTypeName(
      parseTypeNameFromString(match[1])
    )
    return normalizedCandidate.toLowerCase() === normalizedCoinType.toLowerCase()
  } catch {
    return false
  }
}

const parseCurrencyDecimals = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  if (typeof value === "bigint") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

const parseCurrencyObject = (
  object: SuiObjectResponse
): CurrencyRegistryEntry | undefined => {
  const data = object.data
  if (!data?.type || !data.objectId) return undefined

  const match = data.type.match(CURRENCY_TYPE_REGEX)
  if (!match) return undefined

  const entry: CurrencyRegistryEntry = {
    currencyId: normalizeSuiObjectId(data.objectId),
    coinType: match[1]
  }

  if (data.content && "fields" in data.content) {
    const fields = (data.content as { fields?: Record<string, unknown> }).fields
    if (fields) {
      entry.symbol = readMoveString(fields.symbol)
      entry.name = readMoveString(fields.name)
      entry.description = readMoveString(fields.description)
      entry.iconUrl = readMoveString(fields.icon_url ?? fields.iconUrl)
      entry.decimals = parseCurrencyDecimals(fields.decimals)
    }
  }

  return entry
}

const chunkIds = (ids: string[], size: number) => {
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size))
  }
  return chunks
}

const listCurrencyIds = async ({
  registryId,
  suiClient
}: {
  registryId: string
  suiClient: ToolingCoreContext["suiClient"]
}): Promise<string[]> => {
  const dynamicFields = await getAllDynamicFields(
    {
      parentObjectId: registryId,
      objectTypeFilter: "derived_object::ClaimedStatus"
    },
    { suiClient }
  )

  return dynamicFields
    .map((field) => extractClaimedObjectId(field.name as DynamicFieldName))
    .filter((value): value is string => Boolean(value))
}

export const listCurrencyRegistryEntries = async (
  {
    registryId = SUI_COIN_REGISTRY_ID,
    includeMetadata = false,
    chunkSize = 50
  }: {
    registryId?: string
    includeMetadata?: boolean
    chunkSize?: number
  },
  { suiClient }: ToolingCoreContext
): Promise<CurrencyRegistryEntry[]> => {
  const normalizedRegistryId = normalizeSuiObjectId(registryId)
  const currencyIds = await listCurrencyIds({
    registryId: normalizedRegistryId,
    suiClient
  })

  if (currencyIds.length === 0) return []

  const options = includeMetadata
    ? { showType: true, showContent: true }
    : { showType: true }

  const entries: CurrencyRegistryEntry[] = []

  for (const ids of chunkIds(currencyIds, chunkSize)) {
    const objects = await suiClient.multiGetObjects({
      ids,
      options
    })

    objects.forEach((object) => {
      const parsed = parseCurrencyObject(object)
      if (parsed) entries.push(parsed)
    })
  }

  return entries
}

export const resolveCurrencyObjectId = async (
  {
    coinType,
    registryId = SUI_COIN_REGISTRY_ID,
    fallbackRegistryScan = false
  }: {
    coinType: string
    registryId?: string
    fallbackRegistryScan?: boolean
  },
  { suiClient }: ToolingCoreContext
): Promise<string | undefined> => {
  const normalizedRegistryId = normalizeSuiObjectId(registryId)
  const normalizedCoinType = formatTypeName(parseTypeNameFromString(coinType))
  const derivedCandidate = deriveCurrencyObjectId(
    normalizedCoinType,
    normalizedRegistryId
  )

  const derivedObject = await suiClient.getObject({
    id: derivedCandidate,
    options: { showType: true }
  })

  if (
    derivedObject.data?.objectId &&
    isCurrencyTypeMatch(derivedObject.data.type, normalizedCoinType)
  ) {
    return normalizeSuiObjectId(derivedObject.data.objectId)
  }

  if (!fallbackRegistryScan) return undefined

  const dynamicFields = await getAllDynamicFields(
    {
      parentObjectId: normalizedRegistryId,
      objectTypeFilter: "derived_object::ClaimedStatus"
    },
    { suiClient }
  )

  const candidateIds = dynamicFields
    .map((field) => extractClaimedObjectId(field.name as DynamicFieldName))
    .filter((value): value is string => Boolean(value))

  for (const ids of chunkIds(candidateIds, 50)) {
    const objects = await suiClient.multiGetObjects({
      ids,
      options: { showType: true }
    })

    const match = objects.find((object) =>
      isCurrencyTypeMatch(object.data?.type, normalizedCoinType)
    )

    if (match?.data?.objectId) {
      return normalizeSuiObjectId(match.data.objectId)
    }
  }

  return undefined
}
