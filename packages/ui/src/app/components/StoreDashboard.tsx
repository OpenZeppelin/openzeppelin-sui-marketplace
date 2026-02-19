"use client"

import type { AcceptedCurrencySummary } from "@sui-oracle-market/domain-core/models/currency"
import type {
  DiscountTemplateSummary,
  DiscountTicketDetails
} from "@sui-oracle-market/domain-core/models/discount"
import type { ItemListingSummary } from "@sui-oracle-market/domain-core/models/item-listing"
import type { ShopItemReceiptSummary } from "@sui-oracle-market/domain-core/models/shop-item"
import clsx from "clsx"
import type { ReactNode } from "react"
import { resolveCurrencyRegistryId } from "../helpers/currencyRegistry"
import {
  formatEpochSeconds,
  formatEpochSecondsTime,
  formatUsdFromCents,
  getStructLabel,
  shortenId
} from "../helpers/format"
import useExplorerUrl from "../hooks/useExplorerUrl"
import { useStoreDashboardViewModel } from "../hooks/useStoreDashboardViewModel"
import AddCurrencyModal from "./AddCurrencyModal"
import AddDiscountModal from "./AddDiscountModal"
import AddItemModal from "./AddItemModal"
import Button from "./Button"
import BuyFlowModal from "./BuyFlowModal"
import CopyableId from "./CopyableId"
import Loading from "./Loading"
import RemoveCurrencyModal from "./RemoveCurrencyModal"
import RemoveDiscountModal from "./RemoveDiscountModal"
import RemoveItemModal from "./RemoveItemModal"

type PanelStatus = {
  status: "idle" | "loading" | "success" | "error"
  error?: string
}

const parseOptionalBigInt = (value?: string) => {
  if (!value) return undefined
  try {
    return BigInt(value)
  } catch {
    return undefined
  }
}

const resolveClockNowSeconds = (clockTimestampMs?: number) => {
  if (clockTimestampMs === undefined) return undefined
  const seconds = Math.floor(clockTimestampMs / 1000)
  if (!Number.isFinite(seconds)) return undefined
  return BigInt(seconds)
}

const deriveTemplateStatusFromClock = ({
  template,
  nowSeconds
}: {
  template: DiscountTemplateSummary
  nowSeconds?: bigint
}): string => {
  if (!nowSeconds) return template.status
  if (!template.activeFlag) return "disabled"

  const startsAt = parseOptionalBigInt(template.startsAt)
  const expiresAt = parseOptionalBigInt(template.expiresAt)
  const maxRedemptions = parseOptionalBigInt(template.maxRedemptions)
  const claimsIssued = parseOptionalBigInt(template.claimsIssued) ?? 0n
  const redemptions = parseOptionalBigInt(template.redemptions) ?? 0n

  if (expiresAt !== undefined && nowSeconds >= expiresAt) return "expired"

  if (
    maxRedemptions !== undefined &&
    maxRedemptions > 0n &&
    (claimsIssued >= maxRedemptions || redemptions >= maxRedemptions)
  ) {
    return "maxed"
  }

  if (startsAt !== undefined && nowSeconds < startsAt) return "scheduled"

  return "active"
}

const resolveTemplateStartLabel = ({
  startsAt,
  nowSeconds
}: {
  startsAt?: string
  nowSeconds?: bigint
}) => {
  if (!startsAt) return "now"
  const startsAtSeconds = parseOptionalBigInt(startsAt)
  if (nowSeconds !== undefined && startsAtSeconds !== undefined) {
    if (nowSeconds >= startsAtSeconds) return "now"
  }
  return formatEpochSeconds(startsAt)
}

const renderPanelBody = ({
  status,
  error,
  isEmpty,
  emptyMessage,
  children
}: {
  status: PanelStatus["status"]
  error?: string
  isEmpty: boolean
  emptyMessage: string
  children: ReactNode
}) => {
  if (status === "loading") return <Loading />
  if (status === "error")
    return (
      <div className="rounded-xl border border-rose-200/70 bg-rose-50/60 p-4 text-sm text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10">
        {error || "Unable to load data."}
      </div>
    )
  if (isEmpty)
    return (
      <div className="rounded-xl border border-dashed border-slate-300/60 p-4 text-sm text-slate-500 dark:border-slate-100/20 dark:text-slate-200/70">
        {emptyMessage}
      </div>
    )
  return <>{children}</>
}

