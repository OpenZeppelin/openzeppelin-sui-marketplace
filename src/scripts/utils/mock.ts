import { getArtifactPath, writeArtifact } from "./artifacts.ts"

export type MockArtifact = Partial<{
  pythPackageId: string
  coinPackageId: string
  shop: {
    packageId: string
    upgradeCapId?: string
    publisherId?: string
    shopId?: string
    shopOwnerCapId?: string
    shopInitialSharedVersion?: number
  }
  priceFeeds: {
    label: string
    feedIdHex: string
    priceInfoObjectId: string
  }[]
  coins: {
    label: string
    coinType: string
    currencyObjectId: string
    treasuryCapId?: string
    metadataObjectId?: string
    mintedCoinObjectId?: string
  }[]
  acceptedCurrencies: {
    label: string
    coinType: string
    feedIdHex: string
    priceInfoObjectId: string
    acceptedCurrencyId: string
    shopId: string
    initialSharedVersion?: number
  }[]
  itemListings: {
    label: string
    itemListingId: string
    itemType: string
    basePriceUsdCents: number
    stock: number
    shopId: string
    initialSharedVersion?: number
  }[]
}>

/**
 * Persists mock deployment state (mock packages, coins, price feeds, shop objects) to disk.
 * This lets repeated localnet runs reuse published mocks instead of republishing every time.
 */
export const writeMockArtifact = writeArtifact<MockArtifact>({})

export const mockArtifactPath = getArtifactPath("mock")("localnet")
