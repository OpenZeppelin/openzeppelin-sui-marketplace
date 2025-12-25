"use client"

import {
  useCurrentAccount,
  useCurrentWallet,
  useSignAndExecuteTransaction,
  useSignTransaction,
  useSuiClient,
  useSuiClientContext
} from "@mysten/dapp-kit"
import type { SuiTransactionBlockResponse } from "@mysten/sui/client"
import clsx from "clsx"
import { useEffect, useMemo, useState } from "react"

import {
  defaultStartTimestampSeconds,
  describeRuleKind,
  deriveTemplateStatus,
  DISCOUNT_TEMPLATE_TYPE_FRAGMENT,
  discountRuleChoices,
  formatRuleValue,
  getDiscountTemplateSummary,
  parseDiscountRuleKind,
  parseDiscountRuleValue,
  validateDiscountSchedule,
  type DiscountTemplateSummary,
  type DiscountRuleKindLabel,
  type NormalizedRuleKind
} from "@sui-oracle-market/domain-core/models/discount"
import type { ItemListingSummary } from "@sui-oracle-market/domain-core/models/item-listing"
import { buildCreateDiscountTemplateTransaction } from "@sui-oracle-market/domain-core/ptb/discount-template"
import {
  deriveRelevantPackageId,
  normalizeOptionalId
} from "@sui-oracle-market/tooling-core/object"
import { getSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { ENetwork } from "@sui-oracle-market/tooling-core/types"
import {
  parseNonNegativeU64,
  parseOptionalU64
} from "@sui-oracle-market/tooling-core/utils/utility"
import { EXPLORER_URL_VARIABLE_NAME } from "../config/network"
import { copyToClipboard } from "../helpers/clipboard"
import {
  formatEpochSeconds,
  formatUsdFromCents,
  getStructLabel,
  shortenId
} from "../helpers/format"
import {
  getLocalnetClient,
  makeLocalnetExecutor,
  walletSupportsChain
} from "../helpers/localnet"
import { resolveOwnerCapabilityId } from "../helpers/ownerCapabilities"
import {
  extractErrorDetails,
  formatErrorMessage,
  safeJsonStringify,
  serializeForJson
} from "../helpers/transactionErrors"
import {
  resolveValidationMessage,
  validateOptionalSuiObjectId
} from "../helpers/inputValidation"
import {
  extractCreatedObjects,
  formatTimestamp,
  summarizeObjectChanges
} from "../helpers/transactionFormat"
import useNetworkConfig from "../hooks/useNetworkConfig"
import { useIdleFieldValidation } from "../hooks/useIdleFieldValidation"
import CopyableId from "./CopyableId"
import {
  ModalSection,
  modalFieldErrorTextClassName,
  modalFieldInputErrorClassName,
  modalFieldDescriptionClassName,
  modalFieldInputClassName,
  modalFieldLabelClassName,
  modalFieldTitleClassName,
  modalCloseButtonClassName,
  secondaryActionButtonClassName
} from "./ModalPrimitives"

type DiscountFormState = {
  ruleKind: DiscountRuleKindLabel
  ruleValue: string
  startsAt: string
  expiresAt: string
  maxRedemptions: string
  appliesToListingId: string
}

type DiscountInputs = {
  ruleKind: NormalizedRuleKind
  ruleValue: bigint
  startsAt: bigint
  expiresAt?: bigint
  maxRedemptions?: bigint
  appliesToListingId?: string
}

type DiscountTransactionSummary = DiscountInputs & {
  digest: string
  transactionBlock: SuiTransactionBlockResponse
  discountTemplateId?: string
}

type TransactionState =
  | { status: "idle" }
  | { status: "processing" }
  | { status: "success"; summary: DiscountTransactionSummary }
  | { status: "error"; error: string; details?: string }

const emptyFormState = (): DiscountFormState => ({
  ruleKind: "fixed",
  ruleValue: "",
  startsAt: defaultStartTimestampSeconds().toString(),
  expiresAt: "",
  maxRedemptions: "",
  appliesToListingId: ""
})

type DiscountFieldErrors = Partial<Record<keyof DiscountFormState, string>>

const buildDiscountFieldErrors = (
  formState: DiscountFormState
): DiscountFieldErrors => {
  const errors: DiscountFieldErrors = {}
  const ruleValue = formState.ruleValue.trim()
  const startsAt = formState.startsAt.trim()
  const expiresAt = formState.expiresAt.trim()
  const maxRedemptions = formState.maxRedemptions.trim()

  let normalizedRuleKind: NormalizedRuleKind | undefined
  try {
    normalizedRuleKind = parseDiscountRuleKind(formState.ruleKind)
  } catch (error) {
    errors.ruleKind = resolveValidationMessage(
      error,
      "Select a valid rule type."
    )
  }

  if (!ruleValue) {
    errors.ruleValue = "Rule value is required."
  } else if (normalizedRuleKind !== undefined) {
    try {
      parseDiscountRuleValue(normalizedRuleKind, ruleValue)
    } catch (error) {
      errors.ruleValue = resolveValidationMessage(
        error,
        "Enter a valid discount value."
      )
    }
  }

  if (!startsAt) {
    errors.startsAt = "Start time is required."
  } else {
    try {
      parseNonNegativeU64(startsAt, "Start time")
    } catch (error) {
      errors.startsAt = resolveValidationMessage(
        error,
        "Start time must be a valid u64."
      )
    }
  }

  if (expiresAt) {
    try {
      parseNonNegativeU64(expiresAt, "Expiry")
    } catch (error) {
      errors.expiresAt = resolveValidationMessage(
        error,
        "Expiry must be a valid u64."
      )
    }
  }

  if (!errors.startsAt && !errors.expiresAt) {
    try {
      const normalizedStartsAt = parseNonNegativeU64(startsAt, "Start time")
      const normalizedExpiresAt = expiresAt
        ? parseNonNegativeU64(expiresAt, "Expiry")
        : undefined
      validateDiscountSchedule(normalizedStartsAt, normalizedExpiresAt)
    } catch (error) {
      errors.expiresAt = resolveValidationMessage(
        error,
        "Expiry must be after the start time."
      )
    }
  }

  if (maxRedemptions) {
    try {
      parseOptionalU64(maxRedemptions, "Max redemptions")
    } catch (error) {
      errors.maxRedemptions = resolveValidationMessage(
        error,
        "Max redemptions must be a valid u64."
      )
    }
  }

  const listingError = validateOptionalSuiObjectId(
    formState.appliesToListingId,
    "Listing id"
  )
  if (listingError) errors.appliesToListingId = listingError

  return errors
}


const buildListingLookup = (itemListings: ItemListingSummary[]) =>
  itemListings.reduce<Record<string, ItemListingSummary>>(
    (accumulator, listing) => ({
      ...accumulator,
      [listing.itemListingId]: listing
    }),
    {}
  )

const resolveListingLabel = (
  listing?: ItemListingSummary
): string | undefined => {
  if (!listing) return undefined
  return listing.name || getStructLabel(listing.itemType)
}

const formatDiscountRulePreview = ({
  ruleKind,
  ruleValue
}: {
  ruleKind: NormalizedRuleKind
  ruleValue: bigint
}) => {
  if (ruleKind === 0)
    return `${formatUsdFromCents(ruleValue.toString())} off`

  return `${formatRuleValue(ruleKind, ruleValue)} off`
}

const resolveEpochPreview = (rawValue: string) => {
  if (!rawValue.trim()) return "Not set"

  try {
    const parsed = parseNonNegativeU64(rawValue, "timestamp")
    return formatEpochSeconds(parsed.toString())
  } catch {
    return "Invalid timestamp"
  }
}

const resolveRuleValuePreview = (
  ruleKind: DiscountRuleKindLabel,
  ruleValue: string
) => {
  if (!ruleValue.trim()) return "Enter a value"

  try {
    const normalizedKind = parseDiscountRuleKind(ruleKind)
    const normalizedValue = parseDiscountRuleValue(normalizedKind, ruleValue)
    return formatDiscountRulePreview({
      ruleKind: normalizedKind,
      ruleValue: normalizedValue
    })
  } catch {
    return "Invalid value"
  }
}

const parseDiscountInputs = (formState: DiscountFormState): DiscountInputs => {
  const ruleKind = parseDiscountRuleKind(formState.ruleKind)
  const ruleValue = parseDiscountRuleValue(ruleKind, formState.ruleValue)
  const startsAt = parseNonNegativeU64(formState.startsAt, "startsAt")
  const expiresAt = parseOptionalU64(
    formState.expiresAt.trim() || undefined,
    "expiresAt"
  )
  const maxRedemptions = parseOptionalU64(
    formState.maxRedemptions.trim() || undefined,
    "maxRedemptions"
  )

  validateDiscountSchedule(startsAt, expiresAt)

  return {
    ruleKind,
    ruleValue,
    startsAt,
    expiresAt,
    maxRedemptions,
    appliesToListingId: normalizeOptionalId(
      formState.appliesToListingId.trim() || undefined
    )
  }
}

const DiscountSuccessHeader = ({
  rulePreview,
  onClose
}: {
  rulePreview: string
  onClose: () => void
}) => (
  <div className="relative overflow-hidden border-b border-emerald-400/90 px-6 py-5 dark:border-emerald-400/50">
    <div className="absolute inset-0 bg-gradient-to-br from-emerald-300/95 via-white/80 to-emerald-200/90 opacity-95 dark:from-emerald-500/45 dark:via-slate-950/35 dark:to-emerald-400/30" />
    <div className="relative flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-emerald-800 dark:text-emerald-100">
          Success
        </div>
        <div className="mt-2 text-xl font-semibold text-sds-dark dark:text-sds-light">
          Discount template created
        </div>
        <div className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          {rulePreview}
        </div>
        <div className="mt-2 text-[0.7rem] font-semibold text-emerald-900 dark:text-emerald-100">
          The discount is now available on chain.
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        className={modalCloseButtonClassName}
      >
        Close
      </button>
    </div>
  </div>
)

const DiscountErrorHeader = ({
  rulePreview,
  onClose
}: {
  rulePreview: string
  onClose: () => void
}) => (
  <div className="relative overflow-hidden border-b border-rose-300/80 px-6 py-5 dark:border-rose-400/40">
    <div className="absolute inset-0 bg-gradient-to-br from-rose-200/95 via-white/80 to-rose-100/90 opacity-95 dark:from-rose-500/40 dark:via-slate-950/35 dark:to-rose-400/25" />
    <div className="relative flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-rose-800 dark:text-rose-100">
          Error
        </div>
        <div className="mt-2 text-xl font-semibold text-sds-dark dark:text-sds-light">
          Discount creation failed
        </div>
        <div className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          {rulePreview}
        </div>
        <div className="mt-2 text-[0.7rem] font-semibold text-rose-900 dark:text-rose-100">
          Review the error details and try again.
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        className={modalCloseButtonClassName}
      >
        Close
      </button>
    </div>
  </div>
)

const DiscountErrorNotice = ({
  error,
  details
}: {
  error: string
  details?: string
}) => (
  <div className="relative overflow-hidden rounded-2xl border border-rose-200/80 bg-rose-50/70 px-4 py-4 text-xs dark:border-rose-500/30 dark:bg-rose-500/10">
    <div className="absolute inset-0 bg-gradient-to-br from-rose-100/90 via-white/85 to-rose-50/80 opacity-90 dark:from-rose-500/30 dark:via-slate-950/45 dark:to-rose-400/20" />
    <div className="relative">
      <div className="text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-rose-700/95 dark:text-rose-200/90">
        Error
      </div>
      <div className="mt-2 text-sm font-semibold text-rose-800 dark:text-rose-100">
        Transaction failed
      </div>
      <div className="mt-2 text-[0.7rem] text-rose-700/90 dark:text-rose-200/90">
        {error}
      </div>
      {details ? (
        <details className="mt-3 text-[0.7rem] text-rose-700/90 dark:text-rose-200/90">
          <summary className="cursor-pointer font-semibold">
            Raw error JSON
          </summary>
          <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-rose-200/60 bg-white/80 p-2 text-[0.65rem] text-rose-700 dark:border-rose-500/30 dark:bg-slate-950/60 dark:text-rose-200">
            {details}
          </pre>
          <button
            type="button"
            onClick={() => copyToClipboard(details)}
            className="mt-2 inline-flex items-center rounded-full border border-rose-200/70 px-3 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-rose-600 transition hover:border-rose-300 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 dark:border-rose-500/30 dark:text-rose-200"
          >
            Copy raw error
          </button>
        </details>
      ) : null}
    </div>
  </div>
)

const DiscountSummarySection = ({
  summary,
  shopId,
  listingLabel
}: {
  summary: DiscountTransactionSummary
  shopId?: string
  listingLabel?: string
}) => (
  <ModalSection title="Discount details" subtitle="Rule, scope, and schedule">
    <div className="grid gap-3 text-xs sm:grid-cols-2">
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Rule
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {formatDiscountRulePreview({
            ruleKind: summary.ruleKind,
            ruleValue: summary.ruleValue
          })}
        </div>
        <div className="mt-2 text-[0.7rem] text-slate-500 dark:text-slate-200/60">
          {describeRuleKind(summary.ruleKind)} discount
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Starts at
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {formatEpochSeconds(summary.startsAt.toString())}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Expires at
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {summary.expiresAt
            ? formatEpochSeconds(summary.expiresAt.toString())
            : "No expiry"}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Max redemptions
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {summary.maxRedemptions?.toString() ?? "Unlimited"}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60 sm:col-span-2">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Applies to listing
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {listingLabel ??
            (summary.appliesToListingId
              ? shortenId(summary.appliesToListingId)
              : "All listings")}
        </div>
        {summary.appliesToListingId ? (
          <div className="mt-2 text-[0.7rem] text-slate-500 dark:text-slate-200/60">
            {summary.appliesToListingId}
          </div>
        ) : null}
      </div>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
      {summary.discountTemplateId ? (
        <CopyableId value={summary.discountTemplateId} label="Template ID" />
      ) : null}
      {shopId ? <CopyableId value={shopId} label="Shop ID" /> : null}
    </div>
  </ModalSection>
)

const DiscountTransactionRecap = ({
  summary,
  explorerUrl
}: {
  summary: DiscountTransactionSummary
  explorerUrl?: string
}) => {
  const { transactionBlock, digest } = summary
  const status = transactionBlock.effects?.status?.status ?? "unknown"
  const error = transactionBlock.effects?.status?.error
  const objectChanges = transactionBlock.objectChanges ?? []
  const objectChangeSummary = summarizeObjectChanges(objectChanges)

  const explorerLink =
    explorerUrl && digest ? `${explorerUrl}/txblock/${digest}` : undefined

  return (
    <ModalSection
      title="Transaction recap"
      subtitle="On-chain confirmation details"
    >
      <div className="space-y-4 text-xs text-slate-600 dark:text-slate-200/70">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
            <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
              Status
            </div>
            <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
              {status}
            </div>
            {error ? (
              <div className="mt-2 text-xs text-rose-500">{error}</div>
            ) : null}
          </div>
          <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
            <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
              Timestamp
            </div>
            <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
              {formatTimestamp(transactionBlock.timestampMs)}
            </div>
            {transactionBlock.checkpoint ? (
              <div className="mt-1 text-[0.65rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                Checkpoint {transactionBlock.checkpoint}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
            Digest
          </span>
          <CopyableId value={digest} />
          {explorerLink ? (
            <a
              href={explorerLink}
              target="_blank"
              rel="noreferrer"
              className="dark:text-sds-blue/80 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-sds-blue hover:text-sds-dark dark:hover:text-sds-light"
            >
              View on explorer
            </a>
          ) : null}
        </div>

        <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
          <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
            Object changes
          </div>
          <div className="mt-2 text-sm font-semibold text-sds-dark dark:text-sds-light">
            {objectChanges.length} total changes
          </div>
          {objectChanges.length > 0 ? (
            <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
              {objectChangeSummary
                .filter((item) => item.count > 0)
                .map((item) => {
                  const typeLabels = item.types
                    .slice(0, 3)
                    .map((type) =>
                      type.count > 1
                        ? `${type.label} x${type.count}`
                        : type.label
                    )
                    .join(", ")

                  return (
                    <div key={item.label}>
                      <div className="text-[0.55rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                        {item.label}
                      </div>
                      <div>{item.count}</div>
                      {typeLabels ? (
                        <div className="mt-1 text-[0.6rem] text-slate-500 dark:text-slate-200/60">
                          {typeLabels}
                          {item.types.length > 3
                            ? ` +${item.types.length - 3} more`
                            : ""}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
            </div>
          ) : (
            <div className="mt-2 text-xs text-slate-500 dark:text-slate-200/60">
              No object changes detected.
            </div>
          )}
        </div>
      </div>
    </ModalSection>
  )
}

const DiscountSuccessView = ({
  summary,
  shopId,
  explorerUrl,
  listingLabel,
  onClose,
  onReset
}: {
  summary: DiscountTransactionSummary
  shopId?: string
  explorerUrl?: string
  listingLabel?: string
  onClose: () => void
  onReset: () => void
}) => (
  <>
    <DiscountSuccessHeader
      rulePreview={formatDiscountRulePreview({
        ruleKind: summary.ruleKind,
        ruleValue: summary.ruleValue
      })}
      onClose={onClose}
    />
    <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-6">
      <DiscountSummarySection
        summary={summary}
        shopId={shopId}
        listingLabel={listingLabel}
      />
      <DiscountTransactionRecap summary={summary} explorerUrl={explorerUrl} />
    </div>
    <div className="border-t border-slate-200/70 px-6 py-4 dark:border-slate-50/15">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-[0.18em] text-emerald-800 dark:text-emerald-100">
          On-chain confirmation complete.
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onReset}
            className={secondaryActionButtonClassName}
          >
            Create another
          </button>
          <button
            type="button"
            onClick={onClose}
            className={secondaryActionButtonClassName}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  </>
)

const DiscountErrorView = ({
  error,
  details,
  rulePreview,
  onClose,
  onReset
}: {
  error: string
  details?: string
  rulePreview: string
  onClose: () => void
  onReset: () => void
}) => (
  <>
    <DiscountErrorHeader rulePreview={rulePreview} onClose={onClose} />
    <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-6">
      <DiscountErrorNotice error={error} details={details} />
    </div>
    <div className="border-t border-slate-200/70 px-6 py-4 dark:border-slate-50/15">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-[0.18em] text-rose-800 dark:text-rose-100">
          Resolve the issue and retry when ready.
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onReset}
            className={secondaryActionButtonClassName}
          >
            Try again
          </button>
          <button
            type="button"
            onClick={onClose}
            className={secondaryActionButtonClassName}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  </>
)

const AddDiscountModal = ({
  open,
  onClose,
  shopId,
  itemListings,
  onDiscountCreated
}: {
  open: boolean
  onClose: () => void
  shopId?: string
  itemListings: ItemListingSummary[]
  onDiscountCreated?: (template?: DiscountTemplateSummary) => void
}) => {
  const currentAccount = useCurrentAccount()
  const { currentWallet } = useCurrentWallet()
  const suiClient = useSuiClient()
  const { network } = useSuiClientContext()
  const { useNetworkVariable } = useNetworkConfig()
  const explorerUrl = useNetworkVariable(EXPLORER_URL_VARIABLE_NAME)
  const signAndExecuteTransaction = useSignAndExecuteTransaction()
  const signTransaction = useSignTransaction()
  const localnetClient = useMemo(() => getLocalnetClient(), [])
  const isLocalnet = network === ENetwork.LOCALNET
  const localnetExecutor = useMemo(
    () =>
      makeLocalnetExecutor({
        client: localnetClient,
        signTransaction: signTransaction.mutateAsync
      }),
    [localnetClient, signTransaction.mutateAsync]
  )

  const [formState, setFormState] = useState<DiscountFormState>(
    emptyFormState()
  )
  const [transactionState, setTransactionState] = useState<TransactionState>({
    status: "idle"
  })
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const {
    markFieldChange,
    markFieldBlur,
    resetFieldState,
    shouldShowFieldFeedback
  } = useIdleFieldValidation<keyof DiscountFormState>({ idleDelayMs: 600 })

  const walletAddress = currentAccount?.address
  const listingLookup = useMemo(
    () => buildListingLookup(itemListings),
    [itemListings]
  )

  const ruleValuePreview = useMemo(
    () => resolveRuleValuePreview(formState.ruleKind, formState.ruleValue),
    [formState.ruleKind, formState.ruleValue]
  )

  const fieldErrors = useMemo(
    () => buildDiscountFieldErrors(formState),
    [formState]
  )
  const hasFieldErrors = Object.values(fieldErrors).some(Boolean)
  const startsAtPreview = useMemo(
    () => resolveEpochPreview(formState.startsAt),
    [formState.startsAt]
  )
  const expiresAtPreview = useMemo(
    () => resolveEpochPreview(formState.expiresAt),
    [formState.expiresAt]
  )

  const listingPreviewLabel = useMemo(() => {
    const listingId = formState.appliesToListingId.trim()
    if (!listingId) return "All listings"
    const listing = listingLookup[listingId]
    return resolveListingLabel(listing) ?? shortenId(listingId)
  }, [formState.appliesToListingId, listingLookup])

  const isSubmissionPending = isLocalnet
    ? signTransaction.isPending
    : signAndExecuteTransaction.isPending

  const canSubmit =
    Boolean(walletAddress && shopId && !hasFieldErrors) &&
    transactionState.status !== "processing" &&
    isSubmissionPending !== true

  const resetForm = () => {
    setFormState(emptyFormState())
    setTransactionState({ status: "idle" })
    setHasAttemptedSubmit(false)
    resetFieldState()
  }

  useEffect(() => {
    if (!open) return
    resetForm()
  }, [open])

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [open, onClose])

  const handleInputChange = <K extends keyof DiscountFormState>(
    key: K,
    value: DiscountFormState[K]
  ) => {
    markFieldChange(key)
    setFormState((previous) => ({
      ...previous,
      [key]: value
    }))
  }

  const shouldShowFieldError = <K extends keyof DiscountFormState>(
    key: K,
    error?: string
  ): error is string =>
    Boolean(error && shouldShowFieldFeedback(key, hasAttemptedSubmit))

  const handleCreateDiscount = async () => {
    setHasAttemptedSubmit(true)

    if (!walletAddress || !shopId) {
      setTransactionState({
        status: "error",
        error: "Wallet and shop details are required to create a discount."
      })
      return
    }

    if (hasFieldErrors) return

    const expectedChain = `sui:${network}`
    const accountChains = currentAccount?.chains ?? []
    const localnetSupported = walletSupportsChain(
      currentWallet ?? currentAccount,
      expectedChain
    )
    const walletFeatureKeys = currentWallet
      ? Object.keys(currentWallet.features)
      : []
    const chainMismatch =
      accountChains.length > 0 && !accountChains.includes(expectedChain)

    const walletContext = {
      appNetwork: network,
      expectedChain,
      walletName: currentWallet?.name,
      walletVersion: currentWallet?.version,
      accountAddress: walletAddress,
      accountChains,
      chainMismatch,
      localnetSupported,
      walletFeatureKeys
    }

    if (!isLocalnet && chainMismatch) {
      setTransactionState({
        status: "error",
        error: `Wallet chain mismatch. Switch your wallet to ${network}.`,
        details: safeJsonStringify(
          { walletContext, reason: "chain_mismatch" },
          2
        )
      })
      return
    }

    if (!currentWallet) {
      setTransactionState({
        status: "error",
        error: "No wallet connected. Connect a wallet to continue.",
        details: safeJsonStringify(
          { walletContext, reason: "wallet_missing" },
          2
        )
      })
      return
    }

    setTransactionState({ status: "processing" })

    let failureStage: "prepare" | "execute" | "fetch" = "prepare"

    try {
      const discountInputs = parseDiscountInputs(formState)
      const shopShared = await getSuiSharedObject(
        { objectId: shopId, mutable: true },
        { suiClient }
      )
      const resolvedShopId = shopShared.object.objectId
      const shopPackageId = deriveRelevantPackageId(shopShared.object.type)
      const ownerCapabilityId = await resolveOwnerCapabilityId({
        shopId: resolvedShopId,
        shopPackageId,
        ownerAddress: walletAddress,
        suiClient
      })

      const createDiscountTransaction = buildCreateDiscountTemplateTransaction({
        packageId: shopPackageId,
        shop: shopShared,
        appliesToListingId: discountInputs.appliesToListingId,
        ruleKind: discountInputs.ruleKind,
        ruleValue: discountInputs.ruleValue,
        startsAt: discountInputs.startsAt,
        expiresAt: discountInputs.expiresAt,
        maxRedemptions: discountInputs.maxRedemptions,
        ownerCapId: ownerCapabilityId
      })
      createDiscountTransaction.setSender(walletAddress)

      let digest = ""
      let transactionBlock: SuiTransactionBlockResponse

      if (isLocalnet) {
        failureStage = "execute"
        const result = await localnetExecutor(createDiscountTransaction, {
          chain: expectedChain
        })
        digest = result.digest
        transactionBlock = result
      } else {
        failureStage = "execute"
        const result = await signAndExecuteTransaction.mutateAsync({
          transaction: createDiscountTransaction,
          chain: expectedChain
        })

        failureStage = "fetch"
        digest = result.digest
        transactionBlock = await suiClient.getTransactionBlock({
          digest,
          options: {
            showEffects: true,
            showObjectChanges: true,
            showEvents: true,
            showBalanceChanges: true,
            showInput: true
          }
        })
      }

      const discountTemplateId = extractCreatedObjects(transactionBlock).find(
        (change) => change.objectType.endsWith(DISCOUNT_TEMPLATE_TYPE_FRAGMENT)
      )?.objectId

      const optimisticTemplate = discountTemplateId
        ? {
            discountTemplateId,
            markerObjectId: discountTemplateId,
            shopAddress: resolvedShopId,
            appliesToListingId: discountInputs.appliesToListingId,
            ruleDescription: formatDiscountRulePreview({
              ruleKind: discountInputs.ruleKind,
              ruleValue: discountInputs.ruleValue
            }),
            startsAt: discountInputs.startsAt.toString(),
            expiresAt: discountInputs.expiresAt?.toString(),
            maxRedemptions: discountInputs.maxRedemptions?.toString(),
            claimsIssued: "0",
            redemptions: "0",
            activeFlag: true,
            status: deriveTemplateStatus({
              activeFlag: true,
              startsAt: discountInputs.startsAt,
              expiresAt: discountInputs.expiresAt,
              maxRedemptions: discountInputs.maxRedemptions,
              redemptions: 0n
            })
          }
        : undefined

      setTransactionState({
        status: "success",
        summary: {
          ...discountInputs,
          digest,
          transactionBlock,
          discountTemplateId
        }
      })

      onDiscountCreated?.(optimisticTemplate)

      if (discountTemplateId) {
        void getDiscountTemplateSummary(
          resolvedShopId,
          discountTemplateId,
          suiClient
        )
          .then((summary) => onDiscountCreated?.(summary))
          .catch(() => {})
      }
    } catch (error) {
      const errorDetails = extractErrorDetails(error)
      const localnetSupportNote =
        isLocalnet && !localnetSupported && failureStage === "execute"
          ? "Wallet may not support sui:localnet signing."
          : undefined
      const errorDetailsRaw = safeJsonStringify(
        {
          summary: errorDetails,
          raw: serializeForJson(error),
          failureStage,
          localnetSupportNote
        },
        2
      )
      const formattedError = formatErrorMessage(error)
      const errorMessage = localnetSupportNote
        ? `${formattedError} ${localnetSupportNote}`
        : formattedError
      setTransactionState({
        status: "error",
        error: errorMessage,
        details: errorDetailsRaw
      })
    }
  }

  if (!open) return null

  const isSuccessState = transactionState.status === "success"
  const isErrorState = transactionState.status === "error"
  const transactionSummary = isSuccessState
    ? transactionState.summary
    : undefined
  const rulePreview = resolveRuleValuePreview(
    formState.ruleKind,
    formState.ruleValue
  )

  const listingLabel =
    transactionSummary?.appliesToListingId &&
    listingLookup[transactionSummary.appliesToListingId]
      ? resolveListingLabel(
          listingLookup[transactionSummary.appliesToListingId]
        )
      : undefined

  const ruleValuePlaceholder =
    formState.ruleKind === "fixed" ? "5.25" : "12.5"
  const ruleValueHint =
    formState.ruleKind === "fixed"
      ? "USD amount in dollars that converts to cents on chain."
      : "Percent off with up to two decimals (0 - 100)."

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-10 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-4xl overflow-hidden rounded-3xl border border-slate-300/70 bg-white/95 shadow-[0_35px_80px_-55px_rgba(15,23,42,0.55)] dark:border-slate-50/20 dark:bg-slate-950/90">
        {isSuccessState && transactionSummary ? (
          <DiscountSuccessView
            summary={transactionSummary}
            shopId={shopId}
            explorerUrl={explorerUrl}
            listingLabel={listingLabel}
            onClose={onClose}
            onReset={resetForm}
          />
        ) : isErrorState ? (
          <DiscountErrorView
            error={transactionState.error}
            details={transactionState.details}
            rulePreview={rulePreview}
            onClose={onClose}
            onReset={resetForm}
          />
        ) : (
          <>
            <div className="relative overflow-hidden border-b border-slate-200/70 px-6 py-5 dark:border-slate-50/15">
              <div className="from-sds-blue/10 to-sds-pink/15 dark:from-sds-blue/20 dark:to-sds-pink/10 absolute inset-0 bg-gradient-to-br via-white/80 opacity-80 dark:via-slate-950/40" />
              <div className="relative flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-200/60">
                    Promotions
                  </div>
                  <div className="mt-2 text-xl font-semibold text-sds-dark dark:text-sds-light">
                    Add Discount
                  </div>
                  <div className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                    Create a discount template for your storefront.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className={modalCloseButtonClassName}
                >
                  Close
                </button>
              </div>
              {shopId ? (
                <div className="relative mt-4">
                  <CopyableId value={shopId} label="Shop" />
                </div>
              ) : null}
            </div>

            <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-6">
              <ModalSection
                title="Discount rule"
                subtitle="Define the promotion mechanics."
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <label className={modalFieldLabelClassName}>
                    <span className={modalFieldTitleClassName}>Rule type</span>
                    <span className={modalFieldDescriptionClassName}>
                      Choose a fixed dollar discount or a percent-off promotion.
                    </span>
                    <select
                      value={formState.ruleKind}
                      onChange={(event) =>
                        handleInputChange(
                          "ruleKind",
                          event.target.value as DiscountRuleKindLabel
                        )
                      }
                      onBlur={() => markFieldBlur("ruleKind")}
                      className={clsx(
                        modalFieldInputClassName,
                        shouldShowFieldError(
                          "ruleKind",
                          fieldErrors.ruleKind
                        ) && modalFieldInputErrorClassName
                      )}
                    >
                      {discountRuleChoices.map((rule) => (
                        <option key={rule} value={rule}>
                          {rule === "fixed" ? "Fixed amount" : "Percent off"}
                        </option>
                      ))}
                    </select>
                    {shouldShowFieldError(
                      "ruleKind",
                      fieldErrors.ruleKind
                    ) ? (
                      <span className={modalFieldErrorTextClassName}>
                        {fieldErrors.ruleKind}
                      </span>
                    ) : null}
                  </label>
                  <label className={modalFieldLabelClassName}>
                    <span className={modalFieldTitleClassName}>Rule value</span>
                    <span className={modalFieldDescriptionClassName}>
                      {ruleValueHint}
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formState.ruleValue}
                      onChange={(event) =>
                        handleInputChange("ruleValue", event.target.value)
                      }
                      onBlur={() => markFieldBlur("ruleValue")}
                      placeholder={ruleValuePlaceholder}
                      className={clsx(
                        modalFieldInputClassName,
                        shouldShowFieldError(
                          "ruleValue",
                          fieldErrors.ruleValue
                        ) && modalFieldInputErrorClassName
                      )}
                    />
                    {shouldShowFieldError(
                      "ruleValue",
                      fieldErrors.ruleValue
                    ) ? (
                      <span className={modalFieldErrorTextClassName}>
                        {fieldErrors.ruleValue}
                      </span>
                    ) : null}
                  </label>
                </div>
              </ModalSection>

              <ModalSection
                title="Schedule & limits"
                subtitle="Set the activation window and redemption cap."
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <label className={modalFieldLabelClassName}>
                    <span className={modalFieldTitleClassName}>
                      Starts at (epoch seconds)
                    </span>
                    <span className={modalFieldDescriptionClassName}>
                      When the discount becomes active. Default is now.
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formState.startsAt}
                      onChange={(event) =>
                        handleInputChange("startsAt", event.target.value)
                      }
                      onBlur={() => markFieldBlur("startsAt")}
                      placeholder={defaultStartTimestampSeconds().toString()}
                      className={clsx(
                        modalFieldInputClassName,
                        shouldShowFieldError(
                          "startsAt",
                          fieldErrors.startsAt
                        ) && modalFieldInputErrorClassName
                      )}
                    />
                    {shouldShowFieldError(
                      "startsAt",
                      fieldErrors.startsAt
                    ) ? (
                      <span className={modalFieldErrorTextClassName}>
                        {fieldErrors.startsAt}
                      </span>
                    ) : null}
                  </label>
                  <label className={modalFieldLabelClassName}>
                    <span className={modalFieldTitleClassName}>
                      Expires at (optional)
                    </span>
                    <span className={modalFieldDescriptionClassName}>
                      Leave blank for no expiry. Must be after starts at.
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formState.expiresAt}
                      onChange={(event) =>
                        handleInputChange("expiresAt", event.target.value)
                      }
                      onBlur={() => markFieldBlur("expiresAt")}
                      placeholder="e.g. 1735689600"
                      className={clsx(
                        modalFieldInputClassName,
                        shouldShowFieldError(
                          "expiresAt",
                          fieldErrors.expiresAt
                        ) && modalFieldInputErrorClassName
                      )}
                    />
                    {shouldShowFieldError(
                      "expiresAt",
                      fieldErrors.expiresAt
                    ) ? (
                      <span className={modalFieldErrorTextClassName}>
                        {fieldErrors.expiresAt}
                      </span>
                    ) : null}
                  </label>
                  <label
                    className={clsx(
                      modalFieldLabelClassName,
                      "md:col-span-2"
                    )}
                  >
                    <span className={modalFieldTitleClassName}>
                      Max redemptions (optional)
                    </span>
                    <span className={modalFieldDescriptionClassName}>
                      Global redemption cap across all buyers. Leave blank for
                      unlimited.
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formState.maxRedemptions}
                      onChange={(event) =>
                        handleInputChange("maxRedemptions", event.target.value)
                      }
                      onBlur={() => markFieldBlur("maxRedemptions")}
                      placeholder="e.g. 500"
                      className={clsx(
                        modalFieldInputClassName,
                        shouldShowFieldError(
                          "maxRedemptions",
                          fieldErrors.maxRedemptions
                        ) &&
                          modalFieldInputErrorClassName
                      )}
                    />
                    {shouldShowFieldError(
                      "maxRedemptions",
                      fieldErrors.maxRedemptions
                    ) ? (
                      <span className={modalFieldErrorTextClassName}>
                        {fieldErrors.maxRedemptions}
                      </span>
                    ) : null}
                  </label>
                </div>
              </ModalSection>

              <ModalSection
                title="Applies to"
                subtitle="Scope the discount to a listing or leave it global."
              >
                <div className="grid gap-4">
                  <label className={modalFieldLabelClassName}>
                    <span className={modalFieldTitleClassName}>
                      Listing ID (optional)
                    </span>
                    <span className={modalFieldDescriptionClassName}>
                      Link the discount to a single listing or leave blank to
                      apply to all items.
                    </span>
                    <input
                      type="text"
                      list="listing-options"
                      value={formState.appliesToListingId}
                      onChange={(event) =>
                        handleInputChange(
                          "appliesToListingId",
                          event.target.value
                        )
                      }
                      onBlur={() => markFieldBlur("appliesToListingId")}
                      placeholder="0x... listing id"
                      className={clsx(
                        modalFieldInputClassName,
                        shouldShowFieldError(
                          "appliesToListingId",
                          fieldErrors.appliesToListingId
                        ) &&
                          modalFieldInputErrorClassName
                      )}
                    />
                    {shouldShowFieldError(
                      "appliesToListingId",
                      fieldErrors.appliesToListingId
                    ) ? (
                      <span className={modalFieldErrorTextClassName}>
                        {fieldErrors.appliesToListingId}
                      </span>
                    ) : null}
                    <datalist id="listing-options">
                      {itemListings.map((listing) => (
                        <option
                          key={listing.itemListingId}
                          value={listing.itemListingId}
                        >
                          {resolveListingLabel(listing) ?? "Listing"} -{" "}
                          {shortenId(listing.itemListingId)}
                        </option>
                      ))}
                    </datalist>
                  </label>
                </div>
              </ModalSection>

              <ModalSection
                title="Review"
                subtitle="Confirm the discount details before submitting."
              >
                <div className="grid gap-3 text-xs sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                    <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                      Rule
                    </div>
                    <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                      {ruleValuePreview}
                    </div>
                    <div className="mt-1 text-[0.65rem] text-slate-500 dark:text-slate-200/60">
                      {formState.ruleKind === "fixed"
                        ? "Fixed discount"
                        : "Percent discount"}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                    <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                      Starts at
                    </div>
                    <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                      {startsAtPreview}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                    <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                      Expires at
                    </div>
                    <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                      {formState.expiresAt.trim()
                        ? expiresAtPreview
                        : "No expiry"}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                    <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                      Max redemptions
                    </div>
                    <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                      {formState.maxRedemptions.trim()
                        ? formState.maxRedemptions.trim()
                        : "Unlimited"}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60 sm:col-span-2">
                    <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                      Applies to listing
                    </div>
                    <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                      {listingPreviewLabel}
                    </div>
                    {formState.appliesToListingId.trim() ? (
                      <div className="mt-1 text-[0.65rem] text-slate-500 dark:text-slate-200/60">
                        {formState.appliesToListingId.trim()}
                      </div>
                    ) : null}
                  </div>
                </div>
              </ModalSection>
            </div>

            <div className="border-t border-slate-200/70 px-6 py-4 dark:border-slate-50/15">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                  {transactionState.status === "processing"
                    ? "Waiting for wallet confirmation..."
                    : "Ready to create the discount."}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleCreateDiscount}
                    disabled={!canSubmit}
                    className={clsx(
                      "border-sds-blue/40 from-sds-blue/20 to-sds-pink/30 focus-visible:ring-sds-blue/40 dark:from-sds-blue/20 dark:to-sds-pink/10 inline-flex items-center gap-2 rounded-full border bg-gradient-to-r via-white/80 px-5 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-sds-dark shadow-[0_14px_36px_-26px_rgba(77,162,255,0.9)] transition focus-visible:outline-none focus-visible:ring-2 dark:via-slate-900/40 dark:text-sds-light",
                      !canSubmit
                        ? "cursor-not-allowed opacity-50"
                        : "hover:-translate-y-0.5 hover:shadow-[0_18px_45px_-25px_rgba(77,162,255,0.9)]"
                    )}
                  >
                    {transactionState.status === "processing"
                      ? "Processing..."
                      : "Create discount"}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default AddDiscountModal
