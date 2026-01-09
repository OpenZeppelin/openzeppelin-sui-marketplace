import { SuiClient } from "@mysten/sui/client"

/**
 * Creates a Sui client bound to the provided RPC URL.
 */
export const createSuiClient = (rpcUrl: string) =>
  new SuiClient({ url: rpcUrl })
