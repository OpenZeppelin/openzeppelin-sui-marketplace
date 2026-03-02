import type { SuiClient, SuiObjectData } from "@mysten/sui/client"
import { normalizeCoinType } from "@sui-oracle-market/tooling-core/coin"
import {
  getSuiObject,
  normalizeOptionalId,
  normalizeOptionalIdFromValue,
  unwrapMoveObjectFields
} from "@sui-oracle-market/tooling-core/object"
import {
  getTableEntryDynamicFields,
  resolveTableObjectIdFromField
} from "@sui-oracle-market/tooling-core/table"
import {
  formatOptionalNumericValue,
  formatVectorBytesAsHex,
  parseOptionalNumber,
  readMoveStringOrVector
} from "@sui-oracle-market/tooling-core/utils/formatters"
import {
  formatTypeNameFromFieldValue,
  isMatchingTypeName,
  parseTypeNameFromString
} from "@sui-oracle-market/tooling-core/utils/type-name"
import {
  parsePositiveU16,
  parsePositiveU64
} from "@sui-oracle-market/tooling-core/utils/utility"
import { resolveValidationMessage } from "@sui-oracle-market/tooling-core/utils/validation"

export const ACCEPTED_CURRENCY_TYPE_FRAGMENT = "::shop::AcceptedCurrency"
export const TYPE_NAME_STRUCT = "0x1::type_name::TypeName"
const SHOP_ACCEPTED_CURRENCIES_FIELD = "accepted_currencies"

export const MAX_PRICE_AGE_SECS_CAP = 60n
export const MAX_CONFIDENCE_RATIO_BPS_CAP = 1_000
export const MAX_PRICE_STATUS_LAG_SECS_CAP = 5n

export { normalizeCoinType }

export type GuardrailParseResult = {
  value?: bigint
  error?: string
}

export type GuardrailU16ParseResult = {
  value?: number
  error?: string
}

type AcceptedCurrencyTableEntryField = Awaited<
  ReturnType<typeof getTableEntryDynamicFields>
>[number]

const parseOptionalGuardrailValue = <TValue>({
  rawValue,
  label,
  parser,
  errorMessage
}: {
  rawValue: string
  label: string
  parser: (value: string, label: string) => TValue
  errorMessage: string
}): { value?: TValue; error?: string } => {
  const trimmed = rawValue.trim()
  if (!trimmed) return { value: undefined }

  try {
    return { value: parser(trimmed, label) }
  } catch (error) {
    return {
      value: undefined,
      error: resolveValidationMessage(error, errorMessage)
    }
  }
}

export const parseAcceptedCurrencyGuardrailValue = (
  rawValue: string,
  label: string
): GuardrailParseResult => {
  return parseOptionalGuardrailValue({
    rawValue,
    label,
    parser: parsePositiveU64,
    errorMessage: `${label} must be a positive u64.`
  })
}

export const parseAcceptedCurrencyBpsValue = (
  rawValue: string,
  label: string
): GuardrailU16ParseResult => {
  return parseOptionalGuardrailValue({
    rawValue,
    label,
    parser: parsePositiveU16,
    errorMessage: `${label} must be a positive u16.`
  })
}

