import type { SuiClient } from "@mysten/sui/client"

import type { NetworkName } from "./types.ts"

export type ToolingCoreContext = {
  suiClient: SuiClient
  networkName?: NetworkName
  rpcUrl?: string
}

export const createToolingCoreContext = (
  context: ToolingCoreContext
): ToolingCoreContext => context
