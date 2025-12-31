import { extractCoinType } from "@sui-oracle-market/domain-core/models/currency"
import { extractOwnerAddress } from "@sui-oracle-market/tooling-core/object"
import type { Tooling } from "@sui-oracle-market/tooling-node/factory"

export type CoinOwnershipSnapshot = {
  coinType: string
  ownerAddress: string
}

export const resolveCoinOwnershipSnapshot = async ({
  coinObjectId,
  getSuiObject
}: {
  coinObjectId: string
  getSuiObject: Tooling["getSuiObject"]
}): Promise<CoinOwnershipSnapshot> => {
  const { object, owner } = await getSuiObject({
    objectId: coinObjectId,
    options: { showOwner: true, showType: true }
  })

  const coinType = extractCoinType(object.type || undefined)
  const ownerAddress = extractOwnerAddress(owner)

  return {
    coinType,
    ownerAddress
  }
}
