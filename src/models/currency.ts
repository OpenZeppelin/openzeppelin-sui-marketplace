import type { SuiClient } from "@mysten/sui/client"

import { fetchAllDynamicFields } from "../tooling/dynamic-fields.ts"
import {
  getSuiObject,
  normalizeOptionalIdFromValue
} from "../tooling/object.ts"
import {
  formatTypeName,
  isMatchingTypeName,
  parseTypeNameFromString
} from "../utils/type-name.ts"

export const ACCEPTED_CURRENCY_TYPE_FRAGMENT = "::shop::AcceptedCurrencyMarker"
export const TYPE_NAME_STRUCT = "0x1::type_name::TypeName"

export type AcceptedCurrencyMatch = {
  coinType?: string
  acceptedCurrencyId: string
  typeIndexFieldId?: string
  acceptedCurrencyFieldId?: string
}

export const normalizeCoinType = (coinType: string): string => {
  const trimmed = coinType.trim()
  if (!trimmed) throw new Error("coinType cannot be empty.")

  return formatTypeName(parseTypeNameFromString(trimmed))
}

export const normalizeOptionalCoinType = (coinType?: string) =>
  coinType ? normalizeCoinType(coinType) : undefined

export const findAcceptedCurrencyByCoinType = async ({
  coinType,
  shopId,
  suiClient
}: {
  coinType: string
  shopId: string
  suiClient: SuiClient
}): Promise<AcceptedCurrencyMatch | undefined> => {
  const normalizedCoinType = normalizeCoinType(coinType)
  const expectedTypeName = parseTypeNameFromString(normalizedCoinType)
  const dynamicFields = await fetchAllDynamicFields(shopId, suiClient)

  const typeIndexField = dynamicFields.find(
    (dynamicField) =>
      dynamicField.name.type === TYPE_NAME_STRUCT &&
      isMatchingTypeName(expectedTypeName, dynamicField.name.value)
  )

  if (!typeIndexField) return undefined

  const acceptedCurrencyId = await extractAcceptedCurrencyIdFromTypeIndexField(
    typeIndexField.objectId,
    suiClient
  )

  if (!acceptedCurrencyId) return undefined

  const acceptedCurrencyMarker = dynamicFields.find(
    (dynamicField) =>
      dynamicField.objectType?.includes(ACCEPTED_CURRENCY_TYPE_FRAGMENT) &&
      normalizeOptionalIdFromValue(dynamicField.name.value) ===
        acceptedCurrencyId
  )

  return {
    coinType: normalizedCoinType,
    acceptedCurrencyId,
    typeIndexFieldId: typeIndexField.objectId,
    acceptedCurrencyFieldId: acceptedCurrencyMarker?.objectId
  }
}

export const requireAcceptedCurrencyByCoinType = async (args: {
  coinType: string
  shopId: string
  suiClient: SuiClient
}): Promise<AcceptedCurrencyMatch> => {
  const match = await findAcceptedCurrencyByCoinType(args)
  if (match) return match

  throw new Error(
    `No accepted currency registered for coin type ${normalizeCoinType(args.coinType)}.`
  )
}

const extractAcceptedCurrencyIdFromTypeIndexField = async (
  dynamicFieldObjectId: string,
  suiClient: SuiClient
): Promise<string | undefined> => {
  const { object } = await getSuiObject(
    {
      objectId: dynamicFieldObjectId,
      options: { showContent: true, showType: true }
    },
    suiClient
  )

  // Dynamic field values can be nested; normalizeOptionalIdFromValue handles common shapes.
  // @ts-expect-error Move object content exposes fields for dynamic field values.
  return normalizeOptionalIdFromValue(object.content?.fields?.value)
}
