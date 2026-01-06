/**
 * Splits a Coin object and transfers part to another address.
 * Requires ownership of the input Coin object; no allowances.
 */
import { normalizeSuiAddress, normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { ensureSignerOwnsCoin } from "@sui-oracle-market/domain-core/models/currency"
import { buildCoinTransferTransaction } from "@sui-oracle-market/tooling-core/coin"
import { parsePositiveU64 } from "@sui-oracle-market/tooling-core/utils/utility"
import { emitJsonOutput } from "@sui-oracle-market/tooling-node/json"
import { logKeyValueGreen } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"

type CoinTransferArguments = {
  coinId: string
  amount: string
  recipient: string
  devInspect?: boolean
  dryRun?: boolean
  json?: boolean
}

runSuiScript(
  async (tooling, cliArguments: CoinTransferArguments) => {
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

    const { execution, summary } = await tooling.executeTransactionWithSummary({
      transaction: transferTransaction,
      signer: tooling.loadedEd25519KeyPair,
      summaryLabel: "coin-transfer",
      devInspect: cliArguments.devInspect,
      dryRun: cliArguments.dryRun
    })

    if (!execution) return

    const digest = execution.transactionResult.digest

    if (
      emitJsonOutput(
        {
          coinObjectId: inputs.coinObjectId,
          coinType: coinSnapshot.coinType,
          amount: inputs.amount.toString(),
          recipientAddress: inputs.recipientAddress,
          senderAddress: tooling.loadedEd25519KeyPair.toSuiAddress(),
          digest,
          transactionSummary: summary
        },
        cliArguments.json
      )
    )
      return

    logTransferSummary({
      coinObjectId: inputs.coinObjectId,
      coinType: coinSnapshot.coinType,
      amount: inputs.amount,
      recipientAddress: inputs.recipientAddress,
      senderAddress: tooling.loadedEd25519KeyPair.toSuiAddress(),
      digest
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
    .option("devInspect", {
      alias: ["dev-inspect", "debug"],
      type: "boolean",
      default: false,
      description: "Run a dev-inspect and log VM error details."
    })
    .option("dryRun", {
      alias: ["dry-run"],
      type: "boolean",
      default: false,
      description: "Run dev-inspect and exit without executing the transaction."
    })
    .option("json", {
      type: "boolean",
      default: false,
      description: "Output results as JSON."
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
