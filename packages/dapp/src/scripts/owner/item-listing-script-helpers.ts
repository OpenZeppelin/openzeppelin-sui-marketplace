import type { Transaction } from "@mysten/sui/transactions"
import {
  getItemListingSummary,
  normalizeListingId,
  type ItemListingSummary
} from "@sui-oracle-market/domain-core/models/item-listing"
import type { Tooling } from "@sui-oracle-market/tooling-node/factory"
import { emitJsonOutput } from "@sui-oracle-market/tooling-node/json"
import { logKeyValueGreen } from "@sui-oracle-market/tooling-node/log"
import { logItemListingSummary } from "../../utils/log-summaries.ts"
import { resolveOwnerShopIdentifiers } from "../../utils/shop-context.ts"

type ToolingExecutionResult = Awaited<
  ReturnType<Tooling["executeTransactionWithSummary"]>
>
type ExecutedTransaction = NonNullable<ToolingExecutionResult["execution"]>

export const resolveOwnerListingCreationContext = async ({
  networkName,
  shopPackageId,
  shopId,
  ownerCapId
}: {
  networkName: string
  shopPackageId?: string
  shopId?: string
  ownerCapId?: string
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
    ownerCapId: resolvedOwnerCapId
  }
}

export const resolveOwnerListingMutationContext = async ({
  networkName,
  shopPackageId,
  shopId,
  ownerCapId,
  itemListingId
}: {
  networkName: string
  shopPackageId?: string
  shopId?: string
  ownerCapId?: string
  itemListingId: string
}) => {
  const ownerListingCreationContext = await resolveOwnerListingCreationContext({
    networkName,
    shopPackageId,
    shopId,
    ownerCapId
  })

  return {
    ...ownerListingCreationContext,
    itemListingId: normalizeListingId(itemListingId)
  }
}

export const executeItemListingMutation = async ({
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

export const fetchItemListingSummaryForMutation = async ({
  shopId,
  itemListingId,
  tooling
}: {
  shopId: string
  itemListingId: string
  tooling: Tooling
}): Promise<ItemListingSummary> =>
  getItemListingSummary(shopId, itemListingId, tooling.suiClient)

export const emitOrLogItemListingMutationResult = ({
  itemListingSummary,
  digest,
  transactionSummary,
  json,
  extraJsonFields = {},
  extraLogFields = []
}: {
  itemListingSummary: ItemListingSummary
  digest?: string
  transactionSummary: ToolingExecutionResult["summary"]
  json?: boolean
  extraJsonFields?: Record<string, unknown>
  extraLogFields?: Array<{ label: string; value: string | number | bigint }>
}): boolean => {
  if (
    emitJsonOutput(
      {
        itemListing: itemListingSummary,
        ...extraJsonFields,
        digest,
        transactionSummary
      },
      json
    )
  )
    return true

  logItemListingSummary(itemListingSummary)
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
