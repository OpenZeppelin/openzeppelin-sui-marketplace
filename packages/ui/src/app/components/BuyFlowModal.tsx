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
import { normalizeSuiAddress } from "@mysten/sui/utils"
import clsx from "clsx"
import { useEffect, useMemo, useState } from "react"

import {
  buildBuyTransaction,
  resolvePaymentCoinObjectId,
  type DiscountContext
} from "@sui-oracle-market/domain-core/flows/buy"
import type { AcceptedCurrencySummary } from "@sui-oracle-market/domain-core/models/currency"
import type {
  DiscountTemplateSummary,
  DiscountTicketDetails
} from "@sui-oracle-market/domain-core/models/discount"
import type { ItemListingSummary } from "@sui-oracle-market/domain-core/models/item-listing"
import {
  deriveRelevantPackageId,
  normalizeIdOrThrow
} from "@sui-oracle-market/tooling-core/object"
import { getSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { ENetwork } from "@sui-oracle-market/tooling-core/types"
import { EXPLORER_URL_VARIABLE_NAME } from "../config/network"
import {
  ModalSection,
  modalFieldDescriptionClassName,
  modalFieldErrorTextClassName,
  modalFieldInputErrorClassName,
  modalFieldInputClassName,
  modalFieldLabelClassName,
  modalFieldTitleClassName,
  modalCloseButtonClassName,
  secondaryActionButtonClassName
} from "./ModalPrimitives"
import { copyToClipboard } from "../helpers/clipboard"
import {
  formatCoinBalance,
  formatUsdFromCents,
  getStructLabel,
  shortenId
} from "../helpers/format"
import {
  extractErrorDetails,
  formatErrorMessage,
  safeJsonStringify,
  serializeForJson
} from "../helpers/transactionErrors"
import { validateOptionalSuiAddress } from "../helpers/inputValidation"
import {
  getLocalnetClient,
  makeLocalnetExecutor,
  walletSupportsChain
} from "../helpers/localnet"
import {
  extractCreatedObjects,
  formatTimestamp,
  summarizeObjectChanges
} from "../helpers/transactionFormat"
import useNetworkConfig from "../hooks/useNetworkConfig"
import { useIdleFieldValidation } from "../hooks/useIdleFieldValidation"
import CopyableId from "./CopyableId"

type CurrencyBalance = AcceptedCurrencySummary & {
  balance: bigint
}

type DiscountOption = {
  id: string
  label: string
  description?: string
  status?: string
  disabled?: boolean
  selection: DiscountContext
}

type BuyFieldErrors = {
  currency?: string
  mintTo?: string
  refundTo?: string
}

const buildBuyFieldErrors = ({
  selectedCurrencyId,
  availableCurrencyCount,
  mintTo,
  refundTo
}: {
  selectedCurrencyId?: string
  availableCurrencyCount: number
  mintTo: string
  refundTo: string
}): BuyFieldErrors => {
  const errors: BuyFieldErrors = {}

  if (availableCurrencyCount > 0 && !selectedCurrencyId)
    errors.currency = "Select a payment currency."

  const mintToError = validateOptionalSuiAddress(
    mintTo,
    "Receipt recipient"
  )
  if (mintToError) errors.mintTo = mintToError

  const refundToError = validateOptionalSuiAddress(
    refundTo,
    "Refund address"
  )
  if (refundToError) errors.refundTo = refundToError

  return errors
}

type TransactionSummary = {
  digest: string
  transactionBlock: SuiTransactionBlockResponse
  paymentCoinObjectId: string
  selectedCurrency: CurrencyBalance
  discountSelection: DiscountContext
  mintTo: string
  refundTo: string
}

type TransactionState =
  | { status: "idle" }
  | { status: "processing" }
  | { status: "success"; summary: TransactionSummary }
  | { status: "error"; error: string; details?: string }

type BalanceStatus =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success" }
  | { status: "error"; error: string }

const getCurrencyLabel = (currency: AcceptedCurrencySummary) =>
  currency.symbol || getStructLabel(currency.coinType)

const getListingLabel = (listing?: ItemListingSummary) =>
  listing?.name || getStructLabel(listing?.itemType)

const parseBalance = (value?: string | number | bigint) => {
  if (value === undefined || value === null) return 0n
  if (typeof value === "bigint") return value
  if (typeof value === "number") return BigInt(Math.trunc(value))
  try {
    return BigInt(value)
  } catch {
    return 0n
  }
}

const buildTemplateLookup = (templates: DiscountTemplateSummary[]) =>
  templates.reduce<Record<string, DiscountTemplateSummary>>(
    (accumulator, template) => ({
      ...accumulator,
      [template.discountTemplateId]: template
    }),
    {}
  )

const resolveBalanceOwner = (owner: {
  AddressOwner?: string
  ObjectOwner?: string
  Shared?: object
  Immutable?: boolean
}) => {
  if ("AddressOwner" in owner) return owner.AddressOwner
  if ("ObjectOwner" in owner) return owner.ObjectOwner
  if ("Shared" in owner) return "Shared"
  if ("Immutable" in owner) return "Immutable"
  return "Unknown"
}

const extractReceiptIds = (transactionBlock: SuiTransactionBlockResponse) =>
  extractCreatedObjects(transactionBlock)
    .filter((change) => change.objectType.includes("::shop::ShopItem"))
    .map((change) => change.objectId)

type GasUsedSummary = NonNullable<
  SuiTransactionBlockResponse["effects"]
>["gasUsed"]

const toGasSummary = (gasUsed?: GasUsedSummary) => {
  if (!gasUsed) return undefined
  const computation = parseBalance(gasUsed.computationCost)
  const storage = parseBalance(gasUsed.storageCost)
  const rebate = parseBalance(gasUsed.storageRebate)
  const total = computation + storage - rebate

  return {
    computation,
    storage,
    rebate,
    total
  }
}

const pickDefaultDiscountOptionId = (options: DiscountOption[]) => {
  const enabledOptions = options.filter((option) => !option.disabled)
  return enabledOptions[0]?.id ?? "none"
}

const buildDiscountOptions = ({
  listing,
  shopId,
  discountTemplates,
  discountTickets
}: {
  listing?: ItemListingSummary
  shopId?: string
  discountTemplates: DiscountTemplateSummary[]
  discountTickets: DiscountTicketDetails[]
}): DiscountOption[] => {
  if (!listing || !shopId) return []
  const templateLookup = buildTemplateLookup(discountTemplates)
  const spotlightTemplate = listing.spotlightTemplateId
    ? templateLookup[listing.spotlightTemplateId]
    : undefined

  const eligibleTickets = discountTickets.filter((ticket) => {
    if (ticket.shopAddress !== shopId) return false
    if (ticket.listingId && ticket.listingId !== listing.itemListingId)
      return false

    const template = templateLookup[ticket.discountTemplateId]
    if (
      template?.appliesToListingId &&
      template.appliesToListingId !== listing.itemListingId
    )
      return false

    return true
  })

  const ticketOptions = eligibleTickets.map((ticket) => {
    const template = templateLookup[ticket.discountTemplateId]
    const status = template?.status
    const isActive = status ? status === "active" : true

    return {
      id: `ticket:${ticket.discountTicketId}`,
      label: template?.ruleDescription || "Discount ticket",
      description: `Use ticket ${shortenId(ticket.discountTicketId)}${
        ticket.listingId ? " for this listing" : ""
      }.`,
      status,
      disabled: !isActive,
      selection: {
        mode: "ticket",
        discountTicketId: ticket.discountTicketId,
        discountTemplateId: ticket.discountTemplateId,
        ticketDetails: ticket
      }
    }
  })

  const claimOption =
    spotlightTemplate &&
    spotlightTemplate.status === "active" &&
    !eligibleTickets.some(
      (ticket) =>
        ticket.discountTemplateId === spotlightTemplate.discountTemplateId
    )
      ? [
          {
            id: "claim",
            label: spotlightTemplate.ruleDescription,
            description:
              "Claim a single-use ticket and redeem it in the same transaction.",
            status: spotlightTemplate.status,
            selection: {
              mode: "claim",
              discountTemplateId: spotlightTemplate.discountTemplateId
            }
          }
        ]
      : []

  return [
    {
      id: "none",
      label: "No discount",
      description: "Checkout without a discount ticket.",
      selection: { mode: "none" }
    },
    ...ticketOptions,
    ...claimOption
  ]
}

const TransactionRecap = ({
  summary,
  explorerUrl
}: {
  summary: TransactionSummary
  explorerUrl?: string
}) => {
  const { transactionBlock, digest, selectedCurrency } = summary
  const status = transactionBlock.effects?.status?.status ?? "unknown"
  const error = transactionBlock.effects?.status?.error
  const gasSummary = toGasSummary(transactionBlock.effects?.gasUsed)
  const receipts = extractReceiptIds(transactionBlock)
  const objectChanges = transactionBlock.objectChanges ?? []
  const objectChangeSummary = summarizeObjectChanges(objectChanges)
  const eventTypes = transactionBlock.events?.map((event) => event.type) ?? []
  const balanceChanges = transactionBlock.balanceChanges ?? []

  const explorerLink =
    explorerUrl && digest ? `${explorerUrl}/txblock/${digest}` : undefined

  return (
    <ModalSection title="Transaction Recap" subtitle="On-chain checkout receipt">
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

        {gasSummary ? (
          <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
            <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
              Gas breakdown
            </div>
            <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
              <div>
                <div className="text-[0.55rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                  Computation
                </div>
                <div>{gasSummary.computation.toString()}</div>
              </div>
              <div>
                <div className="text-[0.55rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                  Storage
                </div>
                <div>{gasSummary.storage.toString()}</div>
              </div>
              <div>
                <div className="text-[0.55rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                  Rebate
                </div>
                <div>{gasSummary.rebate.toString()}</div>
              </div>
            </div>
            <div className="mt-2 text-sm font-semibold text-sds-dark dark:text-sds-light">
              Total gas: {gasSummary.total.toString()}
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
            <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
              Receipts
            </div>
            {receipts.length > 0 ? (
              <div className="mt-2 flex flex-col gap-2">
                {receipts.map((receiptId) => (
                  <CopyableId
                    key={receiptId}
                    value={receiptId}
                    label="ShopItem"
                  />
                ))}
              </div>
            ) : (
              <div className="mt-2 text-xs text-slate-500 dark:text-slate-200/60">
                No ShopItem receipts detected in created objects.
              </div>
            )}
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
            {eventTypes.length > 0 ? (
              <div className="mt-3">
                <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                  Events
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-[0.65rem]">
                  {eventTypes.slice(0, 6).map((eventType) => (
                    <span
                      key={eventType}
                      className="rounded-full border border-slate-200/70 px-2 py-1 text-slate-500 dark:border-slate-50/15 dark:text-slate-200/60"
                    >
                      {eventType.split("::").slice(-1)[0]}
                    </span>
                  ))}
                  {eventTypes.length > 6 ? (
                    <span className="text-slate-500 dark:text-slate-200/60">
                      +{eventTypes.length - 6} more
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {balanceChanges.length > 0 ? (
          <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
            <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
              Balance changes
            </div>
            <div className="mt-2 space-y-2">
              {balanceChanges.slice(0, 6).map((change, index) => {
                const amount = parseBalance(change.amount)
                const sign = amount >= 0n ? "+" : "-"
                const magnitude = amount >= 0n ? amount : -amount
                const formattedAmount =
                  change.coinType === selectedCurrency.coinType &&
                  selectedCurrency.decimals !== undefined
                    ? formatCoinBalance({
                        balance: magnitude,
                        decimals: selectedCurrency.decimals
                      })
                    : magnitude.toString()

                return (
                  <div
                    key={`${change.coinType}-${index}`}
                    className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-200/60"
                  >
                    <span>
                      {sign}
                      {formattedAmount} {getStructLabel(change.coinType)}
                    </span>
                    <span className="text-[0.65rem] uppercase tracking-[0.18em]">
                      {resolveBalanceOwner(change.owner)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}
      </div>
    </ModalSection>
  )
}

const TransactionSuccessHeader = ({
  listingLabel,
  onClose
}: {
  listingLabel: string
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
          Transaction executed
        </div>
        <div className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          {listingLabel}
        </div>
        <div className="mt-2 text-[0.7rem] font-semibold text-emerald-900 dark:text-emerald-100">
          Receipt and balance updates are ready below.
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

const TransactionSuccessView = ({
  summary,
  listingLabel,
  explorerUrl,
  onClose,
  onReset
}: {
  summary: TransactionSummary
  listingLabel: string
  explorerUrl?: string
  onClose: () => void
  onReset: () => void
}) => (
  <>
    <TransactionSuccessHeader listingLabel={listingLabel} onClose={onClose} />
    <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-6">
      <TransactionRecap summary={summary} explorerUrl={explorerUrl} />
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
            Buy another
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

const TransactionErrorHeader = ({
  listingLabel,
  onClose
}: {
  listingLabel: string
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
          Transaction failed
        </div>
        <div className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          {listingLabel}
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

const TransactionErrorView = ({
  error,
  details,
  listingLabel,
  onClose,
  onReset
}: {
  error: string
  details?: string
  listingLabel: string
  onClose: () => void
  onReset: () => void
}) => (
  <>
    <TransactionErrorHeader listingLabel={listingLabel} onClose={onClose} />
    <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-6">
      <TransactionErrorNotice error={error} details={details} />
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

const TransactionErrorNotice = ({
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

/**
 * Checkout flow for Sui.
 * Builds a TransactionBlock with explicit object inputs (shared shop/listing/currency
 * objects plus a coin object used for payment). This is the big mental shift for
 * EVM devs: coins are objects, and writes happen to specific shared objects rather
 * than a single contract address. We sign + execute, then pull the transaction
 * block details (object changes, events, balance changes) for the receipt UI.
 */
const BuyFlowModal = ({
  open,
  onClose,
  shopId,
  listing,
  acceptedCurrencies,
  discountTemplates,
  discountTickets
}: {
  open: boolean
  onClose: () => void
  shopId?: string
  listing?: ItemListingSummary
  acceptedCurrencies: AcceptedCurrencySummary[]
  discountTemplates: DiscountTemplateSummary[]
  discountTickets: DiscountTicketDetails[]
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

  const [balancesByType, setBalancesByType] = useState<Record<string, bigint>>(
    {}
  )
  const [balanceStatus, setBalanceStatus] = useState<BalanceStatus>({
    status: "idle"
  })
  const [selectedCurrencyId, setSelectedCurrencyId] = useState<string>()
  const [selectedDiscountId, setSelectedDiscountId] = useState("none")
  const [mintTo, setMintTo] = useState("")
  const [refundTo, setRefundTo] = useState("")
  const [transactionState, setTransactionState] = useState<TransactionState>({
    status: "idle"
  })
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const {
    markFieldChange,
    markFieldBlur,
    resetFieldState,
    shouldShowFieldFeedback
  } = useIdleFieldValidation<keyof BuyFieldErrors>({ idleDelayMs: 600 })
  const [oracleWarning, setOracleWarning] = useState<string>()
  const [lastWalletContext, setLastWalletContext] =
    useState<Record<string, unknown>>()

  const walletAddress = currentAccount?.address
  const listingLabel = getListingLabel(listing)

  const currencyBalances = useMemo<CurrencyBalance[]>(
    () =>
      acceptedCurrencies.map((currency) => ({
        ...currency,
        balance: balancesByType[currency.coinType] ?? 0n
      })),
    [acceptedCurrencies, balancesByType]
  )

  const availableCurrencies = useMemo(
    () => currencyBalances.filter((currency) => currency.balance > 0n),
    [currencyBalances]
  )

  const discountOptions = useMemo(
    () =>
      buildDiscountOptions({
        listing,
        shopId,
        discountTemplates,
        discountTickets
      }),
    [listing, shopId, discountTemplates, discountTickets]
  )
  const hasDiscountOptions = discountOptions.some(
    (option) => option.id !== "none"
  )

  const selectedCurrency = useMemo(
    () =>
      availableCurrencies.find(
        (currency) => currency.acceptedCurrencyId === selectedCurrencyId
      ),
    [availableCurrencies, selectedCurrencyId]
  )

  const selectedDiscount = useMemo(
    () =>
      discountOptions.find((option) => option.id === selectedDiscountId) ??
      discountOptions[0],
    [discountOptions, selectedDiscountId]
  )

  const fieldErrors = useMemo(
    () =>
      buildBuyFieldErrors({
        selectedCurrencyId,
        availableCurrencyCount: availableCurrencies.length,
        mintTo,
        refundTo
      }),
    [availableCurrencies.length, mintTo, refundTo, selectedCurrencyId]
  )
  const hasFieldErrors = Object.values(fieldErrors).some(Boolean)

  const isSubmissionPending = isLocalnet
    ? signTransaction.isPending
    : signAndExecuteTransaction.isPending

  const canSubmit =
    Boolean(
      walletAddress &&
        shopId &&
        listing &&
        selectedCurrency &&
        selectedDiscount &&
        !hasFieldErrors
    ) &&
    transactionState.status !== "processing" &&
    isSubmissionPending !== true

  const isSuccessState = transactionState.status === "success"
  const isErrorState = transactionState.status === "error"
  const transactionSummary = isSuccessState
    ? transactionState.summary
    : undefined

  const resetTransactionState = () => {
    setTransactionState({ status: "idle" })
    setOracleWarning(undefined)
  }

  useEffect(() => {
    if (!open) return
    setTransactionState({ status: "idle" })
    setOracleWarning(undefined)
    setMintTo(walletAddress ?? "")
    setRefundTo(walletAddress ?? "")
    setHasAttemptedSubmit(false)
    resetFieldState()
  }, [open, listing?.itemListingId, walletAddress])

  useEffect(() => {
    if (!open) {
      setBalancesByType({})
      setBalanceStatus({ status: "idle" })
      setSelectedCurrencyId(undefined)
      setSelectedDiscountId("none")
      return
    }

    if (!walletAddress || acceptedCurrencies.length === 0) return

    let isActive = true
    setBalanceStatus({ status: "loading" })

    const loadBalances = async () => {
      try {
        const balanceEntries = await Promise.all(
          acceptedCurrencies.map(async (currency) => {
            try {
              const balance = await suiClient.getBalance({
                owner: walletAddress,
                coinType: currency.coinType
              })
              return [
                currency.coinType,
                parseBalance(balance.totalBalance)
              ] as const
            } catch {
              return [currency.coinType, 0n] as const
            }
          })
        )

        if (!isActive) return
        setBalancesByType(Object.fromEntries(balanceEntries))
        setBalanceStatus({ status: "success" })
      } catch (error) {
        if (!isActive) return
        setBalanceStatus({
          status: "error",
          error: formatErrorMessage(error)
        })
      }
    }

    loadBalances()

    return () => {
      isActive = false
    }
  }, [open, walletAddress, acceptedCurrencies, suiClient])

  useEffect(() => {
    if (!open) return
    if (availableCurrencies.length === 0) {
      setSelectedCurrencyId(undefined)
      return
    }

    const isSelectedAvailable = availableCurrencies.some(
      (currency) => currency.acceptedCurrencyId === selectedCurrencyId
    )
    if (!isSelectedAvailable)
      setSelectedCurrencyId(availableCurrencies[0].acceptedCurrencyId)
  }, [availableCurrencies, open, selectedCurrencyId])

  useEffect(() => {
    if (!open) return
    if (discountOptions.length === 0) return

    const isSelectionValid = discountOptions.some(
      (option) => option.id === selectedDiscountId
    )
    if (!isSelectionValid)
      setSelectedDiscountId(pickDefaultDiscountOptionId(discountOptions))
  }, [discountOptions, open, selectedDiscountId])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [open, onClose])

  const shouldShowFieldError = <K extends keyof BuyFieldErrors>(
    key: K,
    error?: string
  ): error is string =>
    Boolean(error && shouldShowFieldFeedback(key, hasAttemptedSubmit))

  const handlePurchase = async () => {
    setHasAttemptedSubmit(true)

    if (!walletAddress || !shopId || !listing)
      return setTransactionState({
        status: "error",
        error: "Wallet and listing details are required to purchase."
      })

    if (hasFieldErrors) return

    if (!selectedCurrency)
      return setTransactionState({
        status: "error",
        error: "Select a payment currency to continue."
      })

    if (!selectedDiscount)
      return setTransactionState({
        status: "error",
        error: "Select a discount option to continue."
      })

    const listingSnapshot = listing
    const currencySnapshot = selectedCurrency
    const discountSelection = selectedDiscount.selection

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

    setLastWalletContext(walletContext)

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
    setOracleWarning(undefined)

    let failureStage: "prepare" | "execute" | "fetch" = "prepare"

    try {
      const normalizedMintTo = normalizeSuiAddress(
        mintTo.trim() || walletAddress
      )
      const normalizedRefundTo = normalizeSuiAddress(
        refundTo.trim() || walletAddress
      )

      const shopShared = await getSuiSharedObject(
        { objectId: shopId, mutable: false },
        { suiClient }
      )
      const listingShared = await getSuiSharedObject(
        { objectId: listingSnapshot.itemListingId, mutable: true },
        { suiClient }
      )
      const acceptedCurrencyShared = await getSuiSharedObject(
        { objectId: currencySnapshot.acceptedCurrencyId, mutable: false },
        { suiClient }
      )
      const pythObjectId = normalizeIdOrThrow(
        currencySnapshot.pythObjectId,
        `AcceptedCurrency ${currencySnapshot.acceptedCurrencyId} is missing a pyth_object_id.`
      )
      const pythPriceInfoShared = await getSuiSharedObject(
        { objectId: pythObjectId, mutable: false },
        { suiClient }
      )

      const shopPackageId = deriveRelevantPackageId(shopShared.object.type)
      const paymentCoinObjectId = await resolvePaymentCoinObjectId({
        providedCoinObjectId: undefined,
        coinType: currencySnapshot.coinType,
        signerAddress: walletAddress,
        suiClient
      })

      const buyTransaction = await buildBuyTransaction(
        {
          shopPackageId,
          shopShared,
          itemListingShared: listingShared,
          acceptedCurrencyShared,
          pythPriceInfoShared,
          pythFeedIdHex: currencySnapshot.feedIdHex,
          paymentCoinObjectId,
          coinType: currencySnapshot.coinType,
          itemType: listingSnapshot.itemType,
          mintTo: normalizedMintTo,
          refundTo: normalizedRefundTo,
          maxPriceAgeSecs: undefined,
          maxConfidenceRatioBps: undefined,
          discountContext: discountSelection,
          skipPriceUpdate: false,
          hermesUrlOverride: undefined,
          networkName: network,
          signerAddress: walletAddress,
          onWarning: (message) => setOracleWarning(message)
        },
        suiClient
      )

      let digest = ""
      let transactionBlock: SuiTransactionBlockResponse

      if (isLocalnet) {
        failureStage = "execute"
        const result = await localnetExecutor(buyTransaction, {
          chain: expectedChain
        })
        digest = result.digest
        transactionBlock = result
      } else {
        failureStage = "execute"
        const result = await signAndExecuteTransaction.mutateAsync({
          transaction: buyTransaction,
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

      setTransactionState({
        status: "success",
        summary: {
          digest,
          transactionBlock,
          paymentCoinObjectId,
          selectedCurrency: currencySnapshot,
          discountSelection,
          mintTo: normalizedMintTo,
          refundTo: normalizedRefundTo
        }
      })
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
          walletContext: lastWalletContext ?? walletContext
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-10 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-4xl overflow-hidden rounded-3xl border border-slate-300/70 bg-white/95 shadow-[0_35px_80px_-55px_rgba(15,23,42,0.55)] dark:border-slate-50/20 dark:bg-slate-950/90">
        {isSuccessState && transactionSummary ? (
          <TransactionSuccessView
            summary={transactionSummary}
            listingLabel={listingLabel}
            explorerUrl={explorerUrl}
            onClose={onClose}
            onReset={resetTransactionState}
          />
        ) : isErrorState ? (
          <TransactionErrorView
            error={transactionState.error}
            details={transactionState.details}
            listingLabel={listingLabel}
            onClose={onClose}
            onReset={resetTransactionState}
          />
        ) : (
          <>
            <div className="relative overflow-hidden border-b border-slate-200/70 px-6 py-5 dark:border-slate-50/15">
              <div className="from-sds-blue/10 to-sds-pink/15 dark:from-sds-blue/20 dark:to-sds-pink/10 absolute inset-0 bg-gradient-to-br via-white/80 opacity-80 dark:via-slate-950/40" />
              <div className="relative flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-200/60">
                    Buy Flow
                  </div>
                  <div className="mt-2 text-xl font-semibold text-sds-dark dark:text-sds-light">
                    {listingLabel}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                    <span>
                      Base price:{" "}
                      {formatUsdFromCents(listing?.basePriceUsdCents)}
                    </span>
                    <span>Stock: {listing?.stock ?? "Unknown"}</span>
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
              {listing ? (
                <div className="relative mt-4">
                  <CopyableId value={listing.itemListingId} label="Listing" />
                </div>
              ) : null}
            </div>

            <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-6">
              <ModalSection
                title="Payment currency"
                subtitle="Select from accepted coins you hold in your wallet."
              >
                {balanceStatus.status === "loading" ? (
                  <div className="text-xs text-slate-500 dark:text-slate-200/60">
                    Loading wallet balances...
                  </div>
                ) : balanceStatus.status === "error" ? (
                  <div className="rounded-xl border border-rose-200/70 bg-rose-50/60 p-3 text-xs text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10">
                    {balanceStatus.error}
                  </div>
                ) : availableCurrencies.length === 0 ? (
                  <div className="text-xs text-slate-500 dark:text-slate-200/60">
                    No accepted currencies with a wallet balance detected.
                  </div>
                ) : (
                  <div className="space-y-3">
                    <label className={modalFieldLabelClassName}>
                      <span className={modalFieldTitleClassName}>Currency</span>
                      <span className={modalFieldDescriptionClassName}>
                        Choose which accepted coin to spend for checkout.
                      </span>
                      <select
                        value={selectedCurrencyId ?? ""}
                        onChange={(event) => {
                          markFieldChange("currency")
                          setSelectedCurrencyId(event.target.value)
                        }}
                        onBlur={() => markFieldBlur("currency")}
                        className={clsx(
                          modalFieldInputClassName,
                          shouldShowFieldError(
                            "currency",
                            fieldErrors.currency
                          ) && modalFieldInputErrorClassName
                        )}
                      >
                        {availableCurrencies.map((currency) => (
                          <option
                            key={currency.acceptedCurrencyId}
                            value={currency.acceptedCurrencyId}
                          >
                            {getCurrencyLabel(currency)} ·{" "}
                            {formatCoinBalance({
                              balance: currency.balance,
                              decimals: currency.decimals ?? 9
                            })}
                          </option>
                        ))}
                      </select>
                      {shouldShowFieldError(
                        "currency",
                        fieldErrors.currency
                      ) ? (
                        <span className={modalFieldErrorTextClassName}>
                          {fieldErrors.currency}
                        </span>
                      ) : null}
                    </label>

                    {selectedCurrency ? (
                      <div className="grid gap-3 text-xs sm:grid-cols-2">
                        <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                          <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                            Wallet balance
                          </div>
                          <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                            {formatCoinBalance({
                              balance: selectedCurrency.balance,
                              decimals: selectedCurrency.decimals ?? 9
                            })}{" "}
                            {getCurrencyLabel(selectedCurrency)}
                          </div>
                          <div className="mt-1 text-[0.65rem] text-slate-500 dark:text-slate-200/60">
                            {getStructLabel(selectedCurrency.coinType)}
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                          <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                            Oracle guardrails
                          </div>
                          <div className="mt-2 text-[0.7rem] text-slate-600 dark:text-slate-200/70">
                            Max age:{" "}
                            {selectedCurrency.maxPriceAgeSecsCap ?? "Default"}{" "}
                            sec
                          </div>
                          <div className="mt-1 text-[0.7rem] text-slate-600 dark:text-slate-200/70">
                            Max confidence:{" "}
                            {selectedCurrency.maxConfidenceRatioBpsCap ??
                              "Default"}{" "}
                            bps
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </ModalSection>

              {hasDiscountOptions ? (
                <ModalSection
                  title="Discounts"
                  subtitle="Apply a ticket or claim a spotlighted discount when available."
                >
                  <div className="space-y-3">
                    {discountOptions.map((option) => {
                      const isSelected = option.id === selectedDiscountId
                      return (
                        <label
                          key={option.id}
                          className={clsx(
                            "flex cursor-pointer flex-col gap-0 rounded-xl border px-3 py-3 text-xs transition",
                            isSelected
                              ? "border-sds-blue/60 bg-sds-blue/10"
                              : "border-slate-200/70 bg-white/80 hover:border-slate-300",
                            option.disabled
                              ? "cursor-not-allowed opacity-50"
                              : "",
                            "dark:border-slate-50/15 dark:bg-slate-950/60 dark:hover:border-slate-50/30"
                          )}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 text-sm font-semibold text-sds-dark dark:text-sds-light">
                              <input
                                type="radio"
                                name="discount-option"
                                value={option.id}
                                checked={isSelected}
                                onChange={() =>
                                  setSelectedDiscountId(option.id)
                                }
                                disabled={option.disabled}
                                className="h-4 w-4 accent-sds-blue"
                              />
                              <span>{option.label}</span>
                            </div>
                            {option.status ? (
                              <span className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                                {option.status}
                              </span>
                            ) : null}
                          </div>
                          {option.description ? (
                            <p className="text-[0.7rem] text-slate-500 dark:text-slate-200/60">
                              {option.description}
                            </p>
                          ) : null}
                        </label>
                      )
                    })}
                  </div>
                </ModalSection>
              ) : null}

              <ModalSection
                title="Delivery details"
                subtitle="Receipt minting and refund destinations."
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <label className={modalFieldLabelClassName}>
                    <span className={modalFieldTitleClassName}>
                      Receipt recipient
                    </span>
                    <span className={modalFieldDescriptionClassName}>
                      Receives the on-chain ShopItem object minted after
                      purchase.
                    </span>
                    <input
                      type="text"
                      value={mintTo}
                      onChange={(event) => {
                        markFieldChange("mintTo")
                        setMintTo(event.target.value)
                      }}
                      onBlur={() => markFieldBlur("mintTo")}
                      placeholder={walletAddress || "Wallet address"}
                      className={clsx(
                        modalFieldInputClassName,
                        shouldShowFieldError(
                          "mintTo",
                          fieldErrors.mintTo
                        ) && modalFieldInputErrorClassName
                      )}
                    />
                    {shouldShowFieldError("mintTo", fieldErrors.mintTo) ? (
                      <span className={modalFieldErrorTextClassName}>
                        {fieldErrors.mintTo}
                      </span>
                    ) : null}
                  </label>
                  <label className={modalFieldLabelClassName}>
                    <span className={modalFieldTitleClassName}>
                      Refund address
                    </span>
                    <span className={modalFieldDescriptionClassName}>
                      Receives any unused payment coins after final pricing.
                    </span>
                    <input
                      type="text"
                      value={refundTo}
                      onChange={(event) => {
                        markFieldChange("refundTo")
                        setRefundTo(event.target.value)
                      }}
                      onBlur={() => markFieldBlur("refundTo")}
                      placeholder={walletAddress || "Wallet address"}
                      className={clsx(
                        modalFieldInputClassName,
                        shouldShowFieldError(
                          "refundTo",
                          fieldErrors.refundTo
                        ) && modalFieldInputErrorClassName
                      )}
                    />
                    {shouldShowFieldError("refundTo", fieldErrors.refundTo) ? (
                      <span className={modalFieldErrorTextClassName}>
                        {fieldErrors.refundTo}
                      </span>
                    ) : null}
                  </label>
                </div>
                <div className="mt-3 text-[0.7rem] text-slate-500 dark:text-slate-200/60">
                  Leave empty to default both to your connected wallet.
                </div>
              </ModalSection>

              <ModalSection
                title="Review"
                subtitle="Double-check the checkout inputs before submitting."
              >
                <div className="grid gap-3 text-xs sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                    <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                      Listing
                    </div>
                    <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                      {listingLabel}
                    </div>
                    {listing?.itemListingId ? (
                      <div className="mt-2 text-[0.7rem] text-slate-500 dark:text-slate-200/60">
                        {shortenId(listing.itemListingId)}
                      </div>
                    ) : null}
                  </div>
                  <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                    <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                      Payment currency
                    </div>
                    <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                      {selectedCurrency
                        ? getCurrencyLabel(selectedCurrency)
                        : "Select currency"}
                    </div>
                    {selectedCurrency ? (
                      <div className="mt-2 text-[0.7rem] text-slate-500 dark:text-slate-200/60">
                        {getStructLabel(selectedCurrency.coinType)}
                      </div>
                    ) : null}
                  </div>
                  <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                    <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                      Discount
                    </div>
                    <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                      {selectedDiscount?.label ?? "None"}
                    </div>
                    {selectedDiscount?.description ? (
                      <div className="mt-2 text-[0.7rem] text-slate-500 dark:text-slate-200/60">
                        {selectedDiscount.description}
                      </div>
                    ) : null}
                  </div>
                  <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                    <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                      Recipient
                    </div>
                    <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                      {shortenId(mintTo || walletAddress || "Unknown")}
                    </div>
                    <div className="mt-2 text-[0.7rem] text-slate-500 dark:text-slate-200/60">
                      Refund:{" "}
                      {shortenId(refundTo || walletAddress || "Unknown")}
                    </div>
                  </div>
                </div>
              </ModalSection>

              {oracleWarning ? (
                <div className="rounded-xl border border-amber-200/70 bg-amber-50/70 px-4 py-3 text-xs text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
                  {oracleWarning}
                </div>
              ) : null}

            </div>

            <div className="border-t border-slate-200/70 px-6 py-4 dark:border-slate-50/15">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                  {transactionState.status === "processing"
                    ? "Waiting for wallet confirmation..."
                    : "Ready when you are."}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handlePurchase}
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
                      : "Confirm purchase"}
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

export default BuyFlowModal
