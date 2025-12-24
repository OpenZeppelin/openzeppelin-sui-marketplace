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
import type { ReactNode } from "react"
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
  formatCoinBalance,
  formatUsdFromCents,
  getStructLabel,
  shortenId
} from "../helpers/format"
import {
  getLocalnetClient,
  makeLocalnetExecutor,
  walletSupportsChain
} from "../helpers/localnet"
import useNetworkConfig from "../hooks/useNetworkConfig"
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const safeJsonStringify = (value: unknown, space?: number) => {
  try {
    return JSON.stringify(
      value,
      (_key, val) => (typeof val === "bigint" ? val.toString() : val),
      space
    )
  } catch {
    return undefined
  }
}

const copyToClipboard = async (value: string) => {
  if (!value) return
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return
    }
  } catch {
    // Fall through to legacy copy path.
  }

  const textarea = document.createElement("textarea")
  textarea.value = value
  textarea.setAttribute("readonly", "true")
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)
  textarea.select()
  try {
    document.execCommand("copy")
  } finally {
    document.body.removeChild(textarea)
  }
}

const serializeForJson = (
  value: unknown,
  seen: WeakSet<object> = new WeakSet()
): unknown => {
  if (typeof value === "bigint") return value.toString()
  if (!isRecord(value)) return value
  if (seen.has(value)) return "[Circular]"
  seen.add(value)

  const output: Record<string, unknown> = {}
  for (const key of Object.getOwnPropertyNames(value)) {
    try {
      output[key] = serializeForJson(
        (value as Record<string, unknown>)[key],
        seen
      )
    } catch (error) {
      output[key] = `[Unreadable: ${String(error)}]`
    }
  }

  if (output.name === undefined && "constructor" in value) {
    const constructorName = (value as { constructor?: { name?: string } })
      .constructor?.name
    if (constructorName) output.name = constructorName
  }

  if (typeof (value as { toString?: () => string }).toString === "function") {
    try {
      output.toString = String(value)
    } catch {
      // Ignore toString errors.
    }
  }

  return output
}

const extractErrorDetails = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause
    }
  }

  if (isRecord(error)) {
    return {
      name: typeof error.name === "string" ? error.name : undefined,
      message: typeof error.message === "string" ? error.message : undefined,
      code: typeof error.code === "string" ? error.code : undefined,
      cause: error.cause
    }
  }

  return { message: safeJsonStringify(error) }
}

const formatErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (isRecord(error)) {
    if (typeof error.message === "string") return error.message
    if (typeof error.name === "string") return error.name
    const serialized = safeJsonStringify(serializeForJson(error))
    if (serialized) return serialized
  }
  const fallback = String(error)
  if (fallback && fallback !== "[object Object]") return fallback
  return "Unexpected error. Check console for details."
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

const formatTimestamp = (timestampMs?: string | number | null) => {
  if (!timestampMs) return "Unknown"
  const timestamp = Number(timestampMs)
  if (!Number.isFinite(timestamp)) return "Unknown"
  return new Date(timestamp).toLocaleString()
}

const extractCreatedObjects = (transactionBlock: SuiTransactionBlockResponse) =>
  (transactionBlock.objectChanges ?? []).filter(
    (
      change
    ): change is { objectId: string; objectType: string; type: "created" } =>
      change.type === "created" &&
      "objectType" in change &&
      typeof change.objectType === "string" &&
      "objectId" in change &&
      typeof change.objectId === "string"
  )

const extractReceiptIds = (transactionBlock: SuiTransactionBlockResponse) =>
  extractCreatedObjects(transactionBlock)
    .filter((change) => change.objectType.includes("::shop::ShopItem"))
    .map((change) => change.objectId)

type ObjectTypeCount = {
  objectType: string
  label: string
  count: number
}

type ObjectChangeDetail = {
  label: string
  count: number
  types: ObjectTypeCount[]
}

const summarizeObjectChanges = (
  objectChanges: SuiTransactionBlockResponse["objectChanges"]
) => {
  const changeTypeLabels = [
    { type: "created", label: "Created" },
    { type: "mutated", label: "Mutated" },
    { type: "transferred", label: "Transferred" },
    { type: "deleted", label: "Deleted" },
    { type: "wrapped", label: "Wrapped" },
    { type: "unwrapped", label: "Unwrapped" },
    { type: "published", label: "Published" }
  ] as const

  if (!objectChanges) {
    return changeTypeLabels.map((item) => ({
      label: item.label,
      count: 0,
      types: []
    }))
  }

  const countByType = new Map<string, number>()
  const objectTypesByChange = new Map<string, Map<string, number>>()

  for (const change of objectChanges) {
    countByType.set(change.type, (countByType.get(change.type) ?? 0) + 1)

    if ("objectType" in change && typeof change.objectType === "string") {
      const typeMap = objectTypesByChange.get(change.type) ?? new Map()
      typeMap.set(change.objectType, (typeMap.get(change.objectType) ?? 0) + 1)
      objectTypesByChange.set(change.type, typeMap)
    }
  }

  return changeTypeLabels.map((item) => {
    const typeMap = objectTypesByChange.get(item.type) ?? new Map()
    const types = Array.from(typeMap.entries())
      .map(([objectType, count]) => ({
        objectType,
        label: getStructLabel(objectType),
        count
      }))
      .sort((a, b) => b.count - a.count)

    return {
      label: item.label,
      count: countByType.get(item.type) ?? 0,
      types
    }
  })
}

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

