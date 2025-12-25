"use client"

import { useSuiClient } from "@mysten/dapp-kit"
import type { SuiClient } from "@mysten/sui/client"
import type { AcceptedCurrencySummary } from "@sui-oracle-market/domain-core/models/currency"
import { getAcceptedCurrencySummaries } from "@sui-oracle-market/domain-core/models/currency"
import type {
  DiscountTemplateSummary,
  DiscountTicketDetails
} from "@sui-oracle-market/domain-core/models/discount"
import {
  formatDiscountTicketStructType,
  getDiscountTemplateSummaries,
  parseDiscountTicketFromObject
} from "@sui-oracle-market/domain-core/models/discount"
import type { ItemListingSummary } from "@sui-oracle-market/domain-core/models/item-listing"
import { getItemListingSummaries } from "@sui-oracle-market/domain-core/models/item-listing"
import type { ShopItemReceiptSummary } from "@sui-oracle-market/domain-core/models/shop-item"
import { getShopItemReceiptSummaries } from "@sui-oracle-market/domain-core/models/shop-item"
import { getShopOverview } from "@sui-oracle-market/domain-core/models/shop"
import {
  deriveRelevantPackageId,
  getAllOwnedObjectsByFilter,
  getSuiObject,
  normalizeOptionalId
} from "@sui-oracle-market/tooling-core/object"
import { useCallback, useEffect, useMemo, useState } from "react"

type RemoteStatus = "idle" | "loading" | "success" | "error"

type StorefrontState = {
  status: RemoteStatus
  error?: string
  acceptedCurrencies: AcceptedCurrencySummary[]
  itemListings: ItemListingSummary[]
  discountTemplates: DiscountTemplateSummary[]
  shopOwnerAddress?: string
}

type WalletState = {
  status: RemoteStatus
  error?: string
  purchasedItems: ShopItemReceiptSummary[]
  discountTickets: DiscountTicketDetails[]
}

type WalletQueryConfig = {
  ownerAddress: string
  shopId: string
  packageId?: string
}

const emptyStorefrontState = (): StorefrontState => ({
  status: "idle",
  acceptedCurrencies: [],
  itemListings: [],
  discountTemplates: [],
  shopOwnerAddress: undefined
})

const emptyWalletState = (): WalletState => ({
  status: "idle",
  purchasedItems: [],
  discountTickets: []
})

const getStorefrontData = async ({
  shopId,
  suiClient
}: {
  shopId: string
  suiClient: SuiClient
}) => {
  const [
    itemListings,
    acceptedCurrencies,
    discountTemplates,
    shopOverview
  ] = await Promise.all([
    getItemListingSummaries(shopId, suiClient),
    getAcceptedCurrencySummaries(shopId, suiClient),
    getDiscountTemplateSummaries(shopId, suiClient),
    getShopOverview(shopId, suiClient)
  ])

  return {
    itemListings,
    acceptedCurrencies,
    discountTemplates,
    shopOwnerAddress: shopOverview.ownerAddress
  }
}

const resolveShopPackageId = async ({
  shopId,
  packageId,
  suiClient
}: {
  shopId: string
  packageId?: string
  suiClient: SuiClient
}): Promise<string | undefined> => {
  try {
    const { object } = await getSuiObject(
      { objectId: shopId, options: { showType: true } },
      { suiClient }
    )

    if (object.type) return deriveRelevantPackageId(object.type)
  } catch {
    // Fall back to the configured package id when the shop lookup fails.
  }

  return normalizeOptionalId(packageId)
}

const getWalletData = async ({
  ownerAddress,
  packageId,
  shopId,
  suiClient
}: {
  ownerAddress: string
  packageId?: string
  shopId?: string
  suiClient: SuiClient
}) => {
  const resolvedPackageId = shopId
    ? await resolveShopPackageId({ shopId, packageId, suiClient })
    : normalizeOptionalId(packageId)

  const [purchasedItems, discountTicketObjects] = await Promise.all([
    resolvedPackageId
      ? getShopItemReceiptSummaries({
          ownerAddress,
          shopPackageId: resolvedPackageId,
          shopFilterId: shopId,
          suiClient
        })
      : Promise.resolve([]),
    resolvedPackageId
      ? getAllOwnedObjectsByFilter(
          {
            ownerAddress,
            filter: {
              StructType: formatDiscountTicketStructType(resolvedPackageId)
            }
          },
          { suiClient }
        )
      : Promise.resolve([])
  ])

  const discountTickets = discountTicketObjects
    .map(parseDiscountTicketFromObject)
    .filter((ticket) => (shopId ? ticket.shopAddress === shopId : true))

  return { purchasedItems, discountTickets }
}

const getWalletQueryConfig = ({
  ownerAddress,
  shopId,
  packageId
}: {
  ownerAddress?: string
  shopId?: string
  packageId?: string
}): WalletQueryConfig | undefined =>
  ownerAddress && shopId ? { ownerAddress, shopId, packageId } : undefined

/**
 * Fetches storefront + wallet data from Sui for the dashboard.
 * Sui state lives in objects, so we query object summaries and owned objects
 * instead of reading contract storage or event logs. The hook separates:
 * - storefront: shared objects like listings, currencies, discount templates
 * - wallet: owned objects like ShopItem receipts and DiscountTicket objects
 * Package ID is resolved from the shop object's type so upgrades stay aligned.
 */
