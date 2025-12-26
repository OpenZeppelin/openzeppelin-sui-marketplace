import { deriveObjectID, normalizeSuiObjectId } from "@mysten/sui/utils"

import { SUI_COIN_REGISTRY_ID } from "./constants.ts"
import type { ToolingCoreContext } from "./context.ts"
import { getAllDynamicFields } from "./dynamic-fields.ts"
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

const chunkIds = (ids: string[], size: number) => {
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size))
  }
  return chunks
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
  const expectedType = `0x2::coin_registry::Currency<${normalizedCoinType}>`
  const derivedCandidate = deriveCurrencyObjectId(
    normalizedCoinType,
    normalizedRegistryId
  )

  const derivedObject = await suiClient.getObject({
    id: derivedCandidate,
    options: { showType: true }
  })

  if (
    derivedObject.data?.type?.toLowerCase() === expectedType.toLowerCase() &&
    derivedObject.data?.objectId
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

    const match = objects.find(
      (object) =>
        object.data?.type?.toLowerCase() === expectedType.toLowerCase()
    )

    if (match?.data?.objectId) {
      return normalizeSuiObjectId(match.data.objectId)
    }
  }

  return undefined
}