const Panel = ({
  title,
  subtitle,
  className,
  headerAction,
  children
}: {
  title: string
  subtitle?: string
  className?: string
  headerAction?: ReactNode
  children: ReactNode
}) => (
  <section
    className={clsx(
      "rounded-2xl border border-slate-300/80 bg-white/90 shadow-[0_22px_65px_-45px_rgba(15,23,42,0.45)] backdrop-blur-md transition dark:border-slate-50/30 dark:bg-slate-950/70",
      className
    )}
  >
    <div className="flex flex-wrap items-start gap-3 border-b border-slate-300/70 px-6 py-4 dark:border-slate-50/25">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-sds-dark dark:text-sds-light">
          {title}
        </h2>
        {subtitle ? (
          <p className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-200/60">
            {subtitle}
          </p>
        ) : undefined}
      </div>
      {headerAction ? (
        <div className="ml-auto flex items-center">{headerAction}</div>
      ) : undefined}
    </div>
    <div className="px-6 py-5">{children}</div>
  </section>
)

const resolveListingActionLabel = ({
  canBuy,
  isOutOfStock
}: {
  canBuy: boolean
  isOutOfStock: boolean
}) => {
  if (!canBuy) return "Manage listing"
  return isOutOfStock ? "Sold out" : ""
}

const resolveListingActionAlignment = ({
  showRemove,
  showBuy
}: {
  showRemove: boolean
  showBuy: boolean
}) => {
  if (showRemove && showBuy) return "justify-between"
  if (showBuy) return "justify-end"
  return "justify-start"
}

