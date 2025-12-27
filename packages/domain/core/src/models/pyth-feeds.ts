import type { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import {
  SuiPriceServiceConnection,
  SuiPythClient
} from "@pythnetwork/pyth-sui-js"

export type HermesFeedMetadata = {
  id?: string
  symbol?: string
  description?: string
  attributes?: {
    base?: string
    quote?: string
    asset_type?: string
    assetType?: string
    symbol?: string
    description?: string
  }
  product?: {
    symbol?: string
    description?: string
    asset_type?: string
    assetType?: string
  }
  price_feed_id?: string
  priceFeedId?: string
  feedId?: string
}

export type HermesFeedQuery = {
  query?: string
  assetType?: string
}

export type PythFeedSummary = {
  feedId: string
  symbol?: string
  description?: string
  baseSymbol?: string
  quoteSymbol?: string
  assetType?: string
}

type HermesRequestOptions = {
  query?: string
  assetType?: string
  asset_type?: string
}

type HermesConnectionLike = {
  getPriceFeeds?: (options?: HermesRequestOptions) => Promise<unknown>
  getPriceFeedsMetadata?: (options?: HermesRequestOptions) => Promise<unknown>
  getPriceFeedIds?: () => Promise<unknown>
}

export const listPythFeedSummaries = async ({
  hermesUrl,
  query,
  assetType
}: {
  hermesUrl: string
  query?: string
  assetType?: string
}): Promise<PythFeedSummary[]> => {
  const feedMetadata = await listHermesFeedMetadata({
    hermesUrl,
    query,
    assetType
  })

  return feedMetadata
    .map((feed) => mapHermesFeedToSummary(feed))
    .filter((feed): feed is PythFeedSummary => Boolean(feed))
}

export const listHermesFeedMetadata = async ({
  hermesUrl,
  query,
  assetType
}: {
  hermesUrl: string
  query?: string
  assetType?: string
}): Promise<HermesFeedMetadata[]> => {
  const connection = new SuiPriceServiceConnection(hermesUrl)
  const requestOptions = buildHermesRequestOptions({ query, assetType })

  const connectionFeeds = await fetchHermesFeedsFromConnection(
    connection as HermesConnectionLike,
    requestOptions
  )

  if (connectionFeeds.length > 0) return connectionFeeds

  return await fetchHermesFeedsFromHttp({ hermesUrl, query, assetType })
}

export const createPythClient = ({
  suiClient,
  pythStateId,
  wormholeStateId
}: {
  suiClient: SuiClient
  pythStateId: string
  wormholeStateId: string
}) => new SuiPythClient(suiClient, pythStateId, wormholeStateId)

export const resolvePythPriceInfoObjectId = async ({
  pythClient,
  feedId
}: {
  pythClient: SuiPythClient
  feedId: string
}): Promise<string | undefined> => {
  try {
    const objectId = await pythClient.getPriceFeedObjectId(feedId)
    return objectId ? normalizeSuiObjectId(objectId) : undefined
  } catch {
    return undefined
  }
}

export const normalizePythFeedId = (feedId: string) =>
  feedId.startsWith("0x") ? feedId : `0x${feedId}`

const buildHermesRequestOptions = ({
  query,
  assetType
}: HermesFeedQuery): HermesRequestOptions => ({
  query,
  assetType,
  asset_type: assetType
})

const fetchHermesFeedsFromConnection = async (
  connection: HermesConnectionLike,
  requestOptions: HermesRequestOptions
): Promise<HermesFeedMetadata[]> => {
  const candidates = [
    () => connection.getPriceFeeds?.(requestOptions),
    () => connection.getPriceFeedsMetadata?.(requestOptions),
    () =>
      connection
        .getPriceFeedIds?.()
        .then((ids) => normalizePriceFeedIdsResponse(ids))
  ]

  for (const candidate of candidates) {
    try {
      const result = await candidate()
      const feedMetadata = unwrapHermesFeeds(result)
      if (feedMetadata.length > 0) return feedMetadata
    } catch {
      // Keep trying other Hermes endpoints.
    }
  }

  return []
}

const fetchHermesFeedsFromHttp = async ({
  hermesUrl,
  query,
  assetType
}: {
  hermesUrl: string
  query?: string
  assetType?: string
}): Promise<HermesFeedMetadata[]> => {
  const params = new URLSearchParams()
  if (query) params.set("query", query)
  if (assetType) params.set("asset_type", assetType)

  const feedsResponse = await fetch(
    `${hermesUrl}/api/price_feeds${params.toString() ? `?${params}` : ""}`
  )
  if (feedsResponse.ok) {
    const data = await feedsResponse.json()
    const feeds = unwrapHermesFeeds(data)
    if (feeds.length > 0) return feeds
  }

  const idsResponse = await fetch(`${hermesUrl}/api/price_feed_ids`)
  if (!idsResponse.ok) return []

  const ids = await idsResponse.json()
  return normalizePriceFeedIdsResponse(ids)
}

const unwrapHermesFeeds = (value: unknown): HermesFeedMetadata[] => {
  if (Array.isArray(value)) return value as HermesFeedMetadata[]
  if (!value || typeof value !== "object") return []

  const record = value as Record<string, unknown>
  const candidates = [
    record.price_feeds,
    record.priceFeeds,
    record.data
  ].filter(Array.isArray) as HermesFeedMetadata[][]

  return candidates.length > 0 ? candidates[0] : []
}

const normalizePriceFeedIdsResponse = (
  value: unknown
): HermesFeedMetadata[] => {
  if (Array.isArray(value)) return value.map((id) => ({ id }))

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    if (Array.isArray(record.price_feed_ids))
      return record.price_feed_ids.map((id) => ({ id }))
  }

  return []
}

