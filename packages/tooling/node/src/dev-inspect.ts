import type { Transaction } from "@mysten/sui/transactions"

import { logKeyValueYellow } from "./log.ts"
import type { ToolingContext } from "./factory.ts"

export type DevInspectOptions = {
  transaction: Transaction
  enabled?: boolean
  senderAddress?: string
}

export const maybeLogDevInspect = async (
  { transaction, enabled, senderAddress }: DevInspectOptions,
  toolingContext: ToolingContext
) => {
  if (!enabled) return

  const resolvedSender =
    senderAddress ?? toolingContext.suiConfig.network.account.accountAddress

  if (!resolvedSender)
    throw new Error(
      "senderAddress is required for dev-inspect when no default account is configured."
    )

  const result = await toolingContext.suiClient.devInspectTransactionBlock({
    sender: resolvedSender,
    transactionBlock: transaction
  })

  const error = result.effects?.status?.error ?? result.error ?? "ok"
  logKeyValueYellow("dev-inspect")(error)
  console.log(
    JSON.stringify(
      {
        error: result.error,
        status: result.effects?.status,
        results: result.results
      },
      undefined,
      2
    )
  )
}
