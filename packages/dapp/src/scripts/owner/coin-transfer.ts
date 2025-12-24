/**
 * Splits a Coin object and transfers a specified amount to another address.
 * On Sui, coins are objects, so transfers are object splits/merges rather than balance updates.
 * If you come from EVM, there is no allowance or transferFrom here; the signer must own the Coin object.
 * This script validates ownership, builds a PTB, and reports the transfer digest.
 */
import type { ObjectOwner } from "@mysten/sui/client"
import type { TransactionArgument } from "@mysten/sui/transactions"
import { normalizeSuiAddress, normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { parsePositiveU64 } from "@sui-oracle-market/tooling-core/utils/utility"
import type { Tooling } from "@sui-oracle-market/tooling-node/factory"
import { logKeyValueGreen } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { newTransaction } from "@sui-oracle-market/tooling-node/transactions"

type TransferCoinArguments = {
  coinId: string
  amount: string
  recipient: string
}

type NormalizedInputs = {
  coinObjectId: string
  amount: bigint
  recipientAddress: string
}

type CoinOwnershipSnapshot = {
  coinType: string
  ownerAddress: string
}

type GetSuiObject = Tooling["getSuiObject"]

runSuiScript(
  async (tooling, cliArguments) => {
    const inputs = normalizeInputs(cliArguments)
    const signerAddress = tooling.loadedEd25519KeyPair.toSuiAddress()

    const coinSnapshot = await resolveCoinOwnershipSnapshot({
      coinObjectId: inputs.coinObjectId,
      getSuiObject: tooling.getSuiObject
    })

    ensureSignerOwnsCoin({
      coinObjectId: inputs.coinObjectId,
      coinOwnerAddress: coinSnapshot.ownerAddress,
      signerAddress
    })

    const transferTransaction = buildCoinTransferTransaction({
      coinObjectId: inputs.coinObjectId,
      amount: inputs.amount,
      recipientAddress: inputs.recipientAddress
    })

    const { transactionResult } = await tooling.signAndExecute({
      transaction: transferTransaction,
      signer: tooling.loadedEd25519KeyPair
    })

    logTransferSummary({
      coinObjectId: inputs.coinObjectId,
      coinType: coinSnapshot.coinType,
      amount: inputs.amount,
      recipientAddress: inputs.recipientAddress,
      senderAddress: signerAddress,
      digest: transactionResult.digest
    })
  },
  yargs()
    .option("coinId", {
      alias: ["coin-id", "coin"],
      type: "string",
      description: "Coin object ID to split and transfer from",
      demandOption: true
    })
    .option("amount", {
      type: "string",
      description: "Amount to transfer from the coin object (u64)",
      demandOption: true
    })
    .option("recipient", {
      alias: ["recipient-address", "to"],
      type: "string",
      description: "Recipient address for the transfer",
      demandOption: true
    })
    .strict()
)

const normalizeInputs = (
  cliArguments: TransferCoinArguments
): NormalizedInputs => ({
  coinObjectId: normalizeSuiObjectId(cliArguments.coinId),
  amount: parsePositiveU64(cliArguments.amount, "amount"),
  recipientAddress: normalizeSuiAddress(cliArguments.recipient)
})

const resolveCoinOwnershipSnapshot = async ({
  coinObjectId,
  getSuiObject
}: {
  coinObjectId: string
  getSuiObject: GetSuiObject
}): Promise<CoinOwnershipSnapshot> => {
  const { object, owner } = await getSuiObject({
    objectId: coinObjectId,
    options: { showOwner: true, showType: true }
  })

  const coinType = extractCoinType(object.type)
  const ownerAddress = extractOwnerAddress(owner)

  return {
    coinType,
    ownerAddress
  }
}

const extractCoinType = (objectType?: string): string => {
  if (!objectType)
    throw new Error("Coin object is missing its type information.")

  if (!objectType.includes("::coin::Coin<"))
    throw new Error(`Object ${objectType} is not a Coin object.`)

  return objectType
}

const extractOwnerAddress = (owner?: ObjectOwner): string => {
  if (!owner) throw new Error("Coin object is missing its owner.")

  if ("AddressOwner" in owner) return normalizeSuiAddress(owner.AddressOwner)

  if ("ConsensusAddressOwner" in owner)
    return normalizeSuiAddress(owner.ConsensusAddressOwner.owner)

  throw new Error("Coin object is not address-owned.")
}

const ensureSignerOwnsCoin = ({
  coinObjectId,
  coinOwnerAddress,
  signerAddress
}: {
  coinObjectId: string
  coinOwnerAddress: string
  signerAddress: string
}) => {
  if (coinOwnerAddress !== signerAddress)
    throw new Error(
      `Coin object ${coinObjectId} is owned by ${coinOwnerAddress}, not the signer ${signerAddress}.`
    )
}

const buildCoinTransferTransaction = ({
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

const logTransferSummary = ({
  coinObjectId,
  coinType,
  amount,
  recipientAddress,
  senderAddress,
  digest
}: {
  coinObjectId: string
  coinType: string
  amount: bigint
  recipientAddress: string
  senderAddress: string
  digest?: string
}) => {
  logKeyValueGreen("coin")(coinObjectId)
  logKeyValueGreen("coin-type")(coinType)
  logKeyValueGreen("amount")(amount.toString())
  logKeyValueGreen("from")(senderAddress)
  logKeyValueGreen("to")(recipientAddress)
  if (digest) logKeyValueGreen("digest")(digest)
}
