import type {
  SuiClient,
  SuiTransactionBlockResponse,
  SuiTransactionBlockResponseOptions
} from "@mysten/sui/client"

const defaultTransactionBlockOptions: SuiTransactionBlockResponseOptions = {
  showEffects: true,
  showObjectChanges: true,
  showEvents: true,
  showBalanceChanges: true,
  showInput: true
}

export const waitForTransactionBlock = async (
  suiClient: SuiClient,
  digest: string,
  options: SuiTransactionBlockResponseOptions = defaultTransactionBlockOptions
): Promise<SuiTransactionBlockResponse> =>
  suiClient.waitForTransaction({ digest, options })