const ItemListingsPanel = ({
  itemListings,
  templateLookup,
  status,
  error,
  shopConfigured,
  canBuy,
  onBuy,
  canManageListings,
  onAddItem,
  onRemoveItem,
  explorerUrl
}: {
  itemListings: ItemListingSummary[]
  templateLookup: Record<string, DiscountTemplateSummary>
  status: PanelStatus["status"]
  error?: string
  shopConfigured: boolean
  canBuy: boolean
  onBuy?: (listing: ItemListingSummary) => void
  canManageListings: boolean
  onAddItem?: () => void
  onRemoveItem?: (listing: ItemListingSummary) => void
  explorerUrl?: string
}) => {
  const headerAction = canManageListings ? (
    <Button variant="primary" size="compact" onClick={onAddItem}>
      <span>Add Item</span>
    </Button>
  ) : undefined

  return (
    <Panel
      title="Item Listings"
      subtitle="Storefront inventory"
      headerAction={headerAction}
    >
      {!shopConfigured ? (
        <div className="text-sm text-slate-500 dark:text-slate-200/70">
          Select a shop to load listings from the chain.
        </div>
      ) : (
        <>
          {status === "loading" ? (
            <Loading />
          ) : status === "error" ? (
            <div className="rounded-xl border border-rose-200/70 bg-rose-50/60 p-4 text-sm text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10">
              {error || "Unable to load data."}
            </div>
          ) : itemListings.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300/60 p-4 text-sm text-slate-500 dark:border-slate-100/20 dark:text-slate-200/70">
              No item listings are available yet.
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {itemListings.map((listing) => {
                const spotlightTemplate = listing.spotlightTemplateId
                  ? templateLookup[listing.spotlightTemplateId]
                  : undefined
                const spotlightLabel = spotlightTemplate
                  ? spotlightTemplate.ruleDescription
                  : undefined
                const stockValue = listing.stock
                  ? BigInt(listing.stock)
                  : undefined
                const isOutOfStock =
                  stockValue !== undefined ? stockValue <= 0n : false
                const itemTypeLabel = getStructLabel(listing.itemType)
                const availabilityLabel =
                  stockValue === undefined
                    ? "Availability unknown"
                    : isOutOfStock
                      ? "Sold out"
                      : "In stock"
                const availabilityTone =
                  stockValue === undefined
                    ? "text-slate-600 dark:text-slate-200/70"
                    : isOutOfStock
                      ? "text-rose-600 dark:text-rose-200"
                      : "text-emerald-700 dark:text-emerald-100"
                const showRemove = canManageListings
                const showBuy = canBuy
                const actionLabel = resolveListingActionLabel({
                  canBuy,
                  isOutOfStock
                })
                const actionAlignment = resolveListingActionAlignment({
                  showRemove,
                  showBuy
                })

                return (
                  <div
                    key={listing.itemListingId}
                    className="flex h-full flex-col rounded-xl border border-slate-300/80 bg-white/95 p-4 shadow-[0_12px_30px_-22px_rgba(15,23,42,0.35)] dark:border-slate-50/25 dark:bg-slate-950/60"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-lg font-semibold text-sds-dark dark:text-sds-light">
                          {listing.name || itemTypeLabel}
                        </div>
                        <div className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-200/70">
                          {itemTypeLabel}
                        </div>
                      </div>
                      <span className="bg-sds-blue/15 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-sds-dark dark:text-sds-light">
                        {formatUsdFromCents(listing.basePriceUsdCents)}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-4 text-[0.65rem] text-slate-500 sm:grid-cols-2 sm:gap-x-8 dark:text-slate-200/70">
                      <div>
                        <div className="text-[0.6rem] uppercase tracking-[0.18em]">
                          Availability
                        </div>
                        <div
                          className={clsx(
                            "mt-1 text-sm font-semibold",
                            availabilityTone
                          )}
                        >
                          {availabilityLabel}
                        </div>
                      </div>
                      <div>
                        <div className="text-[0.6rem] uppercase tracking-[0.18em]">
                          Stock
                        </div>
                        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                          {listing.stock ?? "Unknown"}
                        </div>
                      </div>
                      <div>
                        <div className="text-[0.6rem] uppercase tracking-[0.18em]">
                          Discount
                        </div>
                        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                          {spotlightLabel || "None"}
                        </div>
                      </div>
                    </div>
                    {listing.spotlightTemplateId ? (
                      <div className="mt-2 flex flex-col gap-2 text-[0.65rem]">
                        <CopyableId
                          value={listing.spotlightTemplateId}
                          label="Discount"
                          className="w-full justify-start"
                          explorerUrl={explorerUrl}
                        />
                      </div>
                    ) : undefined}
                    <div className="mt-4 flex flex-col gap-2 text-[0.65rem]">
                      <CopyableId
                        value={listing.itemListingId}
                        label="Listing ID"
                        className="w-full justify-start"
                      />
                      <CopyableId
                        value={listing.markerObjectId}
                        label="Marker"
                        className="w-full justify-start"
                        explorerUrl={explorerUrl}
                      />
                    </div>
                    {canBuy || canManageListings ? (
                      <div className="mt-auto space-y-3 pt-5">
                        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                          {actionLabel}
                        </div>
                        <div
                          className={clsx(
                            "flex flex-wrap items-center gap-3",
                            actionAlignment
                          )}
                        >
                          {showRemove ? (
                            <Button
                              variant="danger"
                              size="compact"
                              onClick={() => onRemoveItem?.(listing)}
                            >
                              Remove
                            </Button>
                          ) : undefined}
                          {showBuy ? (
                            <Button
                              variant="primary"
                              size="compact"
                              onClick={() => onBuy?.(listing)}
                              disabled={isOutOfStock}
                              className="group"
                            >
                              <span>Buy</span>
                              <span className="text-[0.6rem] text-slate-500 transition group-hover:text-slate-700 dark:text-slate-200/60 dark:group-hover:text-slate-100">
                                {isOutOfStock ? "Unavailable" : "Now"}
                              </span>
                            </Button>
                          ) : undefined}
                        </div>
                      </div>
                    ) : undefined}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </Panel>
  )
}

const AcceptedCurrenciesPanel = ({
  acceptedCurrencies,
  status,
  error,
  shopConfigured,
  canManageCurrencies,
  onAddCurrency,
  onRemoveCurrency,
  explorerUrl
}: {
  acceptedCurrencies: AcceptedCurrencySummary[]
  status: PanelStatus["status"]
  error?: string
  shopConfigured: boolean
  canManageCurrencies: boolean
  onAddCurrency?: () => void
  onRemoveCurrency?: (currency: AcceptedCurrencySummary) => void
  explorerUrl?: string
}) => (
  <Panel
    title="Accepted Currencies"
    subtitle="Coins / Pyth Feed"
    headerAction={
      canManageCurrencies ? (
        <Button variant="primary" size="compact" onClick={onAddCurrency}>
          <span>Add Currency</span>
        </Button>
      ) : undefined
    }
  >
    {!shopConfigured ? (
      <div className="text-sm text-slate-500 dark:text-slate-200/70">
        Select a shop to load accepted currencies.
      </div>
    ) : (
      renderPanelBody({
        status,
        error,
        isEmpty: acceptedCurrencies.length === 0,
        emptyMessage: "No accepted currencies registered.",
        children: (
          <div className="flex flex-col gap-3">
            {acceptedCurrencies.map((currency) => {
              const registryId = resolveCurrencyRegistryId(currency.coinType)

              return (
                <div
                  key={currency.acceptedCurrencyId}
                  className="flex h-full flex-col rounded-xl border border-slate-300/80 bg-white/95 p-4 shadow-[0_12px_30px_-22px_rgba(15,23,42,0.35)] dark:border-slate-50/25 dark:bg-slate-950/60"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col">
                      <span className="text-lg font-semibold text-sds-dark dark:text-sds-light">
                        {currency.symbol || getStructLabel(currency.coinType)}
                      </span>
                      <CopyableId
                        value={currency.coinType}
                        displayValue={`Coin type ${currency.coinType}`}
                        title="Copy coin type"
                        className="mt-1 w-full justify-start text-sm font-semibold text-slate-500 dark:text-slate-200/70"
                        valueClassName="truncate font-semibold text-slate-500 dark:text-slate-200/70"
                        showExplorer={false}
                      />
                    </div>
                  </div>
                  <div className="mt-4 grid gap-4 text-[0.65rem] text-slate-500 sm:grid-cols-2 sm:gap-x-8 dark:text-slate-200/70">
                    <div>
                      <div className="text-[0.6rem] uppercase tracking-[0.18em]">
                        Feed id
                      </div>
                      <CopyableId
                        value={currency.feedIdHex}
                        displayValue={shortenId(currency.feedIdHex, 10, 8)}
                        title="Copy feed id"
                        className="mt-1 w-full justify-start text-[0.65rem] text-slate-500 dark:text-slate-200/70"
                        valueClassName="truncate font-semibold text-sds-dark dark:text-sds-light"
                        showExplorer={false}
                      />
                    </div>
                    {currency.pythObjectId ? (
                      <div>
                        <div className="text-[0.6rem] uppercase tracking-[0.18em]">
                          Price info
                        </div>
                        <CopyableId
                          value={currency.pythObjectId}
                          displayValue={shortenId(currency.pythObjectId)}
                          title="Copy price info id"
                          className="mt-1 w-full justify-start text-[0.65rem] text-slate-500 dark:text-slate-200/70"
                          valueClassName="truncate font-semibold text-sds-dark dark:text-sds-light"
                          explorerUrl={explorerUrl}
                        />
                      </div>
                    ) : undefined}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-3 text-[0.65rem]">
                    <CopyableId
                      value={currency.acceptedCurrencyId}
                      label="Accepted Currency"
                      explorerUrl={explorerUrl}
                    />
                    {currency.pythObjectId ? (
                      <CopyableId
                        value={currency.pythObjectId}
                        label="Pyth"
                        explorerUrl={explorerUrl}
                      />
                    ) : undefined}
                    {registryId ? (
                      <CopyableId
                        value={registryId}
                        label="Registry"
                        explorerUrl={explorerUrl}
                      />
                    ) : undefined}
                  </div>
                  {canManageCurrencies ? (
                    <div className="mt-auto flex items-center pt-5">
                      <Button
                        variant="danger"
                        size="compact"
                        onClick={() => onRemoveCurrency?.(currency)}
                      >
                        Remove
                      </Button>
                    </div>
                  ) : undefined}
                </div>
              )
            })}
          </div>
        )
      })
    )}
  </Panel>
)

const PurchasedItemsPanel = ({
  purchasedItems,
  status,
  error,
  walletConfigured,
  explorerUrl
}: {
  purchasedItems: ShopItemReceiptSummary[]
  status: PanelStatus["status"]
  error?: string
  walletConfigured: boolean
  explorerUrl?: string
}) => (
  <Panel title="Purchased Items" subtitle="Wallet receipts">
    {!walletConfigured ? (
      <div className="text-sm text-slate-500 dark:text-slate-200/70">
        Connect a wallet to view purchases.
      </div>
    ) : (
      renderPanelBody({
        status,
        error,
        isEmpty: purchasedItems.length === 0,
        emptyMessage: "No purchases found for this wallet.",
        children: (
          <div className="grid gap-4 lg:grid-cols-2">
            {purchasedItems.map((item) => {
              const itemTypeLabel = getStructLabel(item.itemType)
              const purchasedAtDateLabel = formatEpochSeconds(item.acquiredAt)
              const purchasedAtTimeLabel = formatEpochSecondsTime(
                item.acquiredAt
              )
              const itemName = item.name || itemTypeLabel
              return (
                <div
                  key={item.shopItemId}
                  className="flex h-full flex-col rounded-xl border border-slate-300/80 bg-white/95 p-4 shadow-[0_12px_30px_-22px_rgba(15,23,42,0.35)] dark:border-slate-50/25 dark:bg-slate-950/60"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-lg font-semibold text-sds-dark dark:text-sds-light">
                        {itemName}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-200/70">
                        {itemTypeLabel}
                      </div>
                    </div>
                    <span className="bg-sds-blue/15 inline-flex flex-col items-end rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-sds-dark dark:text-sds-light">
                      <span>{purchasedAtDateLabel}</span>
                      <span className="mt-0.5 text-[0.65rem] font-semibold normal-case tracking-normal">
                        {purchasedAtTimeLabel}
                      </span>
                    </span>
                  </div>
                  <div className="mt-4 grid gap-4 text-[0.65rem] text-slate-500 sm:grid-cols-2 sm:gap-x-8 dark:text-slate-200/70">
                    <div>
                      <div className="text-[0.6rem] uppercase tracking-[0.18em]">
                        Receipt
                      </div>
                      <CopyableId
                        value={item.shopItemId}
                        title="Copy receipt id"
                        className="mt-1 w-full justify-start text-[0.65rem] text-slate-500 dark:text-slate-200/70"
                        valueClassName="truncate font-semibold text-sds-dark dark:text-sds-light"
                        explorerUrl={explorerUrl}
                      />
                    </div>
                  </div>
                  <div className="mt-4 flex flex-col gap-2 text-[0.65rem]">
                    <CopyableId
                      value={item.listingId}
                      label="Listing ID"
                      className="w-full justify-start"
                    />
                    <CopyableId
                      value={item.shopId}
                      label="Shop"
                      className="w-full justify-start"
                      explorerUrl={explorerUrl}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )
      })
    )}
  </Panel>
)

const DiscountsPanel = ({
  discountTickets,
  discountTemplates,
  templateLookup,
  storefrontStatus,
  storefrontError,
  clockTimestampMs,
  walletStatus,
  walletError,
  shopConfigured,
  walletConfigured,
  canManageDiscounts,
  onClaimDiscount,
  claimingTemplateId,
  isClaiming,
  onAddDiscount,
  onRemoveDiscount,
  explorerUrl
}: {
  discountTickets: DiscountTicketDetails[]
  discountTemplates: DiscountTemplateSummary[]
  templateLookup: Record<string, DiscountTemplateSummary>
  storefrontStatus: PanelStatus["status"]
  storefrontError?: string
  clockTimestampMs?: number
  walletStatus: PanelStatus["status"]
  walletError?: string
  shopConfigured: boolean
  walletConfigured: boolean
  canManageDiscounts: boolean
  onClaimDiscount?: (template: DiscountTemplateSummary) => void
  claimingTemplateId?: string
  isClaiming?: boolean
  onAddDiscount?: () => void
  onRemoveDiscount?: (template: DiscountTemplateSummary) => void
  explorerUrl?: string
}) => {
  const nowSeconds = resolveClockNowSeconds(clockTimestampMs)

  return (
    <Panel
      title="Discounts"
      subtitle="Templates / Tickets"
      headerAction={
        canManageDiscounts ? (
          <Button variant="primary" size="compact" onClick={onAddDiscount}>
            <span>Add Discount</span>
          </Button>
        ) : undefined
      }
    >
      {!shopConfigured ? (
        <div className="text-sm text-slate-500 dark:text-slate-200/70">
          Select a shop to load discount templates.
        </div>
      ) : (
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="text-[0.6rem] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-200/60">
              Templates
            </div>
            {renderPanelBody({
              status: storefrontStatus,
              error: storefrontError,
              isEmpty: discountTemplates.length === 0,
              emptyMessage: "No discount templates available yet.",
              children: (
                <div className="space-y-3">
                  {discountTemplates.map((template) => {
                    const templateStatus = deriveTemplateStatusFromClock({
                      template,
                      nowSeconds
                    })
                    const hasTicket = discountTickets.some(
                      (ticket) =>
                        ticket.discountTemplateId ===
                        template.discountTemplateId
                    )
                    const isTemplateActive = templateStatus === "active"
                    const isClaimingTemplate =
                      isClaiming === true &&
                      claimingTemplateId === template.discountTemplateId
                    const showDisable = canManageDiscounts
                    const claimBlockingReason = !onClaimDiscount
                      ? "Claim action unavailable."
                      : isClaimingTemplate
                        ? "Claiming in progress."
                        : isClaiming === true
                          ? "Another claim is already in progress."
                          : !isTemplateActive
                            ? `Template is ${templateStatus}.`
                            : hasTicket
                              ? "This wallet already claimed the discount."
                              : undefined
                    const isClaimDisabled =
                      !walletConfigured || Boolean(claimBlockingReason)
                    const actionAlignment = showDisable
                      ? "justify-between"
                      : "justify-end"
                    const claimLabel = isClaimingTemplate
                      ? "Claiming..."
                      : hasTicket
                        ? "Claimed"
                        : "Claim"
                    const claimTitle = walletConfigured
                      ? claimBlockingReason
                      : undefined
                    const isClaimable = !isClaimDisabled
                    console.log(claimTitle)
                    return (
                      <div
                        key={template.discountTemplateId}
                        className={clsx(
                          "flex h-full flex-col rounded-xl border border-slate-300/80 bg-white/95 p-4 shadow-[0_12px_30px_-22px_rgba(15,23,42,0.35)] transition dark:border-slate-50/25 dark:bg-slate-950/60",
                          isClaimable ? "" : "opacity-60"
                        )}
                        title={claimTitle}
                      >
                        <div className="flex flex-1 flex-col gap-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-lg font-semibold text-sds-dark dark:text-sds-light">
                                {template.ruleDescription}
                              </div>
                              {template.appliesToListingId ? (
                                <CopyableId
                                  value={template.appliesToListingId}
                                  displayValue={`Applies to listing ${shortenId(
                                    template.appliesToListingId
                                  )}`}
                                  title="Copy listing id"
                                  className="mt-1 w-full justify-start text-sm font-semibold text-slate-500 dark:text-slate-200/70"
                                  valueClassName="truncate font-semibold text-slate-500 dark:text-slate-200/70"
                                />
                              ) : (
                                <div className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-200/70">
                                  Applies to all listings
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-3">
                              {!canManageDiscounts ? (
                                <span className="text-xs uppercase tracking-[0.12em] text-slate-500 dark:text-slate-200/60">
                                  {templateStatus}
                                </span>
                              ) : undefined}
                            </div>
                          </div>
                          <div className="mt-4 grid gap-4 text-[0.65rem] text-slate-500 sm:grid-cols-2 sm:gap-x-8 dark:text-slate-200/70">
                            <div>
                              <div className="text-[0.6rem] uppercase tracking-[0.18em]">
                                Starts
                              </div>
                              <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                                {resolveTemplateStartLabel({
                                  startsAt: template.startsAt,
                                  nowSeconds
                                })}
                              </div>
                            </div>
                            <div>
                              <div className="text-[0.6rem] uppercase tracking-[0.18em]">
                                Expires
                              </div>
                              <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                                {template.expiresAt
                                  ? formatEpochSeconds(template.expiresAt)
                                  : "never"}
                              </div>
                            </div>
                          </div>
                          <div className="mt-4 flex flex-wrap items-center gap-3 text-[0.65rem]">
                            <CopyableId
                              value={template.discountTemplateId}
                              label="Template"
                              explorerUrl={explorerUrl}
                            />
                          </div>
                          <div
                            className={clsx(
                              "mt-auto flex items-center pt-5",
                              actionAlignment
                            )}
                          >
                            {showDisable ? (
                              <Button
                                variant="danger"
                                size="compact"
                                onClick={() => onRemoveDiscount?.(template)}
                                disabled={!template.activeFlag}
                              >
                                {template.activeFlag ? "Disable" : "Disabled"}
                              </Button>
                            ) : undefined}
                            <Button
                              variant="primary"
                              size="compact"
                              onClick={() => onClaimDiscount?.(template)}
                              disabled={isClaimDisabled}
                              title={claimTitle}
                            >
                              {claimLabel}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
          <div className="space-y-3">
            <div className="text-[0.6rem] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-200/60">
              Tickets
            </div>
            {!walletConfigured ? (
              <div className="text-sm text-slate-500 dark:text-slate-200/70">
                Connect a wallet to view owned discount tickets.
              </div>
            ) : (
              renderPanelBody({
                status: walletStatus,
                error: walletError,
                isEmpty: discountTickets.length === 0,
                emptyMessage: "No discount tickets held by this wallet.",
                children: (
                  <div className="space-y-3">
                    {discountTickets.map((ticket) => {
                      const template = templateLookup[ticket.discountTemplateId]
                      return (
                        <div
                          key={ticket.discountTicketId}
                          className="rounded-xl border border-slate-300/80 bg-white/95 p-4 shadow-[0_12px_30px_-22px_rgba(15,23,42,0.35)] dark:border-slate-50/25 dark:bg-slate-950/60"
                        >
                          <div className="flex flex-col gap-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-lg font-semibold text-sds-dark dark:text-sds-light">
                                  {template?.ruleDescription ||
                                    "Discount ticket"}
                                </div>
                                {ticket.listingId ? (
                                  <CopyableId
                                    value={ticket.listingId}
                                    displayValue={`Applies to listing ${shortenId(
                                      ticket.listingId
                                    )}`}
                                    title="Copy listing id"
                                    className="mt-1 w-full justify-start text-sm font-semibold text-slate-500 dark:text-slate-200/70"
                                    valueClassName="truncate font-semibold text-slate-500 dark:text-slate-200/70"
                                  />
                                ) : (
                                  <div className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-200/70">
                                    Applies to any listing
                                  </div>
                                )}
                              </div>
                              {!canManageDiscounts ? (
                                <span className="text-xs uppercase tracking-[0.12em] text-slate-500 dark:text-slate-200/60">
                                  {template?.status || "active"}
                                </span>
                              ) : undefined}
                            </div>
                            <CopyableId
                              value={ticket.discountTicketId}
                              label="Object ID"
                              explorerUrl={explorerUrl}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </Panel>
  )
}

/**
 * Main dashboard view that binds UI panels to on-chain Sui state.
 * The caller selects which shop is active, while the package ID ensures
 * contract interactions track the right deployment.
 */
const StoreDashboard = ({
  shopId,
  packageId
}: {
  shopId?: string
  packageId?: string
}) => {
  const {
    shopId: resolvedShopId,
    storefront,
    wallet,
    hasShopConfig,
    hasWalletConfig,
    canBuy,
    canManageListings,
    canManageCurrencies,
    canManageDiscounts,
    claimDiscountTicket,
    claimingTemplateId,
    isClaiming,
    discountTemplateLookup,
    modalState,
    openBuyModal,
    closeBuyModal,
    handlePurchaseSuccess,
    openAddItemModal,
    closeAddItemModal,
    openAddDiscountModal,
    closeAddDiscountModal,
    openAddCurrencyModal,
    closeAddCurrencyModal,
    openRemoveItemModal,
    closeRemoveItemModal,
    openRemoveCurrencyModal,
    closeRemoveCurrencyModal,
    openRemoveDiscountModal,
    closeRemoveDiscountModal,
    handleListingCreated,
    handleDiscountCreated,
    handleCurrencyCreated,
    handleListingRemoved,
    handleCurrencyRemoved,
    handleDiscountUpdated
  } = useStoreDashboardViewModel({ shopId, packageId })
  const explorerUrl = useExplorerUrl()

  return (
    <div className="w-full max-w-6xl space-y-6 px-4">
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <ItemListingsPanel
            itemListings={storefront.itemListings}
            templateLookup={discountTemplateLookup}
            status={storefront.status}
            error={storefront.error}
            shopConfigured={hasShopConfig}
            canBuy={canBuy}
            onBuy={openBuyModal}
            canManageListings={canManageListings}
            onAddItem={openAddItemModal}
            onRemoveItem={openRemoveItemModal}
            explorerUrl={explorerUrl}
          />
        </div>
        <AcceptedCurrenciesPanel
          acceptedCurrencies={storefront.acceptedCurrencies}
          status={storefront.status}
          error={storefront.error}
          shopConfigured={hasShopConfig}
          canManageCurrencies={canManageCurrencies}
          onAddCurrency={openAddCurrencyModal}
          onRemoveCurrency={openRemoveCurrencyModal}
          explorerUrl={explorerUrl}
        />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <PurchasedItemsPanel
          purchasedItems={wallet.purchasedItems}
          status={wallet.status}
          error={wallet.error}
          walletConfigured={hasWalletConfig}
          explorerUrl={explorerUrl}
        />
        <DiscountsPanel
          discountTickets={wallet.discountTickets}
          discountTemplates={storefront.discountTemplates}
          templateLookup={discountTemplateLookup}
          storefrontStatus={storefront.status}
          storefrontError={storefront.error}
          clockTimestampMs={storefront.clockTimestampMs}
          walletStatus={wallet.status}
          walletError={wallet.error}
          shopConfigured={hasShopConfig}
          walletConfigured={hasWalletConfig}
          canManageDiscounts={canManageDiscounts}
          onClaimDiscount={claimDiscountTicket}
          claimingTemplateId={claimingTemplateId}
          isClaiming={isClaiming}
          onAddDiscount={openAddDiscountModal}
          onRemoveDiscount={openRemoveDiscountModal}
          explorerUrl={explorerUrl}
        />
      </div>

      <BuyFlowModal
        open={modalState.isBuyModalOpen}
        onClose={closeBuyModal}
        onPurchaseSuccess={handlePurchaseSuccess}
        shopId={resolvedShopId}
        listing={modalState.activeListing ?? undefined}
        acceptedCurrencies={storefront.acceptedCurrencies}
        discountTemplates={storefront.discountTemplates}
        discountTickets={wallet.discountTickets}
      />

      <AddItemModal
        open={modalState.isAddItemModalOpen}
        onClose={closeAddItemModal}
        shopId={resolvedShopId}
        discountTemplates={storefront.discountTemplates}
        onListingCreated={handleListingCreated}
      />

      <AddDiscountModal
        open={modalState.isAddDiscountModalOpen}
        onClose={closeAddDiscountModal}
        shopId={resolvedShopId}
        itemListings={storefront.itemListings}
        onDiscountCreated={handleDiscountCreated}
      />

      <AddCurrencyModal
        open={modalState.isAddCurrencyModalOpen}
        onClose={closeAddCurrencyModal}
        shopId={resolvedShopId}
        acceptedCurrencies={storefront.acceptedCurrencies}
        onCurrencyCreated={handleCurrencyCreated}
      />

      <RemoveItemModal
        open={modalState.isRemoveItemModalOpen}
        onClose={closeRemoveItemModal}
        shopId={resolvedShopId}
        listing={modalState.activeListingToRemove ?? undefined}
        onListingRemoved={handleListingRemoved}
      />

      <RemoveDiscountModal
        open={modalState.isRemoveDiscountModalOpen}
        onClose={closeRemoveDiscountModal}
        shopId={resolvedShopId}
        template={modalState.activeDiscountToRemove ?? undefined}
        onDiscountUpdated={handleDiscountUpdated}
      />

      <RemoveCurrencyModal
        open={modalState.isRemoveCurrencyModalOpen}
        onClose={closeRemoveCurrencyModal}
        shopId={resolvedShopId}
        currency={modalState.activeCurrencyToRemove ?? undefined}
        onCurrencyRemoved={handleCurrencyRemoved}
      />
    </div>
  )
}

export default StoreDashboard
