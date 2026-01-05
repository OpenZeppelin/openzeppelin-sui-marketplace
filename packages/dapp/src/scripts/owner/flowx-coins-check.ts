/**
 * Fetches FlowX testnet's "global coins" list and checks each coin for:
 * 1) Presence in Sui's shared coin registry (Currency<T> object exists).
 * 2) Presence of a Pyth price feed (and PriceInfoObject id) for the coin symbol.
 *
 * This is useful when you want "easy to get" testnet coins (via FlowX) that are also
 * compatible with scripts that require coin-registry + Pyth config.
 */
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import {
  requirePythPullOracleConfig,
  resolvePythPullOracleConfigWithOverrides
} from "@sui-oracle-market/domain-core/models/pyth"
import {
  createPythClient,
  listPythFeedSummaries,
  normalizeSymbol,
  resolvePythPriceInfoObjectId,
  type PythFeedSummary
} from "@sui-oracle-market/domain-core/models/pyth-feeds"
import type { CurrencyRegistryEntry } from "@sui-oracle-market/tooling-core/coin-registry"
import {
  formatTypeName,
  parseTypeNameFromString
} from "@sui-oracle-market/tooling-core/utils/type-name"
import { SUI_COIN_REGISTRY_ID } from "@sui-oracle-market/tooling-node/constants"
import { emitJsonOutput } from "@sui-oracle-market/tooling-node/json"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"

type FlowxCoinsCheckArguments = {
  flowxCoinsUrl?: string
  registryId?: string
  hermesUrl?: string
  pythStateId?: string
  wormholeStateId?: string
  quote?: string
  json?: boolean
}

type FlowxCoin = {
  type: string
  symbol?: string
  name?: string
  decimals?: number
  isVerified?: boolean
  iconUrl?: string
}

type PythCoinMatch = {
  feedId: string
  baseSymbol?: string
  quoteSymbol?: string
  priceInfoObjectId?: string
}

type FlowxCoinCheckResult = {
  flowx: {
    coinType: string
    symbol?: string
    name?: string
    decimals?: number
    isVerified?: boolean
    iconUrl?: string
    sourceUrl: string
  }
  registry?: {
    inRegistry: boolean
    currencyId?: string
    registrySymbol?: string
  }
  pyth?: {
    hasFeed: boolean
    feedId?: string
    priceInfoObjectId?: string
    baseSymbol?: string
    quoteSymbol?: string
  }
}

const DEFAULT_FLOWX_TESTNET_COINS_URL =
  "https://flowx-dev.flowx.finance/flowx-be/api/global-coin/coins"

