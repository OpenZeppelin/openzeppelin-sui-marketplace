"use client"

import { useSuiClient } from "@mysten/dapp-kit"
import type { SuiClient } from "@mysten/sui/client"
import type { AcceptedCurrencySummary } from "@sui-oracle-market/domain-core/models/currency"
import type { DiscountSummary } from "@sui-oracle-market/domain-core/models/discount"
import type { ItemListingSummary } from "@sui-oracle-market/domain-core/models/item-listing"
import { getShopSnapshot } from "@sui-oracle-market/domain-core/models/shop"
import type { ShopItemReceiptSummary } from "@sui-oracle-market/domain-core/models/shop-item"
import { getShopItemReceiptSummaries } from "@sui-oracle-market/domain-core/models/shop-item"
import { getClockTimestampMs } from "@sui-oracle-market/tooling-core/clock"
import {
  deriveRelevantPackageId,
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
  discounts: DiscountSummary[]
  shopOwnerAddress?: string
  clockTimestampMs?: number
}

type WalletState = {
  status: RemoteStatus
  error?: string
  purchasedItems: ShopItemReceiptSummary[]
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
  discounts: [],
  shopOwnerAddress: undefined,
  clockTimestampMs: undefined
})

const emptyWalletState = (): WalletState => ({
  status: "idle",
  purchasedItems: []
})

const storefrontRetryDelaysMs = [200, 400, 800]

const waitMs = (delayMs: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs)
  })

const isTransientStorefrontError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  const normalizedMessage = message.toLowerCase()
  return (
    normalizedMessage.includes("could not find object") ||
    normalizedMessage.includes("notexists")
  )
}

const getStorefrontData = async ({
  shopId,
  suiClient
}: {
  shopId: string
  suiClient: SuiClient
}) => {
  // Storefront reads shared objects (listings/currencies/discounts), not wallet-owned objects.
  const [snapshot, clockTimestampMs] = await Promise.all([
    getShopSnapshot(shopId, suiClient),
    getClockTimestampMs({}, { suiClient })
  ])

  return {
    itemListings: snapshot.itemListings,
    acceptedCurrencies: snapshot.acceptedCurrencies,
    discounts: snapshot.discounts,
    shopOwnerAddress: snapshot.shopOverview.ownerAddress,
    clockTimestampMs
  }
}

const getStorefrontDataWithRetry = async ({
  shopId,
  suiClient,
  retryDelaysMs = storefrontRetryDelaysMs
}: {
  shopId: string
  suiClient: SuiClient
  retryDelaysMs?: number[]
}) => {
  let lastError: unknown

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      return await getStorefrontData({ shopId, suiClient })
    } catch (error) {
      lastError = error
      const shouldRetry =
        isTransientStorefrontError(error) && attempt < retryDelaysMs.length

      if (!shouldRetry) throw error

      await waitMs(retryDelaysMs[attempt])
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
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
  // Wallet reads owned objects (receipts/tickets) tied to the address.
  const resolvedPackageId = shopId
    ? await resolveShopPackageId({ shopId, packageId, suiClient })
    : normalizeOptionalId(packageId)

  const purchasedItems = resolvedPackageId
    ? await getShopItemReceiptSummaries({
        ownerAddress,
        shopPackageId: resolvedPackageId,
        shopFilterId: shopId,
        suiClient
      })
    : []

  return { purchasedItems }
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

const parseOptionalBigInt = (value?: string) => {
  if (!value) return undefined
  try {
    return BigInt(value)
  } catch {
    return undefined
  }
}

const sortPurchasedItemsLatestFirst = (items: ShopItemReceiptSummary[]) =>
  items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const aTimestamp = parseOptionalBigInt(a.item.acquiredAt) ?? 0n
      const bTimestamp = parseOptionalBigInt(b.item.acquiredAt) ?? 0n

      if (aTimestamp !== bTimestamp) return aTimestamp > bTimestamp ? -1 : 1
      return a.index - b.index
    })
    .map(({ item }) => item)

