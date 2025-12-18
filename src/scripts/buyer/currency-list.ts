import { SuiClient } from "@mysten/sui/client"
import yargs from "yargs"

import type { AcceptedCurrencySummary } from "../../models/currency.ts"
import { fetchAcceptedCurrencySummaries } from "../../models/currency.ts"
import { resolveLatestArtifactShopId } from "../../models/shop.ts"
import {
  logKeyValueBlue,
  logKeyValueGreen,
  logKeyValueYellow
} from "../../tooling/log.ts"
import { runSuiScript } from "../../tooling/process.ts"

type ListCurrenciesArguments = {
  shopId?: string
}

runSuiScript(
  async (
    { network, currentNetwork },
    cliArguments: ListCurrenciesArguments
  ) => {
    const shopId = await resolveLatestArtifactShopId(
      cliArguments.shopId,
      network.networkName
    )
    const suiClient = new SuiClient({ url: network.url })

    logListContext({
      shopId,
      rpcUrl: network.url,
      networkName: currentNetwork
    })

    const acceptedCurrencies = await fetchAcceptedCurrencySummaries(
      shopId,
      suiClient
    )
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
  logKeyValueGreen("Marker-id")(acceptedCurrency.markerObjectId)
  console.log("")
}
