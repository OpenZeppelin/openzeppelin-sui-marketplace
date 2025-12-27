/**
 * Lists Pyth feeds and enriches them with on-chain data needed to register
 * AcceptedCurrency entries (feed id + PriceInfoObject id).
 * Optional coin registry matching is included to surface coin types and currency ids.
 */
import type { SuiClient, SuiObjectResponse } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import {
  requirePythPullOracleConfig,
  resolvePythPullOracleConfigWithOverrides
} from "@sui-oracle-market/domain-core/models/pyth"
import {
  createPythClient,
  listPythFeedSummaries,
  resolvePythPriceInfoObjectId,
  type PythFeedSummary
} from "@sui-oracle-market/domain-core/models/pyth-feeds"
import { getAllDynamicFields } from "@sui-oracle-market/tooling-core/dynamic-fields"
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

type CurrencyRegistryEntry = {
  currencyId: string
  coinType: string
  symbol?: string
  name?: string
  decimals?: number
  description?: string
  iconUrl?: string
}

type FeedRecord = PythFeedSummary & {
  priceInfoObjectId?: string
  currencyMatches?: CurrencyRegistryEntry[]
}

runSuiScript(
  async (tooling, cliArguments: PythListArguments) => {
    const { suiClient, network } = tooling
    const pythPullConfig = resolvePythPullConfigOrThrow(
      network.networkName,
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
      : await listCurrencyRegistryEntries({
          registryId,
          suiClient
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
    const filteredSummaries = filterFeedSummaries({
      feedSummaries,
      baseSymbol: queryFilters.baseSymbol,
      quoteSymbol: cliArguments.quote ?? queryFilters.quoteSymbol,
      coinSymbol: coinSymbolFilter
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
      suiClient
    })

    if (cliArguments.json)
      return console.log(JSON.stringify(feedRecords, null, 2))

    logHeader({
      networkName: network.networkName,
      rpcUrl: network.url,
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

const resolveHermesQuery = (query?: string) =>
  query && query.includes("::") ? undefined : query

const filterFeedSummariesByQuoteSymbol = ({
  feedSummaries,
  quoteSymbol
}: {
  feedSummaries: PythFeedSummary[]
  quoteSymbol?: string
}) => {
  const normalizedQuote = normalizeSymbol(quoteSymbol)
  if (!normalizedQuote) return feedSummaries

  return feedSummaries.filter(
    (summary) => normalizeSymbol(summary.quoteSymbol) === normalizedQuote
  )
}

const filterFeedSummariesByBaseSymbol = ({
  feedSummaries,
  baseSymbol
}: {
  feedSummaries: PythFeedSummary[]
  baseSymbol?: string
}) => {
  const normalizedBase = normalizeSymbol(baseSymbol)
  if (!normalizedBase) return feedSummaries

  return feedSummaries.filter(
    (summary) => normalizeSymbol(summary.baseSymbol) === normalizedBase
  )
}

const filterFeedSummariesByCoinSymbol = ({
  feedSummaries,
  coinSymbol
}: {
  feedSummaries: PythFeedSummary[]
  coinSymbol?: string
}) => {
  const normalizedCoin = normalizeSymbol(coinSymbol)
  if (!normalizedCoin) return feedSummaries

  return feedSummaries.filter((summary) => {
    const baseSymbol = normalizeSymbol(summary.baseSymbol)
    const quoteSymbol = normalizeSymbol(summary.quoteSymbol)
    return baseSymbol === normalizedCoin || quoteSymbol === normalizedCoin
  })
}

const filterFeedSummaries = ({
  feedSummaries,
  baseSymbol,
  quoteSymbol,
  coinSymbol
}: {
  feedSummaries: PythFeedSummary[]
  baseSymbol?: string
  quoteSymbol?: string
  coinSymbol?: string
}) =>
  filterFeedSummariesByQuoteSymbol({
    feedSummaries: filterFeedSummariesByBaseSymbol({
      feedSummaries: filterFeedSummariesByCoinSymbol({
        feedSummaries,
        coinSymbol
      }),
      baseSymbol
    }),
    quoteSymbol
  })

const normalizeSymbol = (symbol?: string) =>
  symbol?.trim().toLowerCase() || undefined

const resolveQuerySymbolFilters = ({
  query,
  registryEntries
}: {
  query?: string
  registryEntries: CurrencyRegistryEntry[]
}): {
  baseSymbol?: string
  quoteSymbol?: string
  coinSymbol?: string
} => {
  if (!query || !query.includes("::")) return {}

  const parts = query
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return {}

  const resolvedSymbols = parts.map((part) =>
    resolveCoinFilterSymbol({ coinInput: part, registryEntries })
  )
  if (resolvedSymbols.length === 1) return { coinSymbol: resolvedSymbols[0] }

  return {
    baseSymbol: resolvedSymbols[0],
    quoteSymbol: resolvedSymbols[1]
  }
}

const resolveCoinFilterSymbol = ({
  coinInput,
  registryEntries
}: {
  coinInput?: string
  registryEntries: CurrencyRegistryEntry[]
}): string | undefined => {
  const normalizedInput = normalizeCoinInput(coinInput)
  if (!normalizedInput) return undefined

  const coinTypeCandidate = extractCoinTypeCandidate(normalizedInput)
  if (coinTypeCandidate) {
    const registryMatch = findRegistryEntryByCoinType(
      coinTypeCandidate,
      registryEntries
    )
    return registryMatch?.symbol ?? extractSymbolFromType(coinTypeCandidate)
  }

  const registrySymbolMatch = findRegistryEntryBySymbol(
    normalizedInput,
    registryEntries
  )
  return registrySymbolMatch?.symbol ?? normalizedInput
}

const normalizeCoinInput = (value?: string) => value?.trim() || undefined

const extractCoinTypeCandidate = (input: string) => {
  if (!input.includes("::")) return undefined

  const parts = input.split(/\s+/)
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index].includes("::")) return parts[index]
  }

  return undefined
}

const extractSymbolFromType = (coinType: string) => {
  const segments = coinType.split("::")
  return segments[segments.length - 1]
}

const findRegistryEntryByCoinType = (
  coinType: string,
  registryEntries: CurrencyRegistryEntry[]
) =>
  registryEntries.find(
    (entry) => entry.coinType.trim().toLowerCase() === coinType.toLowerCase()
  )

const findRegistryEntryBySymbol = (
  symbol: string,
  registryEntries: CurrencyRegistryEntry[]
) =>
  registryEntries.find(
    (entry) => normalizeSymbol(entry.symbol) === normalizeSymbol(symbol)
  )

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

const listCurrencyRegistryEntries = async ({
  registryId,
  suiClient
}: {
  registryId: string
  suiClient: SuiClient
}): Promise<CurrencyRegistryEntry[]> => {
  const currencyIds = await listCurrencyIds({
    registryId,
    suiClient
  })
  const currencyObjects = await fetchObjectsInChunks({
    ids: currencyIds,
    chunkSize: 50,
    suiClient
  })

  return currencyObjects
    .map((object) => parseCurrencyObject(object))
    .filter((entry): entry is CurrencyRegistryEntry => Boolean(entry))
}

type DynamicFieldName = {
  value?: {
    pos0?: string
  }
}

const listCurrencyIds = async ({
  registryId,
  suiClient
}: {
  registryId: string
  suiClient: SuiClient
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

const extractClaimedObjectId = (fieldName: DynamicFieldName) => {
  const candidate = fieldName.value?.pos0
  if (!candidate) return undefined
  try {
    return normalizeSuiObjectId(candidate)
  } catch {
    return undefined
  }
}

const parseCurrencyObject = (
  object: SuiObjectResponse
): CurrencyRegistryEntry | undefined => {
  const data = object.data
  if (!data?.type || !data.objectId) return undefined

  const match = data.type.match(/^0x2::coin_registry::Currency<(.+)>$/)
  if (!match) return undefined

  const content = data.content
  if (!content || content.dataType !== "moveObject") return undefined

  const fields = content.fields as Record<string, unknown>

  return {
    currencyId: normalizeSuiObjectId(data.objectId),
    coinType: match[1],
    symbol: readMoveString(fields.symbol),
    name: readMoveString(fields.name),
    decimals: readMoveNumber(fields.decimals),
    description: readMoveString(fields.description),
    iconUrl: readMoveString(fields.icon_url)
  }
}

const readMoveString = (value: unknown): string | undefined => {
  if (typeof value === "string") return value
  if (!value || typeof value !== "object") return undefined

  const record = value as Record<string, unknown>
  const fields = record.fields as Record<string, unknown> | undefined
  const bytes = fields?.bytes
  if (typeof bytes === "string") {
    try {
      return Buffer.from(bytes, "base64").toString("utf8")
    } catch {
      return undefined
    }
  }

  return undefined
}

const readMoveNumber = (value: unknown): number | undefined => {
  if (typeof value === "number") return value
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
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

const fetchObjectsInChunks = async ({
  ids,
  chunkSize,
  suiClient
}: {
  ids: string[]
  chunkSize: number
  suiClient: SuiClient
}): Promise<SuiObjectResponse[]> => {
  const chunks = splitIntoChunks(ids, chunkSize)
  const chunkResults = await Promise.all(
    chunks.map((chunk) =>
      suiClient.multiGetObjects({
        ids: chunk,
        options: { showType: true, showContent: true }
      })
    )
  )

  return chunkResults.flat()
}

const splitIntoChunks = <T>(items: T[], chunkSize: number) => {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }
  return chunks
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
