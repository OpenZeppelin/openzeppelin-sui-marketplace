export type NetworkName =
  | "mainnet"
  | "testnet"
  | "devnet"
  | "localnet"
  | "custom"

export enum ENetwork {
  LOCALNET = "localnet",
  DEVNET = "devnet",
  TESTNET = "testnet",
  MAINNET = "mainnet"
}

export type BuildOutput = {
  modules: string[]
  dependencies: string[]
}

export type PublishResult = {
  packages: PublishedPackage[]
  digest: string
}

export type PublishArtifact = {
  network: string
  rpcUrl: string
  packagePath: string
  packageName?: string
  packageId: string
  upgradeCap?: string
  publisherId?: string
  isDependency?: boolean
  sender: string
  digest: string
  publishedAt: string
  modules: string[]
  dependencies: string[]
  dependencyAddresses?: Record<string, string>
  explorerUrl?: string
  withUnpublishedDependencies?: boolean
  unpublishedDependencies?: string[]
  suiCliVersion?: string
}

export type PublishedPackage = {
  packageId: string
  packageName?: string
  upgradeCap?: string
  publisherId?: string
  isDependency?: boolean
}

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
