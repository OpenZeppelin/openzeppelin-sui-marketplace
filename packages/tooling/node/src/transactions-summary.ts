import type { SuiTransactionBlockResponse } from "@mysten/sui/client"

import {
  summarizeGasUsed,
  summarizeObjectChanges,
  type GasSummary,
  type ObjectChangeDetail
} from "@sui-oracle-market/tooling-core/transactions"
import { safeJsonStringify } from "@sui-oracle-market/tooling-core/utils/errors"
import { formatOptionalNumericValue } from "@sui-oracle-market/tooling-core/utils/formatters"

export type GasSummaryView = {
  computation: string
  storage: string
  rebate: string
  total: string
}

export type BalanceChangeSummary = {
  owner: string
  coinType: string
  amount: string
}

export type TransactionSummary = {
  label?: string
  digest?: string
  status?: string
  error?: string
  gasUsed?: GasSummaryView
  objectChanges: ObjectChangeDetail[]
  balanceChanges: BalanceChangeSummary[]
}

const toGasSummaryView = (summary?: GasSummary): GasSummaryView | undefined => {
  if (!summary) return undefined
  return {
    computation: summary.computation.toString(),
    storage: summary.storage.toString(),
    rebate: summary.rebate.toString(),
    total: summary.total.toString()
  }
}

const normalizeBalanceChangeOwner = (owner: unknown) =>
  typeof owner === "string"
    ? owner
    : (safeJsonStringify(owner) ?? String(owner))

const normalizeBalanceAmount = (amount: unknown) =>
  formatOptionalNumericValue(amount) ?? String(amount)

const summarizeBalanceChanges = (
  balanceChanges: SuiTransactionBlockResponse["balanceChanges"]
): BalanceChangeSummary[] =>
  (balanceChanges ?? []).map((change) => ({
    owner: normalizeBalanceChangeOwner(change.owner),
    coinType: change.coinType,
    amount: normalizeBalanceAmount(change.amount)
  }))

export const resolveTransactionDigest = (
  result: SuiTransactionBlockResponse
): string | undefined =>
  result.digest ?? result.effects?.transactionDigest ?? undefined

export const requireTransactionDigest = (
  result: SuiTransactionBlockResponse,
  label = "transaction"
): string => {
  const digest = resolveTransactionDigest(result)
  if (!digest)
    throw new Error(`Expected ${label} digest to be available, but none found.`)
  return digest
}

export const buildTransactionSummary = (
  result: SuiTransactionBlockResponse,
  label?: string
): TransactionSummary => ({
  label,
  digest: resolveTransactionDigest(result),
  status: result.effects?.status?.status,
  error: result.effects?.status?.error,
  gasUsed: toGasSummaryView(summarizeGasUsed(result.effects?.gasUsed)),
  objectChanges: summarizeObjectChanges(result.objectChanges),
  balanceChanges: summarizeBalanceChanges(result.balanceChanges)
})

export const formatTransactionSummary = (summary: TransactionSummary) => {
  const serialized = JSON.stringify(summary, undefined, 2)
  if (summary.label) return `${summary.label}\n${serialized}`
  return serialized
}

export const formatTransactionResult = (
  result: SuiTransactionBlockResponse,
  label?: string
) => formatTransactionSummary(buildTransactionSummary(result, label))
