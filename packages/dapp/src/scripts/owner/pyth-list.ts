/**
 * Lists Pyth feeds and enriches them with on-chain data needed to register
 * AcceptedCurrency entries (feed id + PriceInfoObject id).
 * Optional coin registry matching is included to surface coin types and currency ids.
 */
import type { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import {
  requirePythPullOracleConfig,
  resolvePythPullOracleConfigWithOverrides
} from "@sui-oracle-market/domain-core/models/pyth"
import {
  createPythClient,
  filterPythFeedSummaries,
  listPythFeedSummaries,
  resolveCoinFilterSymbol,
  resolveHermesQuery,
  resolveQuerySymbolFilters,
  resolvePythPriceInfoObjectId,
  type PythFeedSummary
} from "@sui-oracle-market/domain-core/models/pyth-feeds"
import type { CurrencyRegistryEntry } from "@sui-oracle-market/tooling-core/coin-registry"
import { SUI_COIN_REGISTRY_ID } from "@sui-oracle-market/tooling-node/constants"
import {
  logKeyValueBlue,
  logKeyValueGreen,
  logKeyValueYellow
} from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"

type PythListArguments = {
  hermesUrl?: string
  pythStateId?: string
  wormholeStateId?: string
  registryId?: string
  query?: string
  assetType?: string
  quote?: string
  coin?: string
  limit?: number
  skipRegistry?: boolean
  skipPriceInfo?: boolean
  json?: boolean
}

type FeedRecord = PythFeedSummary & {
  priceInfoObjectId?: string
  currencyMatches?: CurrencyRegistryEntry[]
}

runSuiScript(
  async (tooling, cliArguments: PythListArguments) => {
    const pythPullConfig = resolvePythPullConfigOrThrow(
      tooling.network.networkName,
      cliArguments
    )

    const feedSummaries = await listPythFeedSummaries({
      hermesUrl: pythPullConfig.hermesUrl,
      query: resolveHermesQuery(cliArguments.query),
      assetType: cliArguments.assetType
    })

    const registryId = normalizeSuiObjectId(
      cliArguments.registryId ?? SUI_COIN_REGISTRY_ID
    )
    const registryEntries = cliArguments.skipRegistry
      ? []
      : await tooling.listCurrencyRegistryEntries({
          registryId,
          includeMetadata: true
        })
    const currencyIndex = indexCurrencyEntriesBySymbol(registryEntries)
    const queryFilters = resolveQuerySymbolFilters({
      query: cliArguments.query,
      registryEntries
    })
    const coinSymbolFilter = resolveCoinFilterSymbol({
      coinInput: cliArguments.coin ?? queryFilters.coinSymbol,
      registryEntries
    })
    const filteredSummaries = filterPythFeedSummaries({
      feedSummaries,
      filters: {
        baseSymbol: queryFilters.baseSymbol,
        quoteSymbol: cliArguments.quote ?? queryFilters.quoteSymbol,
        coinSymbol: coinSymbolFilter
      }
    })

    if (filteredSummaries.length === 0) {
      if (!cliArguments.json) {
        logKeyValueYellow("Pyth feeds")("No feeds returned by Hermes.")
      }
      return
    }

    const limitedFeeds = limitFeedSummaries(
      filteredSummaries,
      cliArguments.limit
    )
    const feedRecords = await buildFeedRecords({
      feedSummaries: limitedFeeds,
      pythPullConfig,
      includePriceInfo: !cliArguments.skipPriceInfo,
      currencyIndex,
      suiClient: tooling.suiClient
    })

    if (cliArguments.json)
      return console.log(JSON.stringify(feedRecords, null, 2))

    logHeader({
      networkName: tooling.network.networkName,
      rpcUrl: tooling.network.url,
      hermesUrl: pythPullConfig.hermesUrl,
      pythStateId: pythPullConfig.pythStateId,
      registryId,
      feedCount: feedRecords.length
    })

    feedRecords.forEach((record, index) => logFeedRecord(record, index + 1))
  },
  yargs()
    .option("hermesUrl", {
      alias: ["hermes-url", "hermes"],
      type: "string",
      description:
        "Optional Hermes endpoint override (defaults to hermes-beta on testnet and hermes on mainnet)."
    })
    .option("pythStateId", {
      alias: ["pyth-state-id"],
      type: "string",
      description:
        "Optional Pyth state object id override (defaults to the known testnet/mainnet id)."
    })
    .option("wormholeStateId", {
      alias: ["wormhole-state-id"],
      type: "string",
      description:
        "Optional Wormhole state object id override (used by the Pyth client helper)."
    })
    .option("registryId", {
      alias: ["registry-id"],
      type: "string",
      description:
        "Coin registry object id; defaults to the shared Sui coin registry."
    })
    .option("query", {
      alias: ["search", "q"],
      type: "string",
      description:
        "Filter Hermes feeds by symbol/description (passes through to Hermes where supported)."
    })
    .option("assetType", {
      alias: ["asset-type"],
      type: "string",
      description:
        "Optional asset type filter (e.g. crypto, equity, fx, commodity)."
    })
    .option("quote", {
      alias: ["quote-symbol"],
      type: "string",
      description:
        "Filter by quote symbol (e.g. USD) after Hermes results are loaded."
    })
    .option("coin", {
      alias: ["coin-type"],
      type: "string",
      description:
        "Filter feeds that include the provided coin (symbol or full coin type)."
    })
    .option("limit", {
      alias: ["max"],
      type: "number",
      description: "Limit the number of feeds displayed."
    })
    .option("skipRegistry", {
      alias: ["skip-registry", "no-registry"],
      type: "boolean",
      default: false,
      description:
        "Skip coin registry matching (faster, but omits currency ids/coin types)."
    })
    .option("skipPriceInfo", {
      alias: ["skip-price-info"],
      type: "boolean",
      default: false,
      description:
        "Skip on-chain PriceInfoObject lookup (faster, but omits object ids)."
    })
    .option("json", {
      type: "boolean",
      default: false,
      description: "Output the feed list as JSON."
    })
    .strict()
)

const resolvePythPullConfigOrThrow = (
  networkName: string,
  cliArguments: PythListArguments
) =>
  requirePythPullOracleConfig(
    resolvePythPullOracleConfigWithOverrides({
      networkName,
      overrides: {
        hermesUrl: cliArguments.hermesUrl,
        pythStateId: cliArguments.pythStateId,
        wormholeStateId: cliArguments.wormholeStateId
      }
    })
  )

const limitFeedSummaries = (summaries: PythFeedSummary[], limit?: number) =>
  typeof limit === "number" && Number.isFinite(limit)
    ? summaries.slice(0, Math.max(0, limit))
    : summaries

const buildFeedRecords = async ({
  feedSummaries,
  pythPullConfig,
  includePriceInfo,
  currencyIndex,
  suiClient
}: {
  feedSummaries: PythFeedSummary[]
  pythPullConfig: {
    pythStateId: string
    wormholeStateId: string
  }
  includePriceInfo: boolean
  currencyIndex: Map<string, CurrencyRegistryEntry[]>
  suiClient: SuiClient
}): Promise<FeedRecord[]> => {
  const pythClient = includePriceInfo
    ? createPythClient({
        suiClient,
        pythStateId: pythPullConfig.pythStateId,
        wormholeStateId: pythPullConfig.wormholeStateId
      })
    : undefined

  return await Promise.all(
    feedSummaries.map((summary) =>
      buildFeedRecord({
        summary,
        pythClient,
        currencyIndex
      })
    )
  )
}

const buildFeedRecord = async ({
  summary,
  pythClient,
  currencyIndex
}: {
  summary: PythFeedSummary
  pythClient?: ReturnType<typeof createPythClient>
  currencyIndex: Map<string, CurrencyRegistryEntry[]>
}): Promise<FeedRecord> => {
  const priceInfoObjectId = pythClient
    ? await resolvePythPriceInfoObjectId({
        pythClient,
        feedId: summary.feedId
      })
    : undefined

  const currencyMatches = summary.baseSymbol
    ? currencyIndex.get(summary.baseSymbol.toLowerCase())
    : undefined

  return {
    ...summary,
    priceInfoObjectId,
    currencyMatches
  }
}

const indexCurrencyEntriesBySymbol = (entries: CurrencyRegistryEntry[]) => {
  const index = new Map<string, CurrencyRegistryEntry[]>()
  entries.forEach((entry) => {
    const symbolKey = entry.symbol?.trim().toLowerCase()
    if (!symbolKey) return

    const existing = index.get(symbolKey) ?? []
    existing.push(entry)
    index.set(symbolKey, existing)
  })
  return index
}

const logHeader = ({
  networkName,
  rpcUrl,
  hermesUrl,
  pythStateId,
  registryId,
  feedCount
}: {
  networkName: string
  rpcUrl: string
  hermesUrl: string
  pythStateId: string
  registryId: string
  feedCount: number
}) => {
  logKeyValueBlue("Network")(networkName)
  logKeyValueBlue("RPC")(rpcUrl)
  logKeyValueBlue("Hermes")(hermesUrl)
  logKeyValueBlue("Pyth-state")(pythStateId)
  logKeyValueBlue("Coin-registry")(registryId)
  logKeyValueBlue("Feeds")(feedCount)
  console.log("")
}

const logFeedRecord = (record: FeedRecord, index: number) => {
  logKeyValueGreen("Feed")(index)
  if (record.symbol) logKeyValueBlue("Symbol")(record.symbol)
  if (record.description) logKeyValueBlue("Description")(record.description)
  if (record.baseSymbol) logKeyValueBlue("Base")(record.baseSymbol)
  if (record.quoteSymbol) logKeyValueBlue("Quote")(record.quoteSymbol)
  if (record.assetType) logKeyValueBlue("Asset-type")(record.assetType)
  logKeyValueBlue("Feed-id")(record.feedId)
  logKeyValueBlue("Price-info")(record.priceInfoObjectId ?? "missing")

  if (record.currencyMatches && record.currencyMatches.length > 0) {
    if (record.currencyMatches.length === 1) {
      logCurrencyMatch(record.currencyMatches[0])
    } else {
      logKeyValueYellow("Currency")(
        `Multiple matches (${record.currencyMatches.length})`
      )
      record.currencyMatches.forEach((match) => logCurrencyMatch(match))
    }
  } else {
    logKeyValueYellow("Currency")("No coin registry match")
  }

  console.log("")
}

const logCurrencyMatch = (match: CurrencyRegistryEntry) => {
  logKeyValueBlue("Currency-id")(match.currencyId)
  logKeyValueBlue("Coin-type")(match.coinType)
  if (match.symbol) logKeyValueBlue("Coin-symbol")(match.symbol)
  if (match.decimals !== undefined)
    logKeyValueBlue("Coin-decimals")(match.decimals)
}
