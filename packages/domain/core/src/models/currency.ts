import type { SuiClient, SuiObjectData } from "@mysten/sui/client"
import { normalizeCoinType } from "@sui-oracle-market/tooling-core/coin"

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
  formatTypeNameFromFieldValue,
  isMatchingTypeName,
  parseTypeNameFromString
} from "@sui-oracle-market/tooling-core/utils/type-name"
import { parseOptionalPositiveU64 } from "@sui-oracle-market/tooling-core/utils/utility"
import { resolveValidationMessage } from "@sui-oracle-market/tooling-core/utils/validation"

export const ACCEPTED_CURRENCY_TYPE_FRAGMENT = "::shop::AcceptedCurrencyMarker"
export const TYPE_NAME_STRUCT = "0x1::type_name::TypeName"

export const MAX_PRICE_AGE_SECS_CAP = 60n
export const MAX_CONFIDENCE_RATIO_BPS_CAP = 1_000n
export const MAX_PRICE_STATUS_LAG_SECS_CAP = 5n

export { normalizeCoinType }

export type GuardrailParseResult = {
  value?: bigint
  error?: string
}

export const parseAcceptedCurrencyGuardrailValue = (
  rawValue: string,
  label: string
): GuardrailParseResult => {
  const trimmed = rawValue.trim()
  if (!trimmed) return { value: undefined }

  try {
    return { value: parseOptionalPositiveU64(trimmed, label) }
  } catch (error) {
    return {
      value: undefined,
      error: resolveValidationMessage(error, `${label} must be a positive u64.`)
    }
  }
}

export type AcceptedCurrencyMatch = {
  coinType?: string
  acceptedCurrencyId: string
  typeIndexFieldId?: string
  acceptedCurrencyFieldId?: string
}

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
