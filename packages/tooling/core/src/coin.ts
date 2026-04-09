import type {
  SuiObjectRef,
  SuiTransactionBlockResponse
} from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import { NORMALIZED_SUI_COIN_TYPE } from "./constants.ts"
import type { ToolingCoreContext } from "./context.ts"
import { extractOwnerAddress, getSuiObject } from "./object.ts"
import { extractCreatedObjects } from "./transactions.ts"
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

const parseCoinStructTypeArgument = (
  objectType: string
): string | undefined => {
  const coinPrefix = "::coin::Coin<"
  const prefixIndex = objectType.indexOf(coinPrefix)
  if (prefixIndex < 0) return undefined

  const argumentStart = prefixIndex + coinPrefix.length
  const argumentEnd = objectType.lastIndexOf(">")
  if (argumentEnd <= argumentStart) return undefined

  return objectType.slice(argumentStart, argumentEnd)
}

const doesObjectTypeMatchCoinType = ({
  objectType,
  coinType
}: {
  objectType: string
  coinType: string
}) => {
  const structTypeArgument = parseCoinStructTypeArgument(objectType)
  if (!structTypeArgument) return false
  return normalizeCoinType(structTypeArgument) === normalizeCoinType(coinType)
}

/**
 * Finds created Coin<T> object references for a target coin type in a transaction result.
 */
export const findCreatedCoinObjectRefs = (
  transactionBlock: SuiTransactionBlockResponse,
  coinType: string
): SuiObjectRef[] =>
  extractCreatedObjects(transactionBlock)
    .filter(
      (createdObject) =>
        createdObject.objectType &&
        doesObjectTypeMatchCoinType({
          objectType: createdObject.objectType,
          coinType
        })
    )
    .map(
      (createdObject): SuiObjectRef => ({
        objectId: normalizeSuiObjectId(createdObject.objectId),
        version: createdObject.version,
        digest: createdObject.digest
      })
    )

export const pickDedicatedGasPaymentRefFromSplit = ({
  splitTransactionBlock,
  paymentCoinObjectId
}: {
  splitTransactionBlock: SuiTransactionBlockResponse
  paymentCoinObjectId: string
}): SuiObjectRef | undefined => {
  const normalizedPaymentCoinObjectId =
    normalizeSuiObjectId(paymentCoinObjectId)

  return findCreatedCoinObjectRefs(
    splitTransactionBlock,
    NORMALIZED_SUI_COIN_TYPE
  ).find(
    (candidateObjectRef) =>
      normalizeSuiObjectId(candidateObjectRef.objectId) !==
      normalizedPaymentCoinObjectId
  )
}

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
