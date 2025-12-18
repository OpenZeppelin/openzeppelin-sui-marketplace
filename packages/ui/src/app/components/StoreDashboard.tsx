'use client'

import { useCurrentAccount } from '@mysten/dapp-kit'
import clsx from 'clsx'
import type { AcceptedCurrencySummary } from 'dapp/models/currency'
import type {
  DiscountTemplateSummary,
  DiscountTicketDetails,
} from 'dapp/models/discount'
import type { ItemListingSummary } from 'dapp/models/item-listing'
import type { ShopItemReceiptSummary } from 'dapp/models/shop-item'
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import {
  CONTRACT_PACKAGE_ID_NOT_DEFINED,
  CONTRACT_PACKAGE_VARIABLE_NAME,
  SHOP_ID_NOT_DEFINED,
  SHOP_ID_VARIABLE_NAME,
} from '../config/network'
import useNetworkConfig from '../hooks/useNetworkConfig'
import { useShopDashboardData } from '../hooks/useShopDashboardData'
import Loading from './Loading'

type PanelStatus = {
  status: 'idle' | 'loading' | 'success' | 'error'
  error?: string
}

const resolveConfiguredId = (
  value: string | undefined,
  invalidValue: string
) => {
  if (!value || value === invalidValue) return undefined
  return value
}

const formatUsdFromCents = (rawCents?: string) => {
  if (!rawCents) return 'Unknown'
  try {
    const cents = BigInt(rawCents)
    const dollars = cents / 100n
    const remainder = (cents % 100n).toString().padStart(2, '0')
    return `$${dollars.toString()}.${remainder}`
  } catch {
    return 'Unknown'
  }
}

const formatEpochSeconds = (rawSeconds?: string) => {
  if (!rawSeconds) return 'Unknown'
  const timestamp = Number(rawSeconds) * 1000
  if (!Number.isFinite(timestamp)) return 'Unknown'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  }).format(new Date(timestamp))
}

const shortenId = (value: string, start = 6, end = 4) => {
  if (value.length <= start + end) return value
  return `${value.slice(0, start)}...${value.slice(-end)}`
}

const getStructLabel = (typeName?: string) => {
  if (!typeName) return 'Unknown'
  const fragments = typeName.split('::')
  return fragments[fragments.length - 1] || typeName
}

const buildTemplateLookup = (
  templates: DiscountTemplateSummary[]
) =>
  templates.reduce<Record<string, DiscountTemplateSummary>>(
    (accumulator, template) => ({
      ...accumulator,
      [template.discountTemplateId]: template,
    }),
    {}
  )

const renderPanelBody = ({
  status,
  error,
  isEmpty,
  emptyMessage,
  children,
}: {
  status: PanelStatus['status']
  error?: string
  isEmpty: boolean
  emptyMessage: string
  children: ReactNode
}) => {
  if (status === 'loading') return <Loading />
  if (status === 'error')
    return (
      <div className="rounded-xl border border-rose-200/70 bg-rose-50/60 p-4 text-sm text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10">
        {error || 'Unable to load data.'}
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
  children,
}: {
  title: string
  subtitle?: string
  className?: string
  children: ReactNode
}) => (
  <section
    className={clsx(
      'rounded-2xl border border-slate-200/70 bg-white/80 shadow-[0_18px_60px_-45px_rgba(1,22,49,0.35)] backdrop-blur-sm transition dark:border-slate-50/10 dark:bg-sds-dark/70',
      className
    )}
  >
    <div className="flex flex-col gap-1 border-b border-slate-200/60 px-6 py-4 dark:border-slate-50/10">
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

const SelectedCurrencyPanel = ({
  acceptedCurrencies,
  status,
  error,
  shopConfigured,
}: {
  acceptedCurrencies: AcceptedCurrencySummary[]
  status: PanelStatus['status']
  error?: string
  shopConfigured: boolean
}) => {
  const selectedCurrency = acceptedCurrencies[0]
  const title = selectedCurrency?.symbol || getStructLabel(selectedCurrency?.coinType)
  const subtitle = selectedCurrency?.coinType
    ? getStructLabel(selectedCurrency.coinType)
    : 'No currency configured'

  return (
    <Panel
      title="Accepted Currency"
      subtitle="Primary view"
      className="bg-sds-light/70 dark:bg-sds-dark/80"
    >
      {!shopConfigured ? (
        <div className="text-sm text-slate-500 dark:text-slate-200/70">
          Configure a shop to load currency data.
        </div>
      ) : (
        renderPanelBody({
          status,
          error,
          isEmpty: acceptedCurrencies.length === 0,
          emptyMessage: 'No accepted currencies configured yet.',
          children: (
            <div className="flex flex-col gap-2">
              <div className="text-2xl font-semibold text-sds-dark dark:text-sds-light">
                {title}
              </div>
              <div className="text-sm text-slate-500 dark:text-slate-200/60">
                {subtitle}
              </div>
              <div className="text-xs uppercase tracking-[0.16em] text-slate-400 dark:text-slate-200/40">
                {acceptedCurrencies.length} currency
                {acceptedCurrencies.length === 1 ? '' : 'ies'} accepted
              </div>
            </div>
          ),
        })
      )}
    </Panel>
  )
}

const ItemListingsPanel = ({
  itemListings,
  discountTemplates,
  status,
  error,
  shopConfigured,
}: {
  itemListings: ItemListingSummary[]
  discountTemplates: DiscountTemplateSummary[]
  status: PanelStatus['status']
  error?: string
  shopConfigured: boolean
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
          emptyMessage: 'No item listings are available yet.',
          children: (
            <div className="grid gap-4 lg:grid-cols-2">
              {itemListings.map((listing) => {
                const spotlightTemplate = listing.spotlightTemplateId
                  ? templateLookup[listing.spotlightTemplateId]
                  : undefined
                const spotlightLabel = spotlightTemplate
                  ? spotlightTemplate.ruleDescription
                  : undefined

                return (
                  <div
                    key={listing.itemListingId}
                    className="rounded-xl border border-slate-200/70 bg-white/70 p-4 shadow-sm dark:border-slate-50/10 dark:bg-slate-900/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-lg font-semibold text-sds-dark dark:text-sds-light">
                          {listing.name || getStructLabel(listing.itemType)}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-200/60">
                          {shortenId(listing.itemListingId)}
                        </div>
                      </div>
                      <span className="rounded-full bg-sds-blue/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-sds-dark dark:text-sds-light">
                        {formatUsdFromCents(listing.basePriceUsdCents)}
                      </span>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.12em] text-slate-500 dark:text-slate-200/60">
                      <span>
                        Stock:{' '}
                        <span className="text-slate-800 dark:text-slate-100">
                          {listing.stock ?? 'Unknown'}
                        </span>
                      </span>
                      <span>
                        Discount:{' '}
                        <span className="text-slate-800 dark:text-slate-100">
                          {spotlightLabel || 'None'}
                        </span>
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          ),
        })
      )}
    </Panel>
  )
}

