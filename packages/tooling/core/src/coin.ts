import type { TransactionArgument } from "@mysten/sui/transactions"
import { newTransaction } from "./transactions.ts"

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
  const transferCoin = unwrapSplitCoin(splitResult)

  transaction.transferObjects(
    [transferCoin],
    transaction.pure.address(recipientAddress)
  )

  return transaction
}

const unwrapSplitCoin = (
  splitResult: TransactionArgument | TransactionArgument[]
) => (Array.isArray(splitResult) ? splitResult[0] : splitResult)
