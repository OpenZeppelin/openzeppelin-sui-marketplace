export type TCustomNetworkConfig = {
  networkKey: string
  label: string
  rpcUrl: string
  explorerUrl: string
  contractPackageId: string
}

export type TCustomNetworkDraft = TCustomNetworkConfig

export type TCustomNetworkErrors = Partial<
  Record<keyof TCustomNetworkDraft, string>
>