export const useShopDashboardData = ({
  shopId,
  packageId,
  ownerAddress
}: {
  shopId?: string
  packageId?: string
  ownerAddress?: string
}) => {
  const suiClient = useSuiClient()
  const [storefrontState, setStorefrontState] = useState<StorefrontState>(
    emptyStorefrontState()
  )
  const [walletState, setWalletState] =
    useState<WalletState>(emptyWalletState())
  const [storefrontRefreshIndex, setStorefrontRefreshIndex] = useState(0)

  const refreshStorefront = useCallback(() => {
    setStorefrontRefreshIndex((current) => current + 1)
  }, [])

  const upsertAcceptedCurrency = useCallback(
    (currency: AcceptedCurrencySummary) => {
      setStorefrontState((previous) => {
        const existingIndex = previous.acceptedCurrencies.findIndex(
          (item) => item.acceptedCurrencyId === currency.acceptedCurrencyId
        )

        if (existingIndex === -1) {
          return {
            ...previous,
            acceptedCurrencies: [currency, ...previous.acceptedCurrencies]
          }
        }

        const nextCurrencies = [...previous.acceptedCurrencies]
        nextCurrencies[existingIndex] = {
          ...nextCurrencies[existingIndex],
          ...currency
        }

        return {
          ...previous,
          acceptedCurrencies: nextCurrencies
        }
      })
    },
    []
  )

  const upsertItemListing = useCallback((listing: ItemListingSummary) => {
    setStorefrontState((previous) => {
      const existingIndex = previous.itemListings.findIndex(
        (item) => item.itemListingId === listing.itemListingId
      )

      if (existingIndex === -1) {
        return {
          ...previous,
          itemListings: [listing, ...previous.itemListings]
        }
      }

      const nextListings = [...previous.itemListings]
      nextListings[existingIndex] = {
        ...nextListings[existingIndex],
        ...listing
      }

      return {
        ...previous,
        itemListings: nextListings
      }
    })
  }, [])

  const upsertDiscountTemplate = useCallback(
    (template: DiscountTemplateSummary) => {
      setStorefrontState((previous) => {
        const existingIndex = previous.discountTemplates.findIndex(
          (item) => item.discountTemplateId === template.discountTemplateId
        )

        if (existingIndex === -1) {
          return {
            ...previous,
            discountTemplates: [template, ...previous.discountTemplates]
          }
        }

        const nextTemplates = [...previous.discountTemplates]
        nextTemplates[existingIndex] = {
          ...nextTemplates[existingIndex],
          ...template
        }

        return {
          ...previous,
          discountTemplates: nextTemplates
        }
      })
    },
    []
  )

  const hasStorefrontConfig = useMemo(() => Boolean(shopId), [shopId])
  const walletQueryConfig = useMemo(
    () => getWalletQueryConfig({ ownerAddress, shopId, packageId }),
    [ownerAddress, shopId, packageId]
  )

  useEffect(() => {
    if (!hasStorefrontConfig || !shopId) {
      setStorefrontState(emptyStorefrontState())
      return
    }

    let isSubscribed = true
    const currentShopId = shopId
    const loadStorefrontData = async () => {
      setStorefrontState((previous) => ({
        ...previous,
        status: "loading",
        error: undefined
      }))

      try {
        const data = await getStorefrontData({
          shopId: currentShopId,
          suiClient
        })
        if (!isSubscribed) return

        setStorefrontState({
          status: "success",
          error: undefined,
          acceptedCurrencies: data.acceptedCurrencies,
          itemListings: data.itemListings,
          discountTemplates: data.discountTemplates,
          shopOwnerAddress: data.shopOwnerAddress
        })
      } catch (error) {
        if (!isSubscribed) return
        setStorefrontState((previous) => ({
          ...previous,
          status: "error",
          error: error instanceof Error ? error.message : String(error)
        }))
      }
    }

    loadStorefrontData()

    return () => {
      isSubscribed = false
    }
  }, [hasStorefrontConfig, shopId, suiClient, storefrontRefreshIndex])

  useEffect(() => {
    if (!walletQueryConfig) {
      setWalletState(emptyWalletState())
      return
    }

    let isSubscribed = true
    const currentWalletQueryConfig = walletQueryConfig
    const loadWalletData = async () => {
      setWalletState((previous) => ({
        ...previous,
        status: "loading",
        error: undefined
      }))

      try {
        const data = await getWalletData({
          ...currentWalletQueryConfig,
          suiClient
        })

        if (!isSubscribed) return

        setWalletState({
          status: "success",
          error: undefined,
          purchasedItems: data.purchasedItems,
          discountTickets: data.discountTickets
        })
      } catch (error) {
        if (!isSubscribed) return
        setWalletState((previous) => ({
          ...previous,
          status: "error",
          error: error instanceof Error ? error.message : String(error)
        }))
      }
    }

    loadWalletData()

    return () => {
      isSubscribed = false
    }
  }, [walletQueryConfig, suiClient])

  return {
    storefront: storefrontState,
    wallet: walletState,
    refreshStorefront,
    upsertAcceptedCurrency,
    upsertItemListing,
    upsertDiscountTemplate
  }
}
