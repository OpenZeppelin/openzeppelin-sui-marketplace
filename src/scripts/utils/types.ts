export type NetworkName =
  | "mainnet"
  | "testnet"
  | "devnet"
  | "localnet"
  | "custom"

export type BuildOutput = {
  modules: string[]
  dependencies: string[]
}

export type PublishResult = {
  packageId?: string
  upgradeCap?: string
  digest: string
}

export type PublishArtifact = {
  network: string
  rpcUrl: string
  packagePath: string
  packageId: string
  upgradeCap?: string
  sender: string
  digest: string
  publishedAt: string
  modules: string[]
  dependencies: string[]
  explorerUrl?: string
}