const AcceptedCurrenciesPanel = ({
  acceptedCurrencies,
  status,
  error,
  shopConfigured,
}: {
  acceptedCurrencies: AcceptedCurrencySummary[]
  status: PanelStatus['status']
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
        emptyMessage: 'No accepted currencies registered.',
        children: (
          <div className="flex flex-col gap-3">
            {acceptedCurrencies.map((currency) => (
              <div
                key={currency.acceptedCurrencyId}
                className="flex items-center justify-between rounded-lg border border-slate-200/60 bg-white/60 px-4 py-3 text-sm dark:border-slate-50/10 dark:bg-slate-900/40"
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
                  {currency.decimals ?? '--'} decimals
                </span>
              </div>
            ))}
          </div>
        ),
      })
    )}
  </Panel>
)

const PurchasedItemsPanel = ({
  purchasedItems,
  status,
  error,
  walletConfigured,
}: {
  purchasedItems: ShopItemReceiptSummary[]
  status: PanelStatus['status']
  error?: string
  walletConfigured: boolean
}) => (
  <Panel title="Purchased Items" subtitle="Wallet receipts">
    {!walletConfigured ? (
      <div className="text-sm text-slate-500 dark:text-slate-200/70">
        Connect a wallet and configure the shop to view purchases.
      </div>
    ) : (
      renderPanelBody({
        status,
        error,
        isEmpty: purchasedItems.length === 0,
        emptyMessage: 'No purchases found for this wallet.',
        children: (
          <div className="space-y-3">
            {purchasedItems.map((item) => (
              <div
                key={item.shopItemId}
                className="rounded-xl border border-slate-200/70 bg-white/70 px-4 py-3 text-sm dark:border-slate-50/10 dark:bg-slate-900/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-sds-dark dark:text-sds-light">
                      {item.name || getStructLabel(item.itemType)}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-200/60">
                      Listing {shortenId(item.itemListingAddress)}
                    </div>
                  </div>
                  <div className="text-xs uppercase tracking-[0.12em] text-slate-500 dark:text-slate-200/60">
                    {formatEpochSeconds(item.acquiredAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ),
      })
    )}
  </Panel>
)

const DiscountsPanel = ({
  discountTickets,
  discountTemplates,
  status,
  error,
  walletConfigured,
}: {
  discountTickets: DiscountTicketDetails[]
  discountTemplates: DiscountTemplateSummary[]
  status: PanelStatus['status']
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
          emptyMessage: 'No discount tickets held by this wallet.',
          children: (
            <div className="space-y-3">
              {discountTickets.map((ticket) => {
                const template = templateLookup[ticket.discountTemplateId]
                return (
                  <div
                    key={ticket.discountTicketId}
                    className="rounded-xl border border-slate-200/70 bg-white/70 px-4 py-3 text-sm dark:border-slate-50/10 dark:bg-slate-900/40"
                  >
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sds-dark dark:text-sds-light">
                          {template?.ruleDescription || 'Discount ticket'}
                        </span>
                        <span className="text-xs uppercase tracking-[0.12em] text-slate-500 dark:text-slate-200/60">
                          {template?.status || 'active'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-200/60">
                        {ticket.listingId
                          ? `Listing ${shortenId(ticket.listingId)}`
                          : 'Applies to any listing'}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ),
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
    () =>
      resolveConfiguredId(rawPackageId, CONTRACT_PACKAGE_ID_NOT_DEFINED),
    [rawPackageId]
  )

  const { storefront, wallet } = useShopDashboardData({
    shopId,
    packageId,
    ownerAddress: currentAccount?.address,
  })

  const hasShopConfig = Boolean(shopId)
  const hasWalletConfig = Boolean(
    shopId && packageId && currentAccount?.address
  )

  return (
    <div className="w-full max-w-6xl space-y-6 px-4">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <SelectedCurrencyPanel
            acceptedCurrencies={storefront.acceptedCurrencies}
            status={storefront.status}
            error={storefront.error}
            shopConfigured={hasShopConfig}
          />
          <ItemListingsPanel
            itemListings={storefront.itemListings}
            discountTemplates={storefront.discountTemplates}
            status={storefront.status}
            error={storefront.error}
            shopConfigured={hasShopConfig}
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
    </div>
  )
}

export default StoreDashboard
