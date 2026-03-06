import {
  getArtifactPath,
  writeArtifact
} from "@sui-oracle-market/tooling-node/artifacts"

export type MockArtifact = Partial<{
  pythPackageId: string
  coinPackageId: string
  itemPackageId: string
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
  itemTypes: {
    label: string
    itemType: string
  }[]
  acceptedCurrencies: {
    label: string
    coinType: string
    feedIdHex: string
    priceInfoObjectId: string
    tableEntryFieldId: string
    shopId: string
    initialSharedVersion?: number
  }[]
}>

export type CoinArtifact = NonNullable<MockArtifact["coins"]>[number]
export type ItemTypeArtifact = NonNullable<MockArtifact["itemTypes"]>[number]
export type PriceFeedArtifact = NonNullable<MockArtifact["priceFeeds"]>[number]

/**
 * Persists mock deployment state (mock packages, coins, price feeds, shop objects) to disk.
 * This lets repeated localnet runs reuse published mocks instead of republishing every time.
 */
export const writeMockArtifact = writeArtifact<MockArtifact>({})

export const mockArtifactPath = getArtifactPath("mock")("localnet")
