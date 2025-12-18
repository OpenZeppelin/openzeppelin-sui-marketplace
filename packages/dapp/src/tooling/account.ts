import { normalizeSuiAddress } from "@mysten/sui/utils"

import { getAccountConfig, type SuiNetworkConfig } from "./config.ts"
import { loadKeypair } from "./keypair.ts"

export const resolveOwnerAddress = async (
  providedAddress: string | undefined,
  networkConfig: SuiNetworkConfig
): Promise<string> => {
  if (providedAddress) return normalizeSuiAddress(providedAddress)

  const accountConfig = getAccountConfig(networkConfig)

  if (accountConfig.accountAddress)
    return normalizeSuiAddress(accountConfig.accountAddress)

  const keypair = await loadKeypair(accountConfig)
  return normalizeSuiAddress(keypair.toSuiAddress())
}
