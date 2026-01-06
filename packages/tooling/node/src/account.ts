import { normalizeSuiAddress } from "@mysten/sui/utils"

import { getAccountConfig, type SuiNetworkConfig } from "./config.ts"
import { loadKeypair } from "./keypair.ts"

/**
 * Resolves the effective owner address from explicit input, config, or keystore.
 * Adapts to Sui's keystore formats and account selection rules.
 */
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