const modalCloseButtonClassName =
  "rounded-full border border-slate-300/70 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600 transition hover:border-slate-400 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sds-blue/40 dark:border-slate-50/20 dark:bg-slate-950/60 dark:text-slate-200/70 dark:hover:text-slate-100"

const secondaryActionButtonClassName =
  "rounded-full border border-slate-300/70 bg-white/80 px-4 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-slate-600 transition hover:border-slate-400 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sds-blue/40 dark:border-slate-50/20 dark:bg-slate-950/60 dark:text-slate-200/70"

const Section = ({
  title,
  subtitle,
  children
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) => (
  <section className="rounded-2xl border border-slate-200/70 bg-white/90 p-4 shadow-[0_14px_35px_-30px_rgba(15,23,42,0.4)] dark:border-slate-50/15 dark:bg-slate-950/70">
    <div className="mb-3 flex flex-col gap-1">
      <h4 className="text-sm font-semibold text-sds-dark dark:text-sds-light">
        {title}
      </h4>
      {subtitle ? (
        <p className="text-xs text-slate-500 dark:text-slate-200/70">
          {subtitle}
        </p>
      ) : null}
    </div>
    {children}
  </section>
)

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
    <Section title="Transaction Recap" subtitle="On-chain checkout receipt">
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
    </Section>
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

  const isSubmissionPending = isLocalnet
    ? signTransaction.isPending
    : signAndExecuteTransaction.isPending

  const canSubmit =
    Boolean(
      walletAddress && shopId && listing && selectedCurrency && selectedDiscount
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

  const handlePurchase = async () => {
    if (!walletAddress || !shopId || !listing)
      return setTransactionState({
        status: "error",
        error: "Wallet and listing details are required to purchase."
      })

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
              <Section
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
                    <label className="flex flex-col gap-2 text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                      Currency
                      <select
                        value={selectedCurrencyId ?? ""}
                        onChange={(event) =>
                          setSelectedCurrencyId(event.target.value)
                        }
                        className="focus-visible:ring-sds-blue/40 rounded-xl border border-slate-200/80 bg-white/90 px-3 py-2 text-sm text-sds-dark shadow-[0_10px_25px_-20px_rgba(15,23,42,0.35)] focus-visible:outline-none focus-visible:ring-2 dark:border-slate-50/20 dark:bg-slate-950/60 dark:text-sds-light"
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
              </Section>

              {hasDiscountOptions ? (
                <Section
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
                            "flex cursor-pointer flex-col gap-2 rounded-xl border px-3 py-3 text-xs transition",
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
                </Section>
              ) : null}

              <Section
                title="Delivery details"
                subtitle="Receipt minting and refund destinations."
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="flex flex-col gap-2 text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                    Receipt recipient
                    <span className="text-[0.65rem] font-normal normal-case tracking-normal text-slate-500/80 dark:text-slate-200/70">
                      Receives the on-chain ShopItem object minted after
                      purchase.
                    </span>
                    <input
                      type="text"
                      value={mintTo}
                      onChange={(event) => setMintTo(event.target.value)}
                      placeholder={walletAddress || "Wallet address"}
                      className="focus-visible:ring-sds-blue/40 rounded-xl border border-slate-200/80 bg-white/90 px-3 py-2 text-sm text-sds-dark shadow-[0_10px_25px_-20px_rgba(15,23,42,0.35)] focus-visible:outline-none focus-visible:ring-2 dark:border-slate-50/20 dark:bg-slate-950/60 dark:text-sds-light"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                    Refund address
                    <span className="text-[0.65rem] font-normal normal-case tracking-normal text-slate-500/80 dark:text-slate-200/70">
                      Receives any unused payment coins after final pricing.
                    </span>
                    <input
                      type="text"
                      value={refundTo}
                      onChange={(event) => setRefundTo(event.target.value)}
                      placeholder={walletAddress || "Wallet address"}
                      className="focus-visible:ring-sds-blue/40 rounded-xl border border-slate-200/80 bg-white/90 px-3 py-2 text-sm text-sds-dark shadow-[0_10px_25px_-20px_rgba(15,23,42,0.35)] focus-visible:outline-none focus-visible:ring-2 dark:border-slate-50/20 dark:bg-slate-950/60 dark:text-sds-light"
                    />
                  </label>
                </div>
                <div className="mt-3 text-[0.7rem] text-slate-500 dark:text-slate-200/60">
                  Leave empty to default both to your connected wallet.
                </div>
              </Section>

              <Section
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
              </Section>

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
