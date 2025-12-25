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
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import type { AcceptedCurrencySummary } from "@sui-oracle-market/domain-core/models/currency"
import {
  getAcceptedCurrencySummary,
  normalizeCoinType
} from "@sui-oracle-market/domain-core/models/currency"
import {
  buildAddAcceptedCurrencyTransaction,
  deriveCurrencyObjectId
} from "@sui-oracle-market/domain-core/ptb/currency"
import { SUI_COIN_REGISTRY_ID } from "@sui-oracle-market/tooling-core/constants"
import {
  assertBytesLength,
  ensureHexPrefix,
  hexToBytes
} from "@sui-oracle-market/tooling-core/hex"
import { deriveRelevantPackageId } from "@sui-oracle-market/tooling-core/object"
import { getSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { ENetwork } from "@sui-oracle-market/tooling-core/types"
import { parseOptionalPositiveU64 } from "@sui-oracle-market/tooling-core/utils/utility"
import clsx from "clsx"
import { useEffect, useMemo, useState } from "react"

import { EXPLORER_URL_VARIABLE_NAME } from "../config/network"
import { copyToClipboard } from "../helpers/clipboard"
import { getStructLabel, shortenId } from "../helpers/format"
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
  validateMoveType,
  validateOptionalSuiObjectId,
  validateRequiredHexBytes,
  validateRequiredSuiObjectId
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
  modalFieldWarningTextClassName,
  modalFieldDescriptionClassName,
  modalFieldInputClassName,
  modalFieldLabelClassName,
  modalFieldTitleClassName,
  modalCloseButtonClassName,
  secondaryActionButtonClassName
} from "./ModalPrimitives"

type CurrencyFormState = {
  coinType: string
  feedId: string
  priceInfoObjectId: string
  currencyObjectId: string
  maxPriceAgeSecsCap: string
  maxConfidenceRatioBpsCap: string
  maxPriceStatusLagSecsCap: string
}

type CurrencyInputs = {
  coinType: string
  feedIdHex: string
  feedIdBytes: number[]
  priceInfoObjectId: string
  currencyObjectId: string
  maxPriceAgeSecsCap?: bigint
  maxConfidenceRatioBpsCap?: bigint
  maxPriceStatusLagSecsCap?: bigint
}

type CurrencyTransactionSummary = CurrencyInputs & {
  digest: string
  transactionBlock: SuiTransactionBlockResponse
  acceptedCurrencyId?: string
}

type TransactionState =
  | { status: "idle" }
  | { status: "processing" }
  | { status: "success"; summary: CurrencyTransactionSummary }
  | { status: "error"; error: string; details?: string }

const emptyFormState = (): CurrencyFormState => ({
  coinType: "",
  feedId: "",
  priceInfoObjectId: "",
  currencyObjectId: "",
  maxPriceAgeSecsCap: "",
  maxConfidenceRatioBpsCap: "",
  maxPriceStatusLagSecsCap: ""
})

const MAX_PRICE_AGE_SECS_CAP = 60n
const MAX_CONFIDENCE_RATIO_BPS_CAP = 1_000n
const MAX_PRICE_STATUS_LAG_SECS_CAP = 5n

type CurrencyFieldErrors = Partial<Record<keyof CurrencyFormState, string>>
type CurrencyFieldWarnings = Partial<Record<keyof CurrencyFormState, string>>

const parseGuardrailValue = (rawValue: string, label: string) => {
  const trimmed = rawValue.trim()
  if (!trimmed) return { value: undefined }

  try {
    return { value: parseOptionalPositiveU64(trimmed, label) }
  } catch (error) {
    return {
      value: undefined,
      error: resolveValidationMessage(
        error,
        `${label} must be a positive u64.`
      )
    }
  }
}

