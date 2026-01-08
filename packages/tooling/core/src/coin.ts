import type { ToolingCoreContext } from "./context.ts"
import { extractOwnerAddress, getSuiObject } from "./object.ts"
import { newTransaction, resolveSplitCoinResult } from "./transactions.ts"
import { formatTypeName, parseTypeNameFromString } from "./utils/type-name.ts"

/**
 * Builds a transaction that splits a Coin object and transfers the split amount.
 */
export const buildCoinTransferTransaction = ({
  coinObjectId,
  amount,
  recipientAddress
}: {
  coinObjectId: string
  amount: bigint
  recipientAddress: string
}) => {
  const transaction = newTransaction()
  const coinArgument = transaction.object(coinObjectId)
  const splitResult = transaction.splitCoins(coinArgument, [
    transaction.pure.u64(amount)
  ])
  const transferCoin = resolveSplitCoinResult(splitResult, 0)

  transaction.transferObjects(
    [transferCoin],
    transaction.pure.address(recipientAddress)
  )

  return transaction
}

export type CoinOwnershipSnapshot = {
  coinType: string
  ownerAddress: string
}

export const extractCoinType = (objectType?: string): string => {
  if (!objectType)
    throw new Error("Coin object is missing its type information.")

  if (!objectType.includes("::coin::Coin<"))
    throw new Error(`Object ${objectType} is not a Coin object.`)

  return objectType
}

export const normalizeCoinType = (coinType: string): string => {
  const trimmed = coinType.trim()
  if (!trimmed) throw new Error("coinType cannot be empty.")

  return formatTypeName(parseTypeNameFromString(trimmed))
}

export const normalizeOptionalCoinType = (coinType?: string) =>
  coinType ? normalizeCoinType(coinType) : undefined

export const resolveCoinOwnership = async (
  {
    coinObjectId
  }: {
    coinObjectId: string
  },
  { suiClient }: ToolingCoreContext
): Promise<CoinOwnershipSnapshot> => {
  const { object, owner } = await getSuiObject(
    {
      objectId: coinObjectId,
      options: { showOwner: true, showType: true }
    },
    { suiClient }
  )

  const coinType = extractCoinType(object.type || undefined)
  const ownerAddress = extractOwnerAddress(owner)

  return {
    coinType,
    ownerAddress
  }
}
