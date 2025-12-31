/**
 * Splits a Coin object and transfers a specified amount to another address.
 * On Sui, coins are objects, so transfers are object splits/merges rather than balance updates.
 * If you come from EVM, there is no allowance or transferFrom here; the signer must own the Coin object.
 * This script validates ownership, builds a PTB, and reports the transfer digest.
 */
import { normalizeSuiAddress, normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { ensureSignerOwnsCoin } from "@sui-oracle-market/domain-core/models/currency"
import { buildCoinTransferTransaction } from "@sui-oracle-market/tooling-core/coin"
import { parsePositiveU64 } from "@sui-oracle-market/tooling-core/utils/utility"
import { logKeyValueGreen } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"

runSuiScript(
  async (tooling, cliArguments) => {
    const inputs = normalizeInputs(cliArguments)

    const coinSnapshot = await tooling.resolveCoinOwnership({
      coinObjectId: inputs.coinObjectId
    })

    ensureSignerOwnsCoin({
      coinObjectId: inputs.coinObjectId,
      coinOwnerAddress: coinSnapshot.ownerAddress,
      signerAddress: tooling.loadedEd25519KeyPair.toSuiAddress()
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
      senderAddress: tooling.loadedEd25519KeyPair.toSuiAddress(),
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

const normalizeInputs = (cliArguments: {
  coinId: string
  amount: string
  recipient: string
}) => ({
  coinObjectId: normalizeSuiObjectId(cliArguments.coinId),
  amount: parsePositiveU64(cliArguments.amount, "amount"),
  recipientAddress: normalizeSuiAddress(cliArguments.recipient)
})

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
