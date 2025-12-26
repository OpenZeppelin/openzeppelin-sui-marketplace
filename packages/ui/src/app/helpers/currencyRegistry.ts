import { deriveCurrencyObjectId } from "@sui-oracle-market/domain-core/ptb/currency"
import { SUI_COIN_REGISTRY_ID } from "@sui-oracle-market/tooling-core/constants"

export const resolveCurrencyRegistryId = (coinType: string) => {
  try {
    return deriveCurrencyObjectId(coinType, SUI_COIN_REGISTRY_ID)
  } catch {
    return undefined
  }
}
