import type { Transaction } from "@mysten/sui/transactions"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import { DEFAULT_TX_GAS_BUDGET } from "./constants.ts"
import type { ToolingCoreContext } from "./context.ts"
import {
  buildSuiObjectRef,
  extractOwnerAddress,
  getSuiObject
} from "./object.ts"
import { newTransaction, resolveSplitCoinResult } from "./transactions.ts"
import { formatTypeName, parseTypeNameFromString } from "./utils/type-name.ts"
import { parseBalance } from "./utils/utility.ts"

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

type SuiCoinBalance = {
  coinObjectId: string
  balance: bigint
}

const selectRichestCoin = (coins: SuiCoinBalance[]) =>
  coins.reduce<SuiCoinBalance | undefined>((richest, coin) => {
    if (!richest) return coin
    return coin.balance > richest.balance ? coin : richest
  }, undefined)

const fetchSuiCoinBalances = async (
  { owner }: { owner: string },
  { suiClient }: ToolingCoreContext
): Promise<SuiCoinBalance[]> => {
  const coins: SuiCoinBalance[] = []
  let cursor: string | undefined = undefined

  do {
    const page = await suiClient.getCoins({
      owner,
      coinType: "0x2::sui::SUI",
      limit: 50,
      cursor
    })

    page.data.forEach((coin) => {
      coins.push({
        coinObjectId: normalizeSuiObjectId(coin.coinObjectId),
        balance: parseBalance(coin.balance)
      })
    })

    cursor = page.hasNextPage ? (page.nextCursor ?? undefined) : undefined
  } while (cursor)

  return coins
}

const hasDistinctGasCoin = ({
  coins,
  paymentMinimum,
  gasBudget,
  paymentCoinObjectId
}: {
  coins: SuiCoinBalance[]
  paymentMinimum: bigint
  gasBudget: bigint
  paymentCoinObjectId: string
}) => {
  const paymentCoin = coins.find(
    (coin) => coin.coinObjectId === paymentCoinObjectId
  )
  if (!paymentCoin || paymentCoin.balance < paymentMinimum) return false

  return coins.some(
    (gasCoin) =>
      gasCoin.coinObjectId !== paymentCoinObjectId &&
      gasCoin.balance >= gasBudget
  )
}

const buildSplitSuiCoinsTransaction = ({
  owner,
  splitAmounts,
  gasBudget
}: {
  owner: string
  splitAmounts: bigint[]
  gasBudget: number
}) => {
  if (splitAmounts.length === 0)
    throw new Error("Split transaction requires at least one split amount.")

  const amounts = splitAmounts.map((amount) => {
    if (amount <= 0n)
      throw new Error("Split amounts must be positive, non-zero values.")
    return amount
  })

  const transaction = newTransaction(gasBudget)
  transaction.setSender(owner)
  transaction.setGasOwner(owner)

  const splitResult = transaction.splitCoins(
    transaction.gas,
    amounts.map((amount) => transaction.pure.u64(amount))
  )

  amounts.forEach((_, index) => {
    const splitCoin = resolveSplitCoinResult(splitResult, index)
    transaction.transferObjects([splitCoin], transaction.pure.address(owner))
  })

  return transaction
}

export const planSuiPaymentSplitTransaction = async (
  {
    owner,
    paymentMinimum,
    gasBudget,
    splitGasBudget = DEFAULT_TX_GAS_BUDGET,
    paymentCoinObjectId
  }: {
    owner: string
    paymentMinimum: bigint
    gasBudget: bigint
    splitGasBudget?: number
    paymentCoinObjectId?: string
  },
  { suiClient }: ToolingCoreContext
): Promise<{
  needsSplit: boolean
  coinCount: number
  totalBalance: bigint
  paymentCoinObjectId: string
  transaction?: Transaction
}> => {
  if (paymentMinimum <= 0n)
    throw new Error("Payment amount must be a positive non-zero value.")
  if (gasBudget <= 0n)
    throw new Error("Gas budget must be a positive non-zero value.")

  const coins = await fetchSuiCoinBalances({ owner }, { suiClient })
  const totalBalance = coins.reduce((total, coin) => total + coin.balance, 0n)
  const normalizedPaymentCoinObjectId = paymentCoinObjectId
    ? normalizeSuiObjectId(paymentCoinObjectId)
    : undefined
  const paymentCoin = normalizedPaymentCoinObjectId
    ? coins.find((coin) => coin.coinObjectId === normalizedPaymentCoinObjectId)
    : selectRichestCoin(coins)

  if (normalizedPaymentCoinObjectId && !paymentCoin)
    throw new Error(
      `Payment coin ${normalizedPaymentCoinObjectId} not found for the signer.`
    )

  if (!paymentCoin) throw new Error("No SUI coin objects found for the signer.")

  if (paymentCoin.balance < paymentMinimum) {
    throw new Error(
      "No single SUI coin can cover the payment amount. Merge coins or fund a larger coin, then retry."
    )
  }

  if (
    hasDistinctGasCoin({
      coins,
      paymentMinimum,
      gasBudget,
      paymentCoinObjectId: paymentCoin.coinObjectId
    })
  ) {
    return {
      needsSplit: false,
      coinCount: coins.length,
      totalBalance,
      paymentCoinObjectId: paymentCoin.coinObjectId
    }
  }

  const requiredBalance = paymentMinimum + gasBudget + BigInt(splitGasBudget)
  if (paymentCoin.balance < requiredBalance) {
    throw new Error(
      "Insufficient SUI balance to cover payment plus gas. Fund more SUI, then retry."
    )
  }

  const transaction = buildSplitSuiCoinsTransaction({
    owner,
    splitAmounts: [gasBudget],
    gasBudget: splitGasBudget
  })
  const { object: gasPaymentObject } = await getSuiObject(
    {
      objectId: paymentCoin.coinObjectId,
      options: { showContent: false, showType: false }
    },
    { suiClient }
  )
  const gasPaymentRef = buildSuiObjectRef(gasPaymentObject)
  transaction.setGasOwner(owner)
  transaction.setGasPayment([gasPaymentRef])

  return {
    needsSplit: true,
    coinCount: coins.length,
    totalBalance,
    paymentCoinObjectId: paymentCoin.coinObjectId,
    transaction
  }
}