const buildCurrencyFieldErrors = (
  formState: CurrencyFormState
): CurrencyFieldErrors => {
  const errors: CurrencyFieldErrors = {}

  const coinTypeError = validateMoveType(formState.coinType, "Coin type")
  if (coinTypeError) errors.coinType = coinTypeError

  const currencyObjectIdError = validateOptionalSuiObjectId(
    formState.currencyObjectId,
    "Currency registry id"
  )
  if (currencyObjectIdError) errors.currencyObjectId = currencyObjectIdError

  const feedIdError = validateRequiredHexBytes({
    value: formState.feedId,
    expectedBytes: 32,
    label: "Pyth feed id"
  })
  if (feedIdError) errors.feedId = feedIdError

  const priceInfoError = validateRequiredSuiObjectId(
    formState.priceInfoObjectId,
    "Price info object id"
  )
  if (priceInfoError) errors.priceInfoObjectId = priceInfoError

  const priceAgeResult = parseGuardrailValue(
    formState.maxPriceAgeSecsCap,
    "Max price age"
  )
  if (priceAgeResult.error) errors.maxPriceAgeSecsCap = priceAgeResult.error

  const confidenceResult = parseGuardrailValue(
    formState.maxConfidenceRatioBpsCap,
    "Max confidence"
  )
  if (confidenceResult.error)
    errors.maxConfidenceRatioBpsCap = confidenceResult.error

  const statusLagResult = parseGuardrailValue(
    formState.maxPriceStatusLagSecsCap,
    "Max status lag"
  )
  if (statusLagResult.error)
    errors.maxPriceStatusLagSecsCap = statusLagResult.error

  return errors
}

const buildCurrencyFieldWarnings = (
  formState: CurrencyFormState
): CurrencyFieldWarnings => {
  const warnings: CurrencyFieldWarnings = {}

  const priceAgeResult = parseGuardrailValue(
    formState.maxPriceAgeSecsCap,
    "Max price age"
  )
  if (
    priceAgeResult.value !== undefined &&
    priceAgeResult.value > MAX_PRICE_AGE_SECS_CAP
  ) {
    warnings.maxPriceAgeSecsCap = `Will be clamped to ${MAX_PRICE_AGE_SECS_CAP.toString()} seconds.`
  }

  const confidenceResult = parseGuardrailValue(
    formState.maxConfidenceRatioBpsCap,
    "Max confidence"
  )
  if (
    confidenceResult.value !== undefined &&
    confidenceResult.value > MAX_CONFIDENCE_RATIO_BPS_CAP
  ) {
    warnings.maxConfidenceRatioBpsCap = `Will be clamped to ${MAX_CONFIDENCE_RATIO_BPS_CAP.toString()} bps.`
  }

  const statusLagResult = parseGuardrailValue(
    formState.maxPriceStatusLagSecsCap,
    "Max status lag"
  )
  if (
    statusLagResult.value !== undefined &&
    statusLagResult.value > MAX_PRICE_STATUS_LAG_SECS_CAP
  ) {
    warnings.maxPriceStatusLagSecsCap = `Will be clamped to ${MAX_PRICE_STATUS_LAG_SECS_CAP.toString()} seconds.`
  }

  return warnings
}