export type AcceptedCurrencySummary = {
  coinType: string
  tableEntryFieldId: string
  symbol?: string
  decimals?: number
  feedIdHex: string
  pythObjectId?: string
  maxPriceAgeSecsCap?: string
  maxConfidenceRatioBpsCap?: string
  maxPriceStatusLagSecsCap?: string
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

const getAcceptedCurrenciesTableObjectId = async ({
  shopId,
  suiClient
}: {
  shopId: string
  suiClient: SuiClient
}) => {
  const { object: shopObject } = await getSuiObject(
    {
      objectId: shopId,
      options: { showContent: true, showType: true }
    },
    { suiClient }
  )

  return resolveTableObjectIdFromField({
    object: shopObject,
    fieldName: SHOP_ACCEPTED_CURRENCIES_FIELD
  })
}

const getAcceptedCurrencyTableEntryFields = async ({
  tableObjectId,
  suiClient
}: {
  tableObjectId: string
  suiClient: SuiClient
}) =>
  getTableEntryDynamicFields(
    {
      tableObjectId,
      objectTypeFilter: ACCEPTED_CURRENCY_TYPE_FRAGMENT
    },
    { suiClient }
  )

const findAcceptedCurrencyTableEntryFieldByCoinType = ({
  coinType,
  tableEntryFields
}: {
  coinType: string
  tableEntryFields: AcceptedCurrencyTableEntryField[]
}) => {
  const expectedTypeName = parseTypeNameFromString(coinType)

  return tableEntryFields.find(
    (tableEntryField) =>
      tableEntryField.name.type === TYPE_NAME_STRUCT &&
      isMatchingTypeName(expectedTypeName, tableEntryField.name.value)
  )
}

const resolveCoinTypeFromTableEntryField = (
  tableEntryField: AcceptedCurrencyTableEntryField
) => formatTypeNameFromFieldValue(tableEntryField.name.value) || "Unknown"

const buildAcceptedCurrencySummary = ({
  acceptedCurrencyTableEntryObject,
  tableEntryFieldId,
  coinType
}: {
  acceptedCurrencyTableEntryObject: SuiObjectData
  tableEntryFieldId: string
  coinType: string
}): AcceptedCurrencySummary => {
  const acceptedCurrencyFields = unwrapMoveObjectFields<
    Record<string, unknown>
  >(acceptedCurrencyTableEntryObject)

  return {
    coinType,
    tableEntryFieldId,
    symbol: readMoveStringOrVector(acceptedCurrencyFields.symbol),
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

const getAcceptedCurrencySummaryByTableEntryField = async ({
  tableEntryField,
  coinType,
  suiClient
}: {
  tableEntryField: AcceptedCurrencyTableEntryField
  coinType: string
  suiClient: SuiClient
}): Promise<AcceptedCurrencySummary> => {
  const { object: acceptedCurrencyTableEntryObject } = await getSuiObject(
    {
      objectId: tableEntryField.objectId,
      options: { showContent: true, showType: true }
    },
    { suiClient }
  )

  return buildAcceptedCurrencySummary({
    acceptedCurrencyTableEntryObject,
    tableEntryFieldId: tableEntryField.objectId,
    coinType
  })
}

const getAcceptedCurrencySummaryByLegacyTableEntryFieldId = async ({
  shopId,
  legacyTableEntryFieldId,
  suiClient
}: {
  shopId: string
  legacyTableEntryFieldId: string
  suiClient: SuiClient
}): Promise<AcceptedCurrencySummary | undefined> => {
  const normalizedTableEntryFieldId = normalizeOptionalId(
    legacyTableEntryFieldId
  )
  if (!normalizedTableEntryFieldId) return undefined

  const acceptedCurrencySummaries = await getAcceptedCurrencySummaries(
    shopId,
    suiClient
  )

  return acceptedCurrencySummaries.find(
    (summary) => summary.tableEntryFieldId === normalizedTableEntryFieldId
  )
}

// Heuristic: fully qualified Move types include "::" (for example 0x2::sui::SUI);
// this is not a full parser, so callers must still treat results as untrusted input.
const isCoinTypeCandidate = (value: string) => value.includes("::")

export const findAcceptedCurrencyByCoinType = async ({
  coinType,
  shopId,
  suiClient
}: {
  coinType: string
  shopId: string
  suiClient: SuiClient
}): Promise<AcceptedCurrencySummary | undefined> => {
  const normalizedCoinType = normalizeCoinType(coinType)
  const tableObjectId = await getAcceptedCurrenciesTableObjectId({
    shopId,
    suiClient
  })
  const tableEntryFields = await getAcceptedCurrencyTableEntryFields({
    tableObjectId,
    suiClient
  })

  const matchedTableEntryField = findAcceptedCurrencyTableEntryFieldByCoinType({
    coinType: normalizedCoinType,
    tableEntryFields
  })

  if (!matchedTableEntryField) return undefined

  return getAcceptedCurrencySummaryByTableEntryField({
    tableEntryField: matchedTableEntryField,
    coinType: normalizedCoinType,
    suiClient
  })
}

export const requireAcceptedCurrencyByCoinType = async (args: {
  coinType: string
  shopId: string
  suiClient: SuiClient
}): Promise<AcceptedCurrencySummary> => {
  const summary = await findAcceptedCurrencyByCoinType(args)
  if (summary) return summary

  throw new Error(
    `No accepted currency registered for coin type ${normalizeCoinType(
      args.coinType
    )}.`
  )
}

export const getAcceptedCurrencySummaries = async (
  shopId: string,
  suiClient: SuiClient
): Promise<AcceptedCurrencySummary[]> => {
  const tableObjectId = await getAcceptedCurrenciesTableObjectId({
    shopId,
    suiClient
  })
  const tableEntryFields = await getAcceptedCurrencyTableEntryFields({
    tableObjectId,
    suiClient
  })

  if (tableEntryFields.length === 0) return []

  const summaries = await Promise.all(
    tableEntryFields.map((tableEntryField) =>
      getAcceptedCurrencySummaryByTableEntryField({
        tableEntryField,
        coinType: resolveCoinTypeFromTableEntryField(tableEntryField),
        suiClient
      })
    )
  )

  return summaries.sort((left, right) =>
    left.coinType.localeCompare(right.coinType)
  )
}

/**
 * Transitional helper: resolves accepted currency summary by coin type.
 * If a legacy table-entry dynamic-field ID is provided, it resolves by ID.
 */
export const getAcceptedCurrencySummary = async (
  shopId: string,
  coinTypeOrLegacyTableEntryFieldId: string,
  suiClient: SuiClient
): Promise<AcceptedCurrencySummary> => {
  if (!coinTypeOrLegacyTableEntryFieldId.trim())
    throw new Error("coinType is required.")

  if (isCoinTypeCandidate(coinTypeOrLegacyTableEntryFieldId))
    return requireAcceptedCurrencyByCoinType({
      coinType: coinTypeOrLegacyTableEntryFieldId,
      shopId,
      suiClient
    })

  const summary = await getAcceptedCurrencySummaryByLegacyTableEntryFieldId({
    shopId,
    legacyTableEntryFieldId: coinTypeOrLegacyTableEntryFieldId,
    suiClient
  })

  if (summary) return summary

  throw new Error(
    `No accepted currency registered for legacy table entry field id ${coinTypeOrLegacyTableEntryFieldId}.`
  )
}
