"use client"

import { useSuiClient } from "@mysten/dapp-kit"
import type { SuiClient } from "@mysten/sui/client"
import type { AcceptedCurrencySummary } from "@sui-oracle-market/domain-core/models/currency"
import { fetchAcceptedCurrencySummaries } from "@sui-oracle-market/domain-core/models/currency"
import type {
  DiscountTemplateSummary,
  DiscountTicketDetails
} from "@sui-oracle-market/domain-core/models/discount"
import {
  fetchDiscountTemplateSummaries,
  formatDiscountTicketStructType,
  parseDiscountTicketFromObject
} from "@sui-oracle-market/domain-core/models/discount"
import type { ItemListingSummary } from "@sui-oracle-market/domain-core/models/item-listing"
import { fetchItemListingSummaries } from "@sui-oracle-market/domain-core/models/item-listing"
import type { ShopItemReceiptSummary } from "@sui-oracle-market/domain-core/models/shop-item"
import { fetchShopItemReceiptSummaries } from "@sui-oracle-market/domain-core/models/shop-item"
import { fetchAllOwnedObjectsByFilter } from "@sui-oracle-market/tooling-core/object"
import { useEffect, useMemo, useState } from "react"

type RemoteStatus = "idle" | "loading" | "success" | "error"

type StorefrontState = {
  status: RemoteStatus
  error?: string
  acceptedCurrencies: AcceptedCurrencySummary[]
  itemListings: ItemListingSummary[]
  discountTemplates: DiscountTemplateSummary[]
}

type WalletState = {
  status: RemoteStatus
  error?: string
  purchasedItems: ShopItemReceiptSummary[]
  discountTickets: DiscountTicketDetails[]
}

const emptyStorefrontState = (): StorefrontState => ({
  status: "idle",
  acceptedCurrencies: [],
  itemListings: [],
  discountTemplates: []
})

const emptyWalletState = (): WalletState => ({
  status: "idle",
  purchasedItems: [],
  discountTickets: []
})

const fetchStorefrontData = async ({
  shopId,
  suiClient
}: {
  shopId: string
  suiClient: SuiClient
}) => {
  const [itemListings, acceptedCurrencies, discountTemplates] =
    await Promise.all([
      fetchItemListingSummaries(shopId, suiClient),
      fetchAcceptedCurrencySummaries(shopId, suiClient),
      fetchDiscountTemplateSummaries(shopId, suiClient)
    ])

  return { itemListings, acceptedCurrencies, discountTemplates }
}

const fetchWalletData = async ({
  ownerAddress,
  packageId,
  shopId,
  suiClient
}: {
  ownerAddress: string
  packageId: string
  shopId?: string
  suiClient: SuiClient
}) => {
  const [purchasedItems, discountTicketObjects] = await Promise.all([
    fetchShopItemReceiptSummaries({
      ownerAddress,
      shopPackageId: packageId,
      shopFilterId: shopId,
      suiClient
    }),
    fetchAllOwnedObjectsByFilter(
      {
        ownerAddress,
        filter: { StructType: formatDiscountTicketStructType(packageId) }
      },
      suiClient
    )
  ])

  const discountTickets = discountTicketObjects
    .map(parseDiscountTicketFromObject)
    .filter((ticket) => (shopId ? ticket.shopAddress === shopId : true))

  return { purchasedItems, discountTickets }
}

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

  const hasStorefrontConfig = useMemo(() => Boolean(shopId), [shopId])
  const hasWalletConfig = useMemo(
    () => Boolean(shopId && packageId && ownerAddress),
    [shopId, packageId, ownerAddress]
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
        const data = await fetchStorefrontData({
          shopId: currentShopId,
          suiClient
        })
        if (!isSubscribed) return

        setStorefrontState({
          status: "success",
          error: undefined,
          acceptedCurrencies: data.acceptedCurrencies,
          itemListings: data.itemListings,
          discountTemplates: data.discountTemplates
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
  }, [hasStorefrontConfig, shopId, suiClient])

  useEffect(() => {
    if (!hasWalletConfig || !ownerAddress || !packageId) {
      setWalletState(emptyWalletState())
      return
    }

    let isSubscribed = true
    const currentOwnerAddress = ownerAddress
    const currentPackageId = packageId
    const loadWalletData = async () => {
      setWalletState((previous) => ({
        ...previous,
        status: "loading",
        error: undefined
      }))

      try {
        const data = await fetchWalletData({
          ownerAddress: currentOwnerAddress,
          packageId: currentPackageId,
          shopId,
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
  }, [hasWalletConfig, ownerAddress, packageId, shopId, suiClient])

  return {
    storefront: storefrontState,
    wallet: walletState
  }
}