/**
 * Fetches storefront + wallet data from Sui for the dashboard.
 * Sui state lives in objects, so we query object summaries and owned objects
 * instead of reading contract storage or event logs. The hook separates:
 * - storefront: shared objects like listings, currencies, discounts
 * - wallet: owned objects like ShopItem receipts
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
  const [walletRefreshIndex, setWalletRefreshIndex] = useState(0)

  const refreshStorefront = useCallback(() => {
    setStorefrontRefreshIndex((current) => current + 1)
  }, [])

  const refreshWallet = useCallback(() => {
    setWalletRefreshIndex((current) => current + 1)
  }, [])

  const upsertAcceptedCurrency = useCallback(
    (currency: AcceptedCurrencySummary) => {
      setStorefrontState((previous) => {
        const existingIndex = previous.acceptedCurrencies.findIndex(
          (item) => item.tableEntryFieldId === currency.tableEntryFieldId
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

  const removeItemListing = useCallback((itemListingId: string) => {
    setStorefrontState((previous) => ({
      ...previous,
      itemListings: previous.itemListings.filter(
        (item) => item.itemListingId !== itemListingId
      )
    }))
  }, [])

  const removeAcceptedCurrency = useCallback((tableEntryFieldId: string) => {
    setStorefrontState((previous) => ({
      ...previous,
      acceptedCurrencies: previous.acceptedCurrencies.filter(
        (currency) => currency.tableEntryFieldId !== tableEntryFieldId
      )
    }))
  }, [])

  const upsertDiscount = useCallback((discount: DiscountSummary) => {
    setStorefrontState((previous) => {
      const existingIndex = previous.discounts.findIndex(
        (item) => item.discountId === discount.discountId
      )

      if (existingIndex === -1) {
        return {
          ...previous,
          discounts: [discount, ...previous.discounts]
        }
      }

      const nextDiscounts = [...previous.discounts]
      nextDiscounts[existingIndex] = {
        ...nextDiscounts[existingIndex],
        ...discount
      }

      return {
        ...previous,
        discounts: nextDiscounts
      }
    })
  }, [])

  const upsertPurchasedItem = useCallback((receipt: ShopItemReceiptSummary) => {
    setWalletState((previous) => {
      const existingIndex = previous.purchasedItems.findIndex(
        (item) => item.shopItemId === receipt.shopItemId
      )

      const mergedItems =
        existingIndex === -1
          ? [receipt, ...previous.purchasedItems]
          : previous.purchasedItems.map((item, index) =>
              index === existingIndex ? { ...item, ...receipt } : item
            )

      return {
        ...previous,
        purchasedItems: sortPurchasedItemsLatestFirst(mergedItems)
      }
    })
  }, [])

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
        const data = await getStorefrontDataWithRetry({
          shopId: currentShopId,
          suiClient
        })
        if (!isSubscribed) return

        setStorefrontState({
          status: "success",
          error: undefined,
          acceptedCurrencies: data.acceptedCurrencies,
          itemListings: data.itemListings,
          discounts: data.discounts,
          shopOwnerAddress: data.shopOwnerAddress,
          clockTimestampMs: data.clockTimestampMs
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
      setWalletState({
        ...emptyWalletState(),
        status: "loading",
        error: undefined
      })

      try {
        const data = await getWalletData({
          ...currentWalletQueryConfig,
          suiClient
        })

        if (!isSubscribed) return

        setWalletState({
          status: "success",
          error: undefined,
          purchasedItems: sortPurchasedItemsLatestFirst(data.purchasedItems)
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
  }, [walletQueryConfig, suiClient, walletRefreshIndex])

  return {
    storefront: storefrontState,
    wallet: walletState,
    refreshStorefront,
    refreshWallet,
    upsertAcceptedCurrency,
    upsertItemListing,
    upsertPurchasedItem,
    upsertDiscount,
    removeItemListing,
    removeAcceptedCurrency
  }
}