const mapHermesFeedToSummary = (
  feed: HermesFeedMetadata
): PythFeedSummary | undefined => {
  const feedId = resolveFeedId(feed)
  if (!feedId) return undefined

  const symbol = resolveSymbol(feed)
  const description = resolveDescription(feed)
  const { base, quote } = resolveBaseQuote(feed, symbol)
  const assetType = resolveAssetType(feed)

  return {
    feedId,
    symbol,
    description,
    baseSymbol: base,
    quoteSymbol: quote,
    assetType
  }
}

const resolveFeedId = (feed: HermesFeedMetadata): string | undefined => {
  const candidate =
    feed.id ?? feed.price_feed_id ?? feed.priceFeedId ?? feed.feedId

  if (!candidate || candidate.length === 0) return undefined
  return normalizePythFeedId(candidate)
}

const resolveSymbol = (feed: HermesFeedMetadata): string | undefined =>
  feed.symbol ??
  feed.attributes?.symbol ??
  feed.product?.symbol ??
  readStringField(feed, "symbol")

const resolveDescription = (feed: HermesFeedMetadata): string | undefined =>
  feed.description ??
  feed.attributes?.description ??
  feed.product?.description ??
  readStringField(feed, "description")

const resolveAssetType = (feed: HermesFeedMetadata): string | undefined =>
  feed.attributes?.asset_type ??
  feed.attributes?.assetType ??
  feed.product?.asset_type ??
  feed.product?.assetType ??
  readStringField(feed, "asset_type")

const resolveBaseQuote = (
  feed: HermesFeedMetadata,
  symbol?: string
): { base?: string; quote?: string } => {
  const baseSymbol = feed.attributes?.base ?? parseSymbolPart(symbol, "base")
  const quoteSymbol = feed.attributes?.quote ?? parseSymbolPart(symbol, "quote")
  return { base: baseSymbol, quote: quoteSymbol }
}

const parseSymbolPart = (
  symbol: string | undefined,
  part: "base" | "quote"
): string | undefined => {
  if (!symbol) return undefined

  const [base, quote] = symbol.split("/")
  const rawValue = part === "base" ? base : quote
  if (!rawValue) return undefined

  const trimmed = rawValue.trim()
  if (trimmed.length === 0) return undefined

  const segments = trimmed.split(".")
  return segments[segments.length - 1]
}

const readStringField = (feed: HermesFeedMetadata, key: string) => {
  const record = feed as Record<string, unknown>
  const candidate = record[key]
  return typeof candidate === "string" ? candidate : undefined
}
