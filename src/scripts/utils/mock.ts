import { writeArtifact } from "./artifacts.ts"
import { getArtifactPath } from "./constants.ts"

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

export const writeMockArtifact = writeArtifact<MockArtifact>({})

export const mockArtifactPath = getArtifactPath("mock")("localnet")
