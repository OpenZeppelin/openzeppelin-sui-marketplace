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
  dependencyAddresses?: Record<string, string>
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
