import type { SuiObjectData } from "@mysten/sui/client"
import { SuiClient } from "@mysten/sui/client"
import yargs from "yargs"

import { getLatestObjectFromArtifact } from "../../tooling/artifacts.ts"
import {
  logKeyValueBlue,
  logKeyValueGreen,
  logKeyValueYellow
} from "../../tooling/log.ts"
import {
  getSuiObject,
  normalizeIdOrThrow,
  normalizeOptionalIdFromValue,
  unwrapMoveObjectFields
} from "../../tooling/object.ts"
import { runSuiScript } from "../../tooling/process.ts"
import { fetchAllDynamicFields } from "../../utils/dynamic-fields.ts"
import {
  decodeUtf8Vector,
  formatOptionalNumericValue,
  formatVectorBytesAsHex,
  parseOptionalNumber
} from "../../utils/formatters.ts"
import { formatTypeNameFromFieldValue } from "../../utils/type-name.ts"

type ListCurrenciesArguments = {
  shopId?: string
}

type AcceptedCurrencySummary = {
  acceptedCurrencyId: string
  dynamicFieldObjectId: string
  coinType: string
  symbol?: string
  decimals?: number
  feedIdHex: string
  pythObjectId?: string
  maxPriceAgeSecsCap?: string
  maxConfidenceRatioBpsCap?: string
  maxPriceStatusLagSecsCap?: string
}

const ACCEPTED_CURRENCY_TYPE_FRAGMENT = "::shop::AcceptedCurrency"

runSuiScript(
  async ({ network, currentNetwork }, cliArguments) => {
    const { shopId } = await resolveInputs(cliArguments, network.networkName)
    const suiClient = new SuiClient({ url: network.url })

    logListContext({
      shopId,
      rpcUrl: network.url,
      networkName: currentNetwork
    })

    const acceptedCurrencies = await fetchAcceptedCurrencies(shopId, suiClient)
    if (acceptedCurrencies.length === 0)
      return logKeyValueYellow("Accepted-currencies")(
        "No currencies registered."
      )

    acceptedCurrencies.forEach((currency, index) =>
      logAcceptedCurrency(currency, index + 1)
    )
  },
  yargs()
    .option("shopId", {
      alias: "shop-id",
      type: "string",
      description:
        "Shared Shop object ID; defaults to the latest Shop artifact when available.",
      demandOption: false
    })
    .strict()
)

const resolveInputs = async (
  cliArguments: ListCurrenciesArguments,
  networkName: string
) => {
  const shopArtifact = await getLatestObjectFromArtifact(
    "shop::Shop",
    networkName
  )

  return {
    shopId: normalizeIdOrThrow(
      cliArguments.shopId ?? shopArtifact?.objectId,
      "A shop id is required; create a shop first or provide --shop-id."
    )
  }
}

const fetchAcceptedCurrencies = async (
  shopId: string,
  suiClient: SuiClient
): Promise<AcceptedCurrencySummary[]> => {
  const dynamicFields = await fetchAllDynamicFields(shopId, suiClient)
  const acceptedCurrencyFields = dynamicFields.filter((dynamicField) =>
    dynamicField.objectType?.includes(ACCEPTED_CURRENCY_TYPE_FRAGMENT)
  )

  if (acceptedCurrencyFields.length === 0) return []

  const acceptedCurrencyObjects = await Promise.all(
    acceptedCurrencyFields.map((field) =>
      getSuiObject(
        {
          objectId: field.objectId,
          options: { showContent: true, showType: true }
        },
        suiClient
      )
    )
  )

  return acceptedCurrencyObjects.map((response, index) =>
    buildAcceptedCurrencySummary(
      response.object,
      acceptedCurrencyFields[index].objectId
    )
  )
}

const buildAcceptedCurrencySummary = (
  dynamicFieldObject: SuiObjectData,
  dynamicFieldObjectId: string
): AcceptedCurrencySummary => {
  const acceptedCurrencyFields = unwrapMoveObjectFields(dynamicFieldObject)

  const acceptedCurrencyId = normalizeOptionalIdFromValue(
    acceptedCurrencyFields.id
  )
  const coinType =
    formatTypeNameFromFieldValue(acceptedCurrencyFields.coin_type) || "Unknown"

  return {
    acceptedCurrencyId: normalizeIdOrThrow(
      acceptedCurrencyId,
      `Missing AcceptedCurrency id for dynamic field ${dynamicFieldObjectId}.`
    ),
    dynamicFieldObjectId,
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

const logListContext = ({
  shopId,
  rpcUrl,
  networkName
}: {
  shopId: string
  rpcUrl: string
  networkName: string
}) => {
  logKeyValueBlue("Network")(networkName)
  logKeyValueBlue("RPC")(rpcUrl)
  logKeyValueBlue("Shop")(shopId)
  console.log("")
}

const logAcceptedCurrency = (
  acceptedCurrency: AcceptedCurrencySummary,
  index: number
) => {
  logKeyValueGreen("Currency")(index)
  logKeyValueGreen("Object")(acceptedCurrency.acceptedCurrencyId)
  logKeyValueGreen("Coin-type")(acceptedCurrency.coinType)
  if (acceptedCurrency.symbol)
    logKeyValueGreen("Symbol")(acceptedCurrency.symbol)
  if (acceptedCurrency.decimals !== undefined)
    logKeyValueGreen("Decimals")(acceptedCurrency.decimals)
  logKeyValueGreen("Feed-id")(acceptedCurrency.feedIdHex)
  if (acceptedCurrency.pythObjectId)
    logKeyValueGreen("Pyth-object")(acceptedCurrency.pythObjectId)
  logKeyValueGreen("Max-age-secs")(
    acceptedCurrency.maxPriceAgeSecsCap ?? "module default"
  )
  logKeyValueGreen("Max-conf-bps")(
    acceptedCurrency.maxConfidenceRatioBpsCap ?? "module default"
  )
  logKeyValueGreen("Max-status-lag")(
    acceptedCurrency.maxPriceStatusLagSecsCap ?? "module default"
  )
  logKeyValueGreen("Field-id")(acceptedCurrency.dynamicFieldObjectId)
  console.log("")
}
