import type { SuiClient } from "@mysten/sui/client"

import type { NetworkName } from "./types.ts"

export type ToolingCoreContext = {
  suiClient: SuiClient
  networkName?: NetworkName
  rpcUrl?: string
}

/**
 * Identity helper for wiring a ToolingCoreContext.
 * Keeps context creation explicit and easy to mock when scripting against Sui RPCs.
 */
export const createToolingCoreContext = (
  context: ToolingCoreContext
): ToolingCoreContext => context
