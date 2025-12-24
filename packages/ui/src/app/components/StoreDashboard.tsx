"use client"

import { useCurrentAccount } from "@mysten/dapp-kit"
import type { AcceptedCurrencySummary } from "@sui-oracle-market/domain-core/models/currency"
import type {
  DiscountTemplateSummary,
  DiscountTicketDetails
} from "@sui-oracle-market/domain-core/models/discount"
import type { ItemListingSummary } from "@sui-oracle-market/domain-core/models/item-listing"
import type { ShopItemReceiptSummary } from "@sui-oracle-market/domain-core/models/shop-item"
import clsx from "clsx"
import type { ReactNode } from "react"
import { useMemo, useState } from "react"
import {
  CONTRACT_PACKAGE_ID_NOT_DEFINED,
  CONTRACT_PACKAGE_VARIABLE_NAME,
  SHOP_ID_NOT_DEFINED,
  SHOP_ID_VARIABLE_NAME
} from "../config/network"
import {
  formatEpochSeconds,
  formatUsdFromCents,
  getStructLabel,
  shortenId
} from "../helpers/format"
import { resolveConfiguredId } from "../helpers/network"
import useNetworkConfig from "../hooks/useNetworkConfig"
import { useShopDashboardData } from "../hooks/useShopDashboardData"
import BuyFlowModal from "./BuyFlowModal"
import CopyableId from "./CopyableId"
import Loading from "./Loading"

type PanelStatus = {
  status: "idle" | "loading" | "success" | "error"
  error?: string
}

const buildTemplateLookup = (templates: DiscountTemplateSummary[]) =>
  templates.reduce<Record<string, DiscountTemplateSummary>>(
    (accumulator, template) => ({
      ...accumulator,
      [template.discountTemplateId]: template
    }),
    {}
  )

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
  children
}: {
  title: string
  subtitle?: string
  className?: string
  children: ReactNode
}) => (
  <section
    className={clsx(
      "rounded-2xl border border-slate-300/80 bg-white/90 shadow-[0_22px_65px_-45px_rgba(15,23,42,0.45)] backdrop-blur-md transition dark:border-slate-50/30 dark:bg-slate-950/70",
      className
    )}
  >
    <div className="flex flex-col gap-1 border-b border-slate-300/70 px-6 py-4 dark:border-slate-50/25">
      <h2 className="text-base font-semibold text-sds-dark dark:text-sds-light">
        {title}
      </h2>
      {subtitle ? (
        <p className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-200/60">
          {subtitle}
        </p>
      ) : null}
    </div>
    <div className="px-6 py-5">{children}</div>
  </section>
)