runSuiScript(
  async (tooling, cliArguments: FlowxCoinsCheckArguments) => {
    const flowxCoinsUrl =
      cliArguments.flowxCoinsUrl ?? DEFAULT_FLOWX_TESTNET_COINS_URL

    const registryId = normalizeSuiObjectId(
      cliArguments.registryId ?? SUI_COIN_REGISTRY_ID
    )

    const quoteSymbol = normalizeSymbol(cliArguments.quote ?? "USD")

    const pythPullConfig = resolvePythPullConfigOrThrow(
      tooling.network.networkName,
      cliArguments
    )

    const flowxCoins = await fetchFlowxCoins(flowxCoinsUrl)
    const normalizedFlowxCoins = flowxCoins
      .map((coin) => ({
        ...coin,
        type: normalizeCoinTypeFromMaybeGarbage(coin.type)
      }))
      .filter((coin): coin is FlowxCoin & { type: string } =>
        Boolean(coin.type)
      )

    const uniqueFlowxCoinTypes = unique(
      normalizedFlowxCoins.map((coin) =>
        normalizeCoinTypeOrUndefined(coin.type)
      )
    ).filter((value): value is string => Boolean(value))

    const uniqueFlowxSymbols = new Set(
      normalizedFlowxCoins
        .map((coin) => normalizeSymbol(coin.symbol))
        .filter((value): value is string => Boolean(value))
    )

    // 1) Load coin registry entries so we can check membership by coin type.
    const registryEntries = await tooling.listCurrencyRegistryEntries({
      registryId
    })

    const registryByCoinType = new Map<string, CurrencyRegistryEntry>()
    registryEntries.forEach((entry) => {
      const normalizedType = normalizeCoinTypeOrUndefined(entry.coinType)
      if (!normalizedType) return
      registryByCoinType.set(normalizedType, entry)
    })

    // 2) Load Pyth feeds and keep only those relevant to FlowX coins.
    const pythClient = createPythClient({
      suiClient: tooling.suiClient,
      pythStateId: pythPullConfig.pythStateId,
      wormholeStateId: pythPullConfig.wormholeStateId
    })

    const pythFeeds = await listPythFeedSummaries({
      hermesUrl: pythPullConfig.hermesUrl,
      query: undefined,
      assetType: undefined
    })

    const pythMatchesBySymbol = await buildPythMatchesBySymbol({
      pythClient,
      pythFeeds,
      flowxSymbols: uniqueFlowxSymbols,
      quoteSymbol
    })

    const results: FlowxCoinCheckResult[] = normalizedFlowxCoins.map((coin) => {
      const normalizedType = normalizeCoinTypeOrUndefined(coin.type)
      const registryEntry = normalizedType
        ? registryByCoinType.get(normalizedType)
        : undefined

      const flowxSymbol = normalizeSymbol(coin.symbol)
      const pythMatch = flowxSymbol
        ? pythMatchesBySymbol.get(flowxSymbol)
        : undefined

      return {
        flowx: {
          coinType: coin.type,
          symbol: coin.symbol,
          name: coin.name,
          decimals: coin.decimals,
          isVerified: coin.isVerified,
          iconUrl: coin.iconUrl,
          sourceUrl: flowxCoinsUrl
        },
        registry: {
          inRegistry: Boolean(registryEntry),
          currencyId: registryEntry?.currencyId,
          registrySymbol: undefined
        },
        pyth: {
          hasFeed: Boolean(pythMatch),
          feedId: pythMatch?.feedId,
          priceInfoObjectId: pythMatch?.priceInfoObjectId,
          baseSymbol: pythMatch?.baseSymbol,
          quoteSymbol: pythMatch?.quoteSymbol
        }
      }
    })

    const eligible = results.filter(
      (row) => row.registry?.inRegistry && row.pyth?.hasFeed
    )

    if (
      emitJsonOutput(
        {
          network: tooling.network.networkName,
          flowxCoinsUrl,
          registryId,
          quote: quoteSymbol ?? "USD",
          counts: {
            flowxCoinsRaw: flowxCoins.length,
            flowxCoinsParsed: normalizedFlowxCoins.length,
            flowxUniqueCoinTypes: uniqueFlowxCoinTypes.length,
            registryEntries: registryEntries.length,
            eligible: eligible.length
          },
          results,
          eligible
        },
        cliArguments.json
      )
    )
      return

    console.log(`Network: ${tooling.network.networkName}`)
    console.log(`FlowX coins url: ${flowxCoinsUrl}`)
    console.log(`Registry id: ${registryId}`)
    console.log(`Quote symbol: ${quoteSymbol ?? "USD"}`)
    console.log("")
    console.log(
      `FlowX coins: ${flowxCoins.length} (parsed: ${normalizedFlowxCoins.length}, unique types: ${uniqueFlowxCoinTypes.length})`
    )
    console.log(`Registry entries: ${registryEntries.length}`)
    console.log(`Eligible (registry + Pyth): ${eligible.length}`)
    console.log("")

    eligible
      .sort((a, b) =>
        (a.flowx.symbol ?? "").localeCompare(b.flowx.symbol ?? "")
      )
      .forEach((row) => {
        console.log(
          `${row.flowx.symbol ?? "?"}\t${row.flowx.coinType}\t${row.registry?.currencyId ?? "-"}\t${row.pyth?.feedId ?? "-"}\t${row.pyth?.priceInfoObjectId ?? "-"}`
        )
      })
  },
  yargs()
    .option("flowxCoinsUrl", {
      alias: ["flowx-coins-url"],
      type: "string",
      description:
        "FlowX coins API endpoint (defaults to FlowX dev/testnet global coin list)."
    })
    .option("registryId", {
      alias: ["registry-id"],
      type: "string",
      description:
        "Coin registry object id; defaults to the shared Sui coin registry."
    })
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
    .option("quote", {
      alias: ["quote-symbol"],
      type: "string",
      default: "USD",
      description: "Preferred quote symbol for Pyth feeds (default: USD)."
    })
    .option("json", {
      type: "boolean",
      default: false,
      description: "Output full results as JSON."
    })
    .strict()
)