const trimToOptional = (value: string) => {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const resolveCurrencyRegistryId = (coinType: string) => {
  try {
    return deriveCurrencyObjectId(coinType, SUI_COIN_REGISTRY_ID)
  } catch {
    return undefined
  }
}

const formatGuardrailCap = (value?: bigint) =>
  value ? value.toString() : "Default"

const parseCurrencyInputs = (formState: CurrencyFormState): CurrencyInputs => {
  const coinType = normalizeCoinType(formState.coinType)
  const feedIdHex = ensureHexPrefix(formState.feedId.trim())
  const feedIdBytes = assertBytesLength(hexToBytes(feedIdHex), 32)
  const priceInfoObjectId = normalizeSuiObjectId(
    formState.priceInfoObjectId.trim()
  )
  const currencyObjectId =
    trimToOptional(formState.currencyObjectId) ??
    deriveCurrencyObjectId(coinType, SUI_COIN_REGISTRY_ID)

  return {
    coinType,
    feedIdHex,
    feedIdBytes,
    priceInfoObjectId,
    currencyObjectId: normalizeSuiObjectId(currencyObjectId),
    maxPriceAgeSecsCap: parseOptionalPositiveU64(
      trimToOptional(formState.maxPriceAgeSecsCap),
      "maxPriceAgeSecsCap"
    ),
    maxConfidenceRatioBpsCap: parseOptionalPositiveU64(
      trimToOptional(formState.maxConfidenceRatioBpsCap),
      "maxConfidenceRatioBpsCap"
    ),
    maxPriceStatusLagSecsCap: parseOptionalPositiveU64(
      trimToOptional(formState.maxPriceStatusLagSecsCap),
      "maxPriceStatusLagSecsCap"
    )
  }
}

const CurrencySuccessHeader = ({
  currencyLabel,
  onClose
}: {
  currencyLabel: string
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
          Currency added
        </div>
        <div className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          {currencyLabel}
        </div>
        <div className="mt-2 text-[0.7rem] font-semibold text-emerald-900 dark:text-emerald-100">
          The currency is now accepted by the shop.
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

const CurrencyErrorHeader = ({
  currencyLabel,
  onClose
}: {
  currencyLabel: string
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
          Currency failed
        </div>
        <div className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          {currencyLabel}
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

const CurrencyErrorNotice = ({
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

const CurrencySummarySection = ({
  summary,
  shopId
}: {
  summary: CurrencyTransactionSummary
  shopId?: string
}) => (
  <ModalSection
    title="Currency details"
    subtitle="Oracle wiring, registry lookup, and guardrails"
  >
    <div className="grid gap-3 text-xs sm:grid-cols-2">
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Coin type
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {getStructLabel(summary.coinType)}
        </div>
        <div className="mt-2 text-[0.7rem] text-slate-500 dark:text-slate-200/60">
          {summary.coinType}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Currency registry
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {shortenId(summary.currencyObjectId)}
        </div>
        <div className="mt-2 text-[0.7rem] text-slate-500 dark:text-slate-200/60">
          {summary.currencyObjectId}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Pyth feed id
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {shortenId(summary.feedIdHex, 10, 8)}
        </div>
        <div className="mt-2 text-[0.7rem] text-slate-500 dark:text-slate-200/60">
          {summary.feedIdHex}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Price info object
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {shortenId(summary.priceInfoObjectId)}
        </div>
        <div className="mt-2 text-[0.7rem] text-slate-500 dark:text-slate-200/60">
          {summary.priceInfoObjectId}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Max price age (secs)
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {formatGuardrailCap(summary.maxPriceAgeSecsCap)}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Max confidence (bps)
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {formatGuardrailCap(summary.maxConfidenceRatioBpsCap)}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Max status lag (secs)
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {formatGuardrailCap(summary.maxPriceStatusLagSecsCap)}
        </div>
      </div>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
      {summary.acceptedCurrencyId ? (
        <CopyableId value={summary.acceptedCurrencyId} label="Accepted ID" />
      ) : null}
      {shopId ? <CopyableId value={shopId} label="Shop ID" /> : null}
    </div>
  </ModalSection>
)

const CurrencyTransactionRecap = ({
  summary,
  explorerUrl
}: {
  summary: CurrencyTransactionSummary
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
              className="text-sds-blue dark:text-sds-blue/80 text-[0.65rem] font-semibold uppercase tracking-[0.18em] hover:text-sds-dark dark:hover:text-sds-light"
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

const CurrencySuccessView = ({
  summary,
  shopId,
  explorerUrl,
  onClose,
  onReset
}: {
  summary: CurrencyTransactionSummary
  shopId?: string
  explorerUrl?: string
  onClose: () => void
  onReset: () => void
}) => (
  <>
    <CurrencySuccessHeader
      currencyLabel={getStructLabel(summary.coinType)}
      onClose={onClose}
    />
    <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-6">
      <CurrencySummarySection summary={summary} shopId={shopId} />
      <CurrencyTransactionRecap summary={summary} explorerUrl={explorerUrl} />
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
            Add another
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

const CurrencyErrorView = ({
  error,
  details,
  currencyLabel,
  onClose,
  onReset
}: {
  error: string
  details?: string
  currencyLabel: string
  onClose: () => void
  onReset: () => void
}) => (
  <>
    <CurrencyErrorHeader currencyLabel={currencyLabel} onClose={onClose} />
    <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-6">
      <CurrencyErrorNotice error={error} details={details} />
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

const AvailableFeedsSection = ({
  acceptedCurrencies
}: {
  acceptedCurrencies: AcceptedCurrencySummary[]
}) => (
  <ModalSection
    title="Available price feeds"
    subtitle="Existing currencies already wired to the shop"
  >
    {acceptedCurrencies.length === 0 ? (
      <div className="text-xs text-slate-500 dark:text-slate-200/60">
        No accepted currencies registered yet.
      </div>
    ) : (
      <div className="space-y-3">
        {acceptedCurrencies.map((currency) => {
          const registryId = resolveCurrencyRegistryId(currency.coinType)
          return (
            <div
              key={currency.acceptedCurrencyId}
              className="rounded-xl border border-slate-200/70 bg-white/85 px-4 py-3 text-xs shadow-[0_12px_28px_-24px_rgba(15,23,42,0.3)] dark:border-slate-50/20 dark:bg-slate-950/60"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-sds-dark dark:text-sds-light">
                    {currency.symbol || getStructLabel(currency.coinType)}
                  </div>
                  <div className="mt-1 text-[0.65rem] text-slate-500 dark:text-slate-200/60">
                    {currency.coinType}
                  </div>
                </div>
                <span className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                  {currency.decimals ?? "--"} decimals
                </span>
              </div>
              <div className="mt-3 grid gap-3 text-[0.65rem] text-slate-500 dark:text-slate-200/70 sm:grid-cols-2">
                <div>
                  <div className="text-[0.55rem] uppercase tracking-[0.18em]">
                    Feed id
                  </div>
                  <div
                    className="mt-1 font-semibold text-sds-dark dark:text-sds-light"
                    title={currency.feedIdHex}
                  >
                    {shortenId(currency.feedIdHex, 10, 8)}
                  </div>
                </div>
                {currency.pythObjectId ? (
                  <div>
                    <div className="text-[0.55rem] uppercase tracking-[0.18em]">
                      Price info object
                    </div>
                    <div className="mt-1 font-semibold text-sds-dark dark:text-sds-light">
                      {shortenId(currency.pythObjectId)}
                    </div>
                  </div>
                ) : null}
                {registryId ? (
                  <div>
                    <div className="text-[0.55rem] uppercase tracking-[0.18em]">
                      Currency registry
                    </div>
                    <div className="mt-1 font-semibold text-sds-dark dark:text-sds-light">
                      {shortenId(registryId)}
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-[0.65rem]">
                <CopyableId value={currency.acceptedCurrencyId} label="Accepted" />
                {currency.pythObjectId ? (
                  <CopyableId value={currency.pythObjectId} label="Pyth" />
                ) : null}
                {registryId ? (
                  <CopyableId value={registryId} label="Registry" />
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    )}
  </ModalSection>
)

const AddCurrencyModal = ({
  open,
  onClose,
  shopId,
  acceptedCurrencies,
  onCurrencyCreated
}: {
  open: boolean
  onClose: () => void
  shopId?: string
  acceptedCurrencies: AcceptedCurrencySummary[]
  onCurrencyCreated?: (currency?: AcceptedCurrencySummary) => void
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

  const [formState, setFormState] = useState<CurrencyFormState>(
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
  } = useIdleFieldValidation<keyof CurrencyFormState>({ idleDelayMs: 600 })

  const walletAddress = currentAccount?.address

  const fieldErrors = useMemo(
    () => buildCurrencyFieldErrors(formState),
    [formState]
  )
  const fieldWarnings = useMemo(
    () => buildCurrencyFieldWarnings(formState),
    [formState]
  )
  const hasFieldErrors = Object.values(fieldErrors).some(Boolean)

  const derivedRegistryId = useMemo(() => {
    if (!formState.coinType.trim()) return undefined
    try {
      const normalized = normalizeCoinType(formState.coinType)
      return deriveCurrencyObjectId(normalized, SUI_COIN_REGISTRY_ID)
    } catch {
      return undefined
    }
  }, [formState.coinType])

  const coinTypeLabel = useMemo(
    () =>
      formState.coinType.trim()
        ? getStructLabel(formState.coinType)
        : "Coin type",
    [formState.coinType]
  )

  const feedIdPreview = useMemo(() => {
    if (!formState.feedId.trim()) return "Enter feed id"
    try {
      return shortenId(ensureHexPrefix(formState.feedId.trim()), 10, 8)
    } catch {
      return "Invalid feed id"
    }
  }, [formState.feedId])

  const priceInfoPreview = useMemo(() => {
    if (!formState.priceInfoObjectId.trim()) return "Enter price info object id"
    return shortenId(formState.priceInfoObjectId.trim())
  }, [formState.priceInfoObjectId])

  const registryPreview = useMemo(() => {
    if (formState.currencyObjectId.trim())
      return shortenId(formState.currencyObjectId.trim())
    return derivedRegistryId ? shortenId(derivedRegistryId) : "Enter coin type"
  }, [derivedRegistryId, formState.currencyObjectId])

  const guardrailPreview = useMemo(
    () => ({
      maxPriceAgeSecsCap: formState.maxPriceAgeSecsCap.trim()
        ? formState.maxPriceAgeSecsCap.trim()
        : "Default",
      maxConfidenceRatioBpsCap: formState.maxConfidenceRatioBpsCap.trim()
        ? formState.maxConfidenceRatioBpsCap.trim()
        : "Default",
      maxPriceStatusLagSecsCap: formState.maxPriceStatusLagSecsCap.trim()
        ? formState.maxPriceStatusLagSecsCap.trim()
        : "Default"
    }),
    [
      formState.maxConfidenceRatioBpsCap,
      formState.maxPriceAgeSecsCap,
      formState.maxPriceStatusLagSecsCap
    ]
  )

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

  const handleInputChange = <K extends keyof CurrencyFormState>(
    key: K,
    value: CurrencyFormState[K]
  ) => {
    markFieldChange(key)
    setFormState((previous) => ({
      ...previous,
      [key]: value
    }))
  }

  const shouldShowFieldError = <K extends keyof CurrencyFormState>(
    key: K,
    error?: string
  ): error is string =>
    Boolean(error && shouldShowFieldFeedback(key, hasAttemptedSubmit))

  const shouldShowFieldWarning = <K extends keyof CurrencyFormState>(
    key: K,
    warning?: string
  ): warning is string =>
    Boolean(warning && shouldShowFieldFeedback(key, hasAttemptedSubmit))

  const handleAddCurrency = async () => {
    setHasAttemptedSubmit(true)

    if (!walletAddress || !shopId) {
      setTransactionState({
        status: "error",
        error: "Wallet and shop details are required to add a currency."
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
      const currencyInputs = parseCurrencyInputs(formState)
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
      const currencyShared = await getSuiSharedObject(
        { objectId: currencyInputs.currencyObjectId, mutable: false },
        { suiClient }
      )
      const priceInfoShared = await getSuiSharedObject(
        { objectId: currencyInputs.priceInfoObjectId, mutable: false },
        { suiClient }
      )

      const addCurrencyTransaction = buildAddAcceptedCurrencyTransaction({
        packageId: shopPackageId,
        coinType: currencyInputs.coinType,
        shop: shopShared,
        currency: currencyShared,
        feedIdBytes: currencyInputs.feedIdBytes,
        pythObjectId: currencyInputs.priceInfoObjectId,
        priceInfoObject: priceInfoShared,
        ownerCapId: ownerCapabilityId,
        maxPriceAgeSecsCap: currencyInputs.maxPriceAgeSecsCap,
        maxConfidenceRatioBpsCap: currencyInputs.maxConfidenceRatioBpsCap,
        maxPriceStatusLagSecsCap: currencyInputs.maxPriceStatusLagSecsCap
      })
      addCurrencyTransaction.setSender(walletAddress)

      let digest = ""
      let transactionBlock: SuiTransactionBlockResponse

      if (isLocalnet) {
        failureStage = "execute"
        const result = await localnetExecutor(addCurrencyTransaction, {
          chain: expectedChain
        })
        digest = result.digest
        transactionBlock = result
      } else {
        failureStage = "execute"
        const result = await signAndExecuteTransaction.mutateAsync({
          transaction: addCurrencyTransaction,
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

      const acceptedCurrencyId = extractCreatedObjects(transactionBlock).find(
        (change) => change.objectType.includes("::shop::AcceptedCurrency")
      )?.objectId

      const optimisticCurrency = acceptedCurrencyId
        ? {
            acceptedCurrencyId,
            markerObjectId: acceptedCurrencyId,
            coinType: currencyInputs.coinType,
            symbol: undefined,
            decimals: undefined,
            feedIdHex: currencyInputs.feedIdHex,
            pythObjectId: currencyInputs.priceInfoObjectId,
            maxPriceAgeSecsCap: currencyInputs.maxPriceAgeSecsCap?.toString(),
            maxConfidenceRatioBpsCap:
              currencyInputs.maxConfidenceRatioBpsCap?.toString(),
            maxPriceStatusLagSecsCap:
              currencyInputs.maxPriceStatusLagSecsCap?.toString()
          }
        : undefined

      setTransactionState({
        status: "success",
        summary: {
          ...currencyInputs,
          digest,
          transactionBlock,
          acceptedCurrencyId
        }
      })

      onCurrencyCreated?.(optimisticCurrency)

      if (acceptedCurrencyId) {
        void getAcceptedCurrencySummary(
          resolvedShopId,
          acceptedCurrencyId,
          suiClient
        )
          .then((summary) => onCurrencyCreated?.(summary))
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
          localnetSupportNote,
          walletContext
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-10 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-4xl overflow-hidden rounded-3xl border border-slate-300/70 bg-white/95 shadow-[0_35px_80px_-55px_rgba(15,23,42,0.55)] dark:border-slate-50/20 dark:bg-slate-950/90">
        {isSuccessState && transactionSummary ? (
          <CurrencySuccessView
            summary={transactionSummary}
            shopId={shopId}
            explorerUrl={explorerUrl}
            onClose={onClose}
            onReset={resetForm}
          />
        ) : isErrorState ? (
          <CurrencyErrorView
            error={transactionState.error}
            details={transactionState.details}
            currencyLabel={coinTypeLabel}
            onClose={onClose}
            onReset={resetForm}
          />
        ) : (
          <>
            <div className="relative overflow-hidden border-b border-slate-200/70 px-6 py-5 dark:border-slate-50/15">
              <div className="absolute inset-0 bg-gradient-to-br from-sds-blue/10 via-white/80 to-sds-pink/15 opacity-80 dark:from-sds-blue/20 dark:via-slate-950/40 dark:to-sds-pink/10" />
              <div className="relative flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-200/60">
                    Accepted currencies
                  </div>
                  <div className="mt-2 text-xl font-semibold text-sds-dark dark:text-sds-light">
                    Add Currency
                  </div>
                  <div className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                    Wire a new coin type to a Pyth price feed.
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
              <AvailableFeedsSection acceptedCurrencies={acceptedCurrencies} />

              <ModalSection
                title="Currency identity"
                subtitle="Describe the coin type and registry object."
              >
                <div className="grid gap-4 md:grid-cols-2 md:items-end">
                  <label className={modalFieldLabelClassName}>
                    <span className={modalFieldTitleClassName}>Coin type</span>
                    <span className={modalFieldDescriptionClassName}>
                      Fully qualified Move type for the coin to accept.
                    </span>
                    <input
                      type="text"
                      value={formState.coinType}
                      onChange={(event) =>
                        handleInputChange("coinType", event.target.value)
                      }
                      onBlur={() => markFieldBlur("coinType")}
                      placeholder="0x2::sui::SUI"
                      className={clsx(
                        modalFieldInputClassName,
                        shouldShowFieldError(
                          "coinType",
                          fieldErrors.coinType
                        ) && modalFieldInputErrorClassName
                      )}
                    />
                    {shouldShowFieldError(
                      "coinType",
                      fieldErrors.coinType
                    ) ? (
                      <span className={modalFieldErrorTextClassName}>
                        {fieldErrors.coinType}
                      </span>
                    ) : null}
                  </label>
                  <label className={modalFieldLabelClassName}>
                    <span className={modalFieldTitleClassName}>
                      Currency registry id (optional)
                    </span>
                    <span className={modalFieldDescriptionClassName}>
                      Currency&lt;T&gt; object id from the coin registry. If
                      omitted, it is derived from the coin type.
                    </span>
                    <input
                      type="text"
                      value={formState.currencyObjectId}
                      onChange={(event) =>
                        handleInputChange("currencyObjectId", event.target.value)
                      }
                      onBlur={() => markFieldBlur("currencyObjectId")}
                      placeholder="0x... registry currency id"
                      className={clsx(
                        modalFieldInputClassName,
                        shouldShowFieldError(
                          "currencyObjectId",
                          fieldErrors.currencyObjectId
                        ) &&
                          modalFieldInputErrorClassName
                      )}
                    />
                    {shouldShowFieldError(
                      "currencyObjectId",
                      fieldErrors.currencyObjectId
                    ) ? (
                      <span className={modalFieldErrorTextClassName}>
                        {fieldErrors.currencyObjectId}
                      </span>
                    ) : null}
                  </label>
                </div>
              </ModalSection>

              <ModalSection
                title="Oracle wiring"
                subtitle="Connect the coin to its Pyth feed."
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <label className={modalFieldLabelClassName}>
                    <span className={modalFieldTitleClassName}>
                      Pyth feed id
                    </span>
                    <span className={modalFieldDescriptionClassName}>
                      32-byte hex identifier for the price feed (0x...).
                    </span>
                    <input
                      type="text"
                      value={formState.feedId}
                      onChange={(event) =>
                        handleInputChange("feedId", event.target.value)
                      }
                      onBlur={() => markFieldBlur("feedId")}
                      placeholder="0x..."
                      className={clsx(
                        modalFieldInputClassName,
                        shouldShowFieldError(
                          "feedId",
                          fieldErrors.feedId
                        ) && modalFieldInputErrorClassName
                      )}
                    />
                    {shouldShowFieldError(
                      "feedId",
                      fieldErrors.feedId
                    ) ? (
                      <span className={modalFieldErrorTextClassName}>
                        {fieldErrors.feedId}
                      </span>
                    ) : null}
                  </label>
                  <label className={modalFieldLabelClassName}>
                    <span className={modalFieldTitleClassName}>
                      Price info object id
                    </span>
                    <span className={modalFieldDescriptionClassName}>
                      Shared PriceInfoObject id matching the selected feed.
                    </span>
                    <input
                      type="text"
                      value={formState.priceInfoObjectId}
                      onChange={(event) =>
                        handleInputChange(
                          "priceInfoObjectId",
                          event.target.value
                        )
                      }
                      onBlur={() => markFieldBlur("priceInfoObjectId")}
                      placeholder="0x... price info object id"
                      className={clsx(
                        modalFieldInputClassName,
                        shouldShowFieldError(
                          "priceInfoObjectId",
                          fieldErrors.priceInfoObjectId
                        ) &&
                          modalFieldInputErrorClassName
                      )}
                    />
                    {shouldShowFieldError(
                      "priceInfoObjectId",
                      fieldErrors.priceInfoObjectId
                    ) ? (
                      <span className={modalFieldErrorTextClassName}>
                        {fieldErrors.priceInfoObjectId}
                      </span>
                    ) : null}
                  </label>
                </div>
              </ModalSection>

              <ModalSection
                title="Guardrails"
                subtitle="Optional caps that override module defaults."
              >
                <div className="grid gap-4 md:grid-cols-3 md:items-end">
                  <label className={modalFieldLabelClassName}>
                    <span className={modalFieldTitleClassName}>
                      Max price age (secs)
                    </span>
                    <span className={modalFieldDescriptionClassName}>
                      Maximum accepted publish time age in seconds.
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formState.maxPriceAgeSecsCap}
                      onChange={(event) =>
                        handleInputChange(
                          "maxPriceAgeSecsCap",
                          event.target.value
                        )
                      }
                      onBlur={() => markFieldBlur("maxPriceAgeSecsCap")}
                      placeholder="Default"
                      className={clsx(
                        modalFieldInputClassName,
                        shouldShowFieldError(
                          "maxPriceAgeSecsCap",
                          fieldErrors.maxPriceAgeSecsCap
                        ) &&
                          modalFieldInputErrorClassName
                      )}
                    />
                    {shouldShowFieldError(
                      "maxPriceAgeSecsCap",
                      fieldErrors.maxPriceAgeSecsCap
                    ) ? (
                      <span className={modalFieldErrorTextClassName}>
                        {fieldErrors.maxPriceAgeSecsCap}
                      </span>
                    ) : shouldShowFieldWarning(
                        "maxPriceAgeSecsCap",
                        fieldWarnings.maxPriceAgeSecsCap
                      ) ? (
                      <span className={modalFieldWarningTextClassName}>
                        {fieldWarnings.maxPriceAgeSecsCap}
                      </span>
                    ) : null}
                  </label>
                  <label className={modalFieldLabelClassName}>
                    <span className={modalFieldTitleClassName}>
                      Max confidence (bps)
                    </span>
                    <span className={modalFieldDescriptionClassName}>
                      Maximum confidence ratio, expressed in basis points.
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formState.maxConfidenceRatioBpsCap}
                      onChange={(event) =>
                        handleInputChange(
                          "maxConfidenceRatioBpsCap",
                          event.target.value
                        )
                      }
                      onBlur={() => markFieldBlur("maxConfidenceRatioBpsCap")}
                      placeholder="Default"
                      className={clsx(
                        modalFieldInputClassName,
                        shouldShowFieldError(
                          "maxConfidenceRatioBpsCap",
                          fieldErrors.maxConfidenceRatioBpsCap
                        ) &&
                          modalFieldInputErrorClassName
                      )}
                    />
                    {shouldShowFieldError(
                      "maxConfidenceRatioBpsCap",
                      fieldErrors.maxConfidenceRatioBpsCap
                    ) ? (
                      <span className={modalFieldErrorTextClassName}>
                        {fieldErrors.maxConfidenceRatioBpsCap}
                      </span>
                    ) : shouldShowFieldWarning(
                        "maxConfidenceRatioBpsCap",
                        fieldWarnings.maxConfidenceRatioBpsCap
                      ) ? (
                      <span className={modalFieldWarningTextClassName}>
                        {fieldWarnings.maxConfidenceRatioBpsCap}
                      </span>
                    ) : null}
                  </label>
                  <label className={modalFieldLabelClassName}>
                    <span className={modalFieldTitleClassName}>
                      Max status lag (secs)
                    </span>
                    <span className={modalFieldDescriptionClassName}>
                      Maximum gap between price status and publish time.
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formState.maxPriceStatusLagSecsCap}
                      onChange={(event) =>
                        handleInputChange(
                          "maxPriceStatusLagSecsCap",
                          event.target.value
                        )
                      }
                      onBlur={() => markFieldBlur("maxPriceStatusLagSecsCap")}
                      placeholder="Default"
                      className={clsx(
                        modalFieldInputClassName,
                        shouldShowFieldError(
                          "maxPriceStatusLagSecsCap",
                          fieldErrors.maxPriceStatusLagSecsCap
                        ) &&
                          modalFieldInputErrorClassName
                      )}
                    />
                    {shouldShowFieldError(
                      "maxPriceStatusLagSecsCap",
                      fieldErrors.maxPriceStatusLagSecsCap
                    ) ? (
                      <span className={modalFieldErrorTextClassName}>
                        {fieldErrors.maxPriceStatusLagSecsCap}
                      </span>
                    ) : shouldShowFieldWarning(
                        "maxPriceStatusLagSecsCap",
                        fieldWarnings.maxPriceStatusLagSecsCap
                      ) ? (
                      <span className={modalFieldWarningTextClassName}>
                        {fieldWarnings.maxPriceStatusLagSecsCap}
                      </span>
                    ) : null}
                  </label>
                </div>
              </ModalSection>

              <ModalSection
                title="Review"
                subtitle="Confirm the currency wiring before submitting."
              >
                <div className="grid gap-3 text-xs sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                    <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                      Coin type
                    </div>
                    <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                      {coinTypeLabel}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                    <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                      Registry id
                    </div>
                    <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                      {registryPreview}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                    <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                      Feed id
                    </div>
                    <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                      {feedIdPreview}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                    <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                      Price info object
                    </div>
                    <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                      {priceInfoPreview}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                    <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                      Max price age
                    </div>
                    <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                      {guardrailPreview.maxPriceAgeSecsCap}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                    <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                      Max confidence
                    </div>
                    <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                      {guardrailPreview.maxConfidenceRatioBpsCap}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60 sm:col-span-2">
                    <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                      Max status lag
                    </div>
                    <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                      {guardrailPreview.maxPriceStatusLagSecsCap}
                    </div>
                  </div>
                </div>
              </ModalSection>
            </div>

            <div className="border-t border-slate-200/70 px-6 py-4 dark:border-slate-50/15">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                  {transactionState.status === "processing"
                    ? "Waiting for wallet confirmation..."
                    : "Ready to register the currency."}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleAddCurrency}
                    disabled={!canSubmit}
                    className={clsx(
                      "border-sds-blue/40 from-sds-blue/20 to-sds-pink/30 focus-visible:ring-sds-blue/40 inline-flex items-center gap-2 rounded-full border bg-gradient-to-r via-white/80 px-5 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-sds-dark shadow-[0_14px_36px_-26px_rgba(77,162,255,0.9)] transition focus-visible:outline-none focus-visible:ring-2 dark:from-sds-blue/20 dark:to-sds-pink/10 dark:via-slate-900/40 dark:text-sds-light",
                      !canSubmit
                        ? "cursor-not-allowed opacity-50"
                        : "hover:-translate-y-0.5 hover:shadow-[0_18px_45px_-25px_rgba(77,162,255,0.9)]"
                    )}
                  >
                    {transactionState.status === "processing"
                      ? "Processing..."
                      : "Add currency"}
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

export default AddCurrencyModal
