import { deriveCurrencyObjectId } from "@sui-oracle-market/tooling-core/coin-registry"
import { SUI_COIN_REGISTRY_ID } from "@sui-oracle-market/tooling-core/constants"

export const resolveCurrencyRegistryId = (coinType: string) => {
  try {
    return deriveCurrencyObjectId(coinType, SUI_COIN_REGISTRY_ID)
  } catch {
    return undefined
  }
}