const resolvePythPullConfigOrThrow = (
  networkName: string,
  cliArguments: FlowxCoinsCheckArguments
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

const unique = <T>(values: T[]) => Array.from(new Set(values))

const normalizeCoinTypeOrUndefined = (coinType: string) => {
  try {
    return formatTypeName(parseTypeNameFromString(coinType))
  } catch {
    return undefined
  }
}

const normalizeCoinTypeFromMaybeGarbage = (raw: string) => {
  const trimmed = raw.trim()
  const normalized = normalizeCoinTypeOrUndefined(trimmed)
  if (normalized) return normalized

  // Some FlowX entries occasionally contain prefix text; salvage the first type-like substring.
  const match = trimmed.match(/(0x[0-9a-fA-F]+::[A-Za-z0-9_]+::[A-Za-z0-9_]+)/)
  if (!match) return trimmed

  return normalizeCoinTypeOrUndefined(match[1]) ?? trimmed
}

const fetchFlowxCoins = async (url: string): Promise<FlowxCoin[]> => {
  const response = await fetch(url)
  if (!response.ok)
    throw new Error(`Failed to fetch FlowX coin list (${response.status}).`)

  const payload = (await response.json()) as unknown
  if (!payload || typeof payload !== "object") return []

  const record = payload as Record<string, unknown>
  const data = record.data
  if (!Array.isArray(data)) return []

  return data
    .map((row) => parseFlowxCoin(row))
    .filter((coin): coin is FlowxCoin => Boolean(coin))
}

const parseFlowxCoin = (value: unknown): FlowxCoin | undefined => {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  const type = typeof record.type === "string" ? record.type : undefined
  if (!type) return undefined

  return {
    type,
    symbol: typeof record.symbol === "string" ? record.symbol : undefined,
    name: typeof record.name === "string" ? record.name : undefined,
    decimals:
      typeof record.decimals === "number"
        ? record.decimals
        : typeof record.decimals === "string"
          ? Number(record.decimals)
          : undefined,
    isVerified:
      typeof record.isVerified === "boolean" ? record.isVerified : undefined,
    iconUrl: typeof record.iconUrl === "string" ? record.iconUrl : undefined
  }
}

const buildPythMatchesBySymbol = async ({
  pythClient,
  pythFeeds,
  flowxSymbols,
  quoteSymbol
}: {
  pythClient: ReturnType<typeof createPythClient>
  pythFeeds: PythFeedSummary[]
  flowxSymbols: Set<string>
  quoteSymbol?: string
}): Promise<Map<string, PythCoinMatch>> => {
  const matches = new Map<string, PythCoinMatch>()

  const filteredFeeds = pythFeeds.filter((feed) => {
    const base = normalizeSymbol(feed.baseSymbol)
    if (!base || !flowxSymbols.has(base)) return false

    const quote = normalizeSymbol(feed.quoteSymbol)
    if (quoteSymbol && quote && quote !== quoteSymbol) return false

    return true
  })

  // Prefer one feed per base symbol; pick the first match.
  for (const feed of filteredFeeds) {
    const base = normalizeSymbol(feed.baseSymbol)
    if (!base || matches.has(base)) continue

    const priceInfoObjectId = await resolvePythPriceInfoObjectId({
      pythClient,
      feedId: feed.feedId
    })

    matches.set(base, {
      feedId: feed.feedId,
      baseSymbol: feed.baseSymbol,
      quoteSymbol: feed.quoteSymbol,
      priceInfoObjectId
    })
  }

  return matches
}
