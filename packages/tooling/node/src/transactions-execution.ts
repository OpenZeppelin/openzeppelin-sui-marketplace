import type { Transaction } from "@mysten/sui/transactions"

import { maybeLogDevInspect } from "./dev-inspect.ts"
import type { ToolingContext } from "./factory.ts"
import {
  buildTransactionSummary,
  type TransactionSummary
} from "./transactions-summary.ts"
import { signAndExecute } from "./transactions.ts"

export type TransactionExecution = Awaited<ReturnType<typeof signAndExecute>>

type ExecutionOptions = {
  transaction: Transaction
  signer: Parameters<typeof signAndExecute>[0]["signer"]
  summaryLabel?: string
  devInspect?: boolean
  dryRun?: boolean
  senderAddress?: string
}

export const executeTransactionWithSummary = async (
  {
    transaction,
    signer,
    summaryLabel,
    devInspect,
    dryRun,
    senderAddress
  }: ExecutionOptions,
  toolingContext: ToolingContext
): Promise<{
  execution?: TransactionExecution
  summary?: TransactionSummary
}> => {
  const shouldInspect = devInspect || dryRun
  await maybeLogDevInspect(
    {
      transaction,
      enabled: shouldInspect,
      senderAddress:
        senderAddress ??
        (typeof signer.toSuiAddress === "function"
          ? signer.toSuiAddress()
          : undefined)
    },
    toolingContext
  )

  if (dryRun)
    return {
      execution: undefined
    }

  const execution = await signAndExecute(
    {
      transaction,
      signer
    },
    toolingContext
  )

  return {
    execution,
    summary: buildTransactionSummary(execution.transactionResult, summaryLabel)
  }
}
