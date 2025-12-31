import type { SuiClient, SuiObjectData } from "@mysten/sui/client"

import {
  getAllDynamicFields,
  getSuiDynamicFieldObject
} from "@sui-oracle-market/tooling-core/dynamic-fields"
import {
  getSuiObject,
  normalizeIdOrThrow,
  normalizeOptionalIdFromValue,
  unwrapMoveObjectFields
} from "@sui-oracle-market/tooling-core/object"
import {
  decodeUtf8Vector,
  formatOptionalNumericValue,
  formatVectorBytesAsHex,
  parseOptionalNumber
} from "@sui-oracle-market/tooling-core/utils/formatters"
import {
  formatTypeName,
  formatTypeNameFromFieldValue,
  isMatchingTypeName,
  parseTypeNameFromString
} from "@sui-oracle-market/tooling-core/utils/type-name"

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

export const ensureSignerOwnsCoin = ({
  coinObjectId,
  coinOwnerAddress,
  signerAddress
}: {
  coinObjectId: string
  coinOwnerAddress: string
  signerAddress: string
}) => {
  if (coinOwnerAddress !== signerAddress)
    throw new Error(
      `Coin object ${coinObjectId} is owned by ${coinOwnerAddress}, not the signer ${signerAddress}.`
    )
}

export const extractCoinType = (objectType?: string): string => {
  if (!objectType)
    throw new Error("Coin object is missing its type information.")

  if (!objectType.includes("::coin::Coin<"))
    throw new Error(`Object ${objectType} is not a Coin object.`)

  return objectType
}

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
  const dynamicFields = await getAllDynamicFields(
    { parentObjectId: shopId },
    { suiClient }
  )

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
    `No accepted currency registered for coin type ${normalizeCoinType(
      args.coinType
    )}.`
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
    { suiClient }
  )

  // Dynamic field values can be nested; normalizeOptionalIdFromValue handles common shapes.
  // @ts-expect-error Move object content exposes fields for dynamic field values.
  return normalizeOptionalIdFromValue(object.content?.fields?.value)
}

export type AcceptedCurrencySummary = {
  acceptedCurrencyId: string
  markerObjectId: string
  coinType: string
  symbol?: string
  decimals?: number
  feedIdHex: string
  pythObjectId?: string
  maxPriceAgeSecsCap?: string
  maxConfidenceRatioBpsCap?: string
  maxPriceStatusLagSecsCap?: string
}

export const getAcceptedCurrencySummaries = async (
  shopId: string,
  suiClient: SuiClient
): Promise<AcceptedCurrencySummary[]> => {
  const acceptedCurrencyMarkers = await getAllDynamicFields(
    {
      parentObjectId: shopId,
      objectTypeFilter: ACCEPTED_CURRENCY_TYPE_FRAGMENT
    },
    { suiClient }
  )

  if (acceptedCurrencyMarkers.length === 0) return []

  const acceptedCurrencyIds = acceptedCurrencyMarkers.map((marker) =>
    normalizeIdOrThrow(
      normalizeOptionalIdFromValue((marker.name as { value: string })?.value),
      `Missing AcceptedCurrency id for dynamic field ${marker.objectId}.`
    )
  )

  const acceptedCurrencyObjects = await Promise.all(
    acceptedCurrencyIds.map((currencyId) =>
      getSuiObject(
        {
          objectId: currencyId,
          options: { showContent: true, showType: true }
        },
        { suiClient }
      )
    )
  )

  return acceptedCurrencyObjects.map((response, index) =>
    buildAcceptedCurrencySummary(
      response.object,
      acceptedCurrencyIds[index],
      acceptedCurrencyMarkers[index].objectId
    )
  )
}

export const getAcceptedCurrencySummary = async (
  shopId: string,
  acceptedCurrencyId: string,
  suiClient: SuiClient
): Promise<AcceptedCurrencySummary> => {
  const { object } = await getSuiObject(
    {
      objectId: acceptedCurrencyId,
      options: { showContent: true, showType: true }
    },
    { suiClient }
  )

  const marker = await getSuiDynamicFieldObject(
    { parentObjectId: shopId, childObjectId: acceptedCurrencyId },
    { suiClient }
  )

  return buildAcceptedCurrencySummary(
    object,
    acceptedCurrencyId,
    marker.dynamicFieldId
  )
}

const buildAcceptedCurrencySummary = (
  acceptedCurrencyObject: SuiObjectData,
  acceptedCurrencyId: string,
  markerObjectId: string
): AcceptedCurrencySummary => {
  const acceptedCurrencyFields = unwrapMoveObjectFields(acceptedCurrencyObject)
  const coinType =
    formatTypeNameFromFieldValue(acceptedCurrencyFields.coin_type) || "Unknown"

  return {
    acceptedCurrencyId,
    markerObjectId,
    coinType,
    symbol: decodeUtf8Vector(acceptedCurrencyFields.symbol),
    decimals: parseOptionalNumber(acceptedCurrencyFields.decimals),
    feedIdHex: formatVectorBytesAsHex(acceptedCurrencyFields.feed_id),
    pythObjectId: normalizeOptionalIdFromValue(
      acceptedCurrencyFields.pyth_object_id
    ),
    maxPriceAgeSecsCap: formatOptionalNumericValue(
      acceptedCurrencyFields.max_price_age_secs_cap
    ),
    maxConfidenceRatioBpsCap: formatOptionalNumericValue(
      acceptedCurrencyFields.max_confidence_ratio_bps_cap
    ),
    maxPriceStatusLagSecsCap: formatOptionalNumericValue(
      acceptedCurrencyFields.max_price_status_lag_secs_cap
    )
  }
}