const ItemListingsPanel = ({
  itemListings,
  discountTemplates,
  status,
  error,
  shopConfigured,
  canBuy,
  onBuy
}: {
  itemListings: ItemListingSummary[]
  discountTemplates: DiscountTemplateSummary[]
  status: PanelStatus["status"]
  error?: string
  shopConfigured: boolean
  canBuy: boolean
  onBuy?: (listing: ItemListingSummary) => void
}) => {
  const templateLookup = useMemo(
    () => buildTemplateLookup(discountTemplates),
    [discountTemplates]
  )

  return (
    <Panel title="Item Listings" subtitle="Storefront inventory">
      {!shopConfigured ? (
        <div className="text-sm text-slate-500 dark:text-slate-200/70">
          Provide a shop id to load listings from the chain.
        </div>
      ) : (
        renderPanelBody({
          status,
          error,
          isEmpty: itemListings.length === 0,
          emptyMessage: "No item listings are available yet.",
          children: (
            <div className="grid gap-4 lg:grid-cols-2">
              {itemListings.map((listing) => {
                const spotlightTemplate = listing.spotlightTemplateId
                  ? templateLookup[listing.spotlightTemplateId]
                  : undefined
                const spotlightLabel = spotlightTemplate
                  ? spotlightTemplate.ruleDescription
                  : undefined
                const stockValue = listing.stock ? BigInt(listing.stock) : null
                const isOutOfStock =
                  stockValue !== null ? stockValue <= 0n : false

                return (
                  <div
                    key={listing.itemListingId}
                    className="rounded-xl border border-slate-300/80 bg-white/95 p-4 shadow-[0_12px_30px_-22px_rgba(15,23,42,0.35)] dark:border-slate-50/25 dark:bg-slate-950/60"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-lg font-semibold text-sds-dark dark:text-sds-light">
                          {listing.name || getStructLabel(listing.itemType)}
                        </div>
                        <CopyableId
                          value={listing.itemListingId}
                          label="Object ID"
                        />
                      </div>
                      <span className="bg-sds-blue/15 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-sds-dark dark:text-sds-light">
                        {formatUsdFromCents(listing.basePriceUsdCents)}
                      </span>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.12em] text-slate-500 dark:text-slate-200/60">
                      <span>
                        Stock:{" "}
                        <span className="text-slate-800 dark:text-slate-100">
                          {listing.stock ?? "Unknown"}
                        </span>
                      </span>
                      <span>
                        Discount:{" "}
                        <span className="text-slate-800 dark:text-slate-100">
                          {spotlightLabel || "None"}
                        </span>
                      </span>
                    </div>
                    {canBuy ? (
                      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                        <div className="text-xs uppercase tracking-[0.14em] text-slate-500 dark:text-slate-200/60">
                          {isOutOfStock ? "Sold out" : "Ready to buy"}
                        </div>
                        <button
                          type="button"
                          onClick={() => onBuy?.(listing)}
                          disabled={isOutOfStock}
                          className={clsx(
                            "border-sds-blue/40 from-sds-blue/20 to-sds-pink/30 focus-visible:ring-sds-blue/40 dark:from-sds-blue/20 dark:to-sds-pink/10 group inline-flex items-center gap-2 rounded-full border bg-gradient-to-r via-white/80 px-4 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-sds-dark shadow-[0_14px_36px_-26px_rgba(77,162,255,0.9)] transition focus-visible:outline-none focus-visible:ring-2 dark:via-slate-900/40 dark:text-sds-light",
                            isOutOfStock
                              ? "cursor-not-allowed opacity-50"
                              : "hover:-translate-y-0.5 hover:shadow-[0_18px_45px_-25px_rgba(77,162,255,0.9)]"
                          )}
                        >
                          <span>Buy</span>
                          <span className="text-[0.55rem] text-slate-500 transition group-hover:text-slate-700 dark:text-slate-200/60 dark:group-hover:text-slate-100">
                            {isOutOfStock ? "Unavailable" : "Now"}
                          </span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )
        })
      )}
    </Panel>
  )
}

const AcceptedCurrenciesPanel = ({
  acceptedCurrencies,
  status,
  error,
  shopConfigured
}: {
  acceptedCurrencies: AcceptedCurrencySummary[]
  status: PanelStatus["status"]
  error?: string
  shopConfigured: boolean
}) => (
  <Panel title="Accepted Currencies" subtitle="On-chain registry">
    {!shopConfigured ? (
      <div className="text-sm text-slate-500 dark:text-slate-200/70">
        Add a shop id to load accepted currencies.
      </div>
    ) : (
      renderPanelBody({
        status,
        error,
        isEmpty: acceptedCurrencies.length === 0,
        emptyMessage: "No accepted currencies registered.",
        children: (
          <div className="flex flex-col gap-3">
            {acceptedCurrencies.map((currency) => (
              <div
                key={currency.acceptedCurrencyId}
                className="flex items-center justify-between rounded-lg border border-slate-300/70 bg-white/90 px-4 py-3 text-sm shadow-[0_10px_24px_-20px_rgba(15,23,42,0.3)] dark:border-slate-50/25 dark:bg-slate-950/60"
              >
                <div className="flex flex-col">
                  <span className="font-semibold text-sds-dark dark:text-sds-light">
                    {currency.symbol || getStructLabel(currency.coinType)}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-200/60">
                    {getStructLabel(currency.coinType)}
                  </span>
                </div>
                <span className="text-xs uppercase tracking-[0.12em] text-slate-500 dark:text-slate-200/60">
                  {currency.decimals ?? "--"} decimals
                </span>
              </div>
            ))}
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
  walletConfigured
}: {
  purchasedItems: ShopItemReceiptSummary[]
  status: PanelStatus["status"]
  error?: string
  walletConfigured: boolean
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
              return (
                <div
                  key={item.shopItemId}
                  className="rounded-xl border border-slate-300/80 bg-white/95 p-4 text-sm shadow-[0_12px_30px_-22px_rgba(15,23,42,0.35)] dark:border-slate-50/25 dark:bg-slate-950/60"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold text-sds-dark dark:text-sds-light">
                        {item.name || itemTypeLabel}
                      </div>
                      <CopyableId value={item.shopItemId} label="Receipt ID" />
                      <div className="mt-2 inline-flex items-center rounded-full bg-sds-blue/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-sds-dark dark:text-sds-light">
                        Type {itemTypeLabel}
                      </div>
                    </div>
                    <div className="text-xs uppercase tracking-[0.12em] text-slate-500 dark:text-slate-200/60">
                      Purchased {formatEpochSeconds(item.acquiredAt)}
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-4 text-xs">
                    <CopyableId
                      value={item.itemListingAddress}
                      label="Listing ID"
                    />
                    <CopyableId value={item.shopAddress} label="Shop ID" />
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
  status,
  error,
  walletConfigured
}: {
  discountTickets: DiscountTicketDetails[]
  discountTemplates: DiscountTemplateSummary[]
  status: PanelStatus["status"]
  error?: string
  walletConfigured: boolean
}) => {
  const templateLookup = useMemo(
    () => buildTemplateLookup(discountTemplates),
    [discountTemplates]
  )

  return (
    <Panel title="Discounts" subtitle="Available tickets">
      {!walletConfigured ? (
        <div className="text-sm text-slate-500 dark:text-slate-200/70">
          Connect a wallet to view owned discount tickets.
        </div>
      ) : (
        renderPanelBody({
          status,
          error,
          isEmpty: discountTickets.length === 0,
          emptyMessage: "No discount tickets held by this wallet.",
          children: (
            <div className="space-y-3">
              {discountTickets.map((ticket) => {
                const template = templateLookup[ticket.discountTemplateId]
                return (
                  <div
                    key={ticket.discountTicketId}
                    className="rounded-xl border border-slate-300/80 bg-white/95 px-4 py-3 text-sm shadow-[0_12px_30px_-22px_rgba(15,23,42,0.35)] dark:border-slate-50/25 dark:bg-slate-950/60"
                  >
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sds-dark dark:text-sds-light">
                          {template?.ruleDescription || "Discount ticket"}
                        </span>
                        <span className="text-xs uppercase tracking-[0.12em] text-slate-500 dark:text-slate-200/60">
                          {template?.status || "active"}
                        </span>
                      </div>
                      <CopyableId
                        value={ticket.discountTicketId}
                        label="Object ID"
                      />
                      <div className="text-xs text-slate-500 dark:text-slate-200/60">
                        {ticket.listingId
                          ? `Listing ${shortenId(ticket.listingId)}`
                          : "Applies to any listing"}
                      </div>
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
}

const StoreDashboard = () => {
  const currentAccount = useCurrentAccount()
  const { useNetworkVariable } = useNetworkConfig()
  const rawShopId = useNetworkVariable(SHOP_ID_VARIABLE_NAME)
  const rawPackageId = useNetworkVariable(CONTRACT_PACKAGE_VARIABLE_NAME)
  const shopId = useMemo(
    () => resolveConfiguredId(rawShopId, SHOP_ID_NOT_DEFINED),
    [rawShopId]
  )
  const packageId = useMemo(
    () => resolveConfiguredId(rawPackageId, CONTRACT_PACKAGE_ID_NOT_DEFINED),
    [rawPackageId]
  )
  const [activeListing, setActiveListing] = useState<ItemListingSummary | null>(
    null
  )
  const [isBuyModalOpen, setIsBuyModalOpen] = useState(false)

  const { storefront, wallet } = useShopDashboardData({
    shopId,
    packageId,
    ownerAddress: currentAccount?.address
  })

  const hasShopConfig = Boolean(shopId)
  const hasWalletConfig = Boolean(shopId && currentAccount?.address)

  const openBuyModal = (listing: ItemListingSummary) => {
    setActiveListing(listing)
    setIsBuyModalOpen(true)
  }

  const closeBuyModal = () => {
    setIsBuyModalOpen(false)
    setActiveListing(null)
  }

  return (
    <div className="w-full max-w-6xl space-y-6 px-4">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <ItemListingsPanel
            itemListings={storefront.itemListings}
            discountTemplates={storefront.discountTemplates}
            status={storefront.status}
            error={storefront.error}
            shopConfigured={hasShopConfig}
            canBuy={Boolean(currentAccount?.address)}
            onBuy={openBuyModal}
          />
        </div>
        <AcceptedCurrenciesPanel
          acceptedCurrencies={storefront.acceptedCurrencies}
          status={storefront.status}
          error={storefront.error}
          shopConfigured={hasShopConfig}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <PurchasedItemsPanel
          purchasedItems={wallet.purchasedItems}
          status={wallet.status}
          error={wallet.error}
          walletConfigured={hasWalletConfig}
        />
        <DiscountsPanel
          discountTickets={wallet.discountTickets}
          discountTemplates={storefront.discountTemplates}
          status={wallet.status}
          error={wallet.error}
          walletConfigured={hasWalletConfig}
        />
      </div>

      <BuyFlowModal
        open={isBuyModalOpen}
        onClose={closeBuyModal}
        shopId={shopId}
        listing={activeListing ?? undefined}
        acceptedCurrencies={storefront.acceptedCurrencies}
        discountTemplates={storefront.discountTemplates}
        discountTickets={wallet.discountTickets}
      />
    </div>
  )
}

export default StoreDashboard
