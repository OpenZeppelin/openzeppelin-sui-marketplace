import type { Transaction } from "@mysten/sui/transactions"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import {
  defaultStartTimestampSeconds,
  getDiscountTemplateSummary,
  parseDiscountRuleKind,
  parseDiscountRuleValue,
  validateDiscountSchedule,
  type DiscountRuleKindLabel,
  type DiscountTemplateSummary,
  type NormalizedRuleKind
} from "@sui-oracle-market/domain-core/models/discount"
import type { Tooling } from "@sui-oracle-market/tooling-node/factory"
import { emitJsonOutput } from "@sui-oracle-market/tooling-node/json"
import { logKeyValueGreen } from "@sui-oracle-market/tooling-node/log"
import {
  parseNonNegativeU64,
  parseOptionalU64
} from "@sui-oracle-market/tooling-core/utils/utility"
import { logDiscountTemplateSummary } from "../../utils/log-summaries.ts"
import { resolveOwnerShopIdentifiers } from "../../utils/shop-context.ts"

type ToolingExecutionResult = Awaited<
  ReturnType<Tooling["executeTransactionWithSummary"]>
>
type ExecutedTransaction = NonNullable<ToolingExecutionResult["execution"]>

export const resolveOwnerTemplateMutationContext = async ({
  networkName,
  shopPackageId,
  shopId,
  ownerCapId,
  discountTemplateId
}: {
  networkName: string
  shopPackageId?: string
  shopId?: string
  ownerCapId?: string
  discountTemplateId: string
}) => {
  const {
    packageId,
    shopId: resolvedShopId,
    ownerCapId: resolvedOwnerCapId
  } = await resolveOwnerShopIdentifiers({
    networkName,
    shopPackageId,
    shopId,
    ownerCapId
  })

  return {
    packageId,
    shopId: resolvedShopId,
    ownerCapId: resolvedOwnerCapId,
    discountTemplateId: normalizeSuiObjectId(discountTemplateId)
  }
}

export const parseDiscountTemplateRuleScheduleInputs = ({
  ruleKind,
  value,
  startsAt,
  expiresAt,
  maxRedemptions
}: {
  ruleKind: DiscountRuleKindLabel
  value: string
  startsAt?: string
  expiresAt?: string
  maxRedemptions?: string
}): {
  ruleKind: NormalizedRuleKind
  ruleValue: bigint
  startsAt: bigint
  expiresAt?: bigint
  maxRedemptions?: bigint
} => {
  const parsedRuleKind = parseDiscountRuleKind(ruleKind)
  const parsedStartsAt = parseNonNegativeU64(
    startsAt ?? defaultStartTimestampSeconds().toString(),
    "startsAt"
  )
  const parsedExpiresAt = parseOptionalU64(expiresAt, "expiresAt")

  validateDiscountSchedule(parsedStartsAt, parsedExpiresAt)

  return {
    ruleKind: parsedRuleKind,
    ruleValue: parseDiscountRuleValue(parsedRuleKind, value),
    startsAt: parsedStartsAt,
    expiresAt: parsedExpiresAt,
    maxRedemptions: parseOptionalU64(maxRedemptions, "maxRedemptions")
  }
}

export const executeDiscountTemplateMutation = async ({
  tooling,
  transaction,
  summaryLabel,
  devInspect,
  dryRun
}: {
  tooling: Tooling
  transaction: Transaction
  summaryLabel: string
  devInspect?: boolean
  dryRun?: boolean
}): Promise<
  | {
      execution: ExecutedTransaction
      summary: ToolingExecutionResult["summary"]
    }
  | undefined
> => {
  const { execution, summary } = await tooling.executeTransactionWithSummary({
    transaction,
    signer: tooling.loadedEd25519KeyPair,
    summaryLabel,
    devInspect,
    dryRun
  })

  if (!execution) return undefined
  return { execution, summary }
}

export const fetchDiscountTemplateSummaryForMutation = async ({
  shopId,
  discountTemplateId,
  tooling
}: {
  shopId: string
  discountTemplateId: string
  tooling: Tooling
}): Promise<DiscountTemplateSummary> =>
  getDiscountTemplateSummary(shopId, discountTemplateId, tooling.suiClient)

export const emitOrLogDiscountTemplateMutationResult = ({
  discountTemplateSummary,
  digest,
  transactionSummary,
  json,
  extraJsonFields = {},
  extraLogFields = []
}: {
  discountTemplateSummary: DiscountTemplateSummary
  digest?: string
  transactionSummary: ToolingExecutionResult["summary"]
  json?: boolean
  extraJsonFields?: Record<string, unknown>
  extraLogFields?: Array<{ label: string; value: string | number | bigint }>
}): boolean => {
  if (
    emitJsonOutput(
      {
        discountTemplate: discountTemplateSummary,
        ...extraJsonFields,
        digest,
        transactionSummary
      },
      json
    )
  )
    return true

  logDiscountTemplateSummary(discountTemplateSummary)
  for (const extraLogField of extraLogFields) {
    const normalizedLogFieldValue =
      typeof extraLogField.value === "bigint"
        ? extraLogField.value.toString()
        : extraLogField.value
    logKeyValueGreen(extraLogField.label)(normalizedLogFieldValue)
  }
  if (digest) logKeyValueGreen("digest")(digest)
  return false
}
