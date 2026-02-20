"use client"

import { useCurrentAccount } from "@mysten/dapp-kit"
import { normalizeSuiAddress } from "@mysten/sui/utils"
import type { AcceptedCurrencySummary } from "@sui-oracle-market/domain-core/models/currency"
import type {
  DiscountTemplateSummary,
  DiscountTicketDetails
} from "@sui-oracle-market/domain-core/models/discount"
import type { ItemListingSummary } from "@sui-oracle-market/domain-core/models/item-listing"
import { useCallback, useMemo, useState } from "react"
import { CONTRACT_PACKAGE_ID_NOT_DEFINED } from "../config/network"
import { buildDiscountTemplateLookup } from "../helpers/discountTemplates"
import { resolveConfiguredId } from "../helpers/network"
import type { PurchaseSuccessPayload } from "./useBuyFlowModalState"
import { useClaimDiscountTicketAction } from "./useClaimDiscountTicketAction"
import { useShopDashboardData } from "./useShopDashboardData"

type DashboardModalState = {
  activeListing: ItemListingSummary | undefined
  activeListingToRemove: ItemListingSummary | undefined
  activeCurrencyToRemove: AcceptedCurrencySummary | undefined
  activeDiscountToRemove: DiscountTemplateSummary | undefined
  isBuyModalOpen: boolean
  isAddItemModalOpen: boolean
  isAddDiscountModalOpen: boolean
  isAddCurrencyModalOpen: boolean
  isRemoveItemModalOpen: boolean
  isRemoveCurrencyModalOpen: boolean
  isRemoveDiscountModalOpen: boolean
}

const emptyModalState = (): DashboardModalState => ({
  activeListing: undefined,
  activeListingToRemove: undefined,
  activeCurrencyToRemove: undefined,
  activeDiscountToRemove: undefined,
  isBuyModalOpen: false,
  isAddItemModalOpen: false,
  isAddDiscountModalOpen: false,
  isAddCurrencyModalOpen: false,
  isRemoveItemModalOpen: false,
  isRemoveCurrencyModalOpen: false,
  isRemoveDiscountModalOpen: false
})

export const useStoreDashboardViewModel = ({
  shopId,
  packageId
}: {
  shopId?: string
  packageId?: string
}) => {
  const currentAccount = useCurrentAccount()
  const resolvedPackageId = useMemo(
    () => resolveConfiguredId(packageId, CONTRACT_PACKAGE_ID_NOT_DEFINED),
    [packageId]
  )

  const [modalState, setModalState] =
    useState<DashboardModalState>(emptyModalState())

  const {
    storefront,
    wallet,
    refreshStorefront,
    refreshWallet,
    upsertAcceptedCurrency,
    upsertItemListing,
    upsertPurchasedItem,
    upsertDiscountTemplate,
    upsertDiscountTicket,
    removeItemListing,
    removeAcceptedCurrency
  } = useShopDashboardData({
    shopId,
    packageId: resolvedPackageId,
    ownerAddress: currentAccount?.address
  })

  const hasShopConfig = Boolean(shopId)
  const hasWalletConfig = Boolean(shopId && currentAccount?.address)
  const normalizedOwnerAddress = storefront.shopOwnerAddress
    ? normalizeSuiAddress(storefront.shopOwnerAddress)
    : undefined
  const normalizedWalletAddress = currentAccount?.address
    ? normalizeSuiAddress(currentAccount.address)
    : undefined
  const isShopOwner = Boolean(
    normalizedOwnerAddress &&
    normalizedWalletAddress &&
    normalizedOwnerAddress === normalizedWalletAddress
  )

  const discountTemplateLookup = useMemo(
    () => buildDiscountTemplateLookup(storefront.discountTemplates),
    [storefront.discountTemplates]
  )

  const handleDiscountTicketClaimed = useCallback(
    (ticket?: DiscountTicketDetails) => {
      if (ticket) {
        upsertDiscountTicket(ticket)
      } else {
        refreshWallet()
      }
      refreshStorefront()
    },
    [refreshStorefront, refreshWallet, upsertDiscountTicket]
  )

  const { claimingTemplateId, isClaiming, handleClaimDiscount } =
    useClaimDiscountTicketAction({
      shopId,
      onClaimed: handleDiscountTicketClaimed
    })

  const openBuyModal = useCallback((listing: ItemListingSummary) => {
    setModalState((previous) => ({
      ...previous,
      activeListing: listing,
      isBuyModalOpen: true
    }))
  }, [])

  const closeBuyModal = useCallback(() => {
    setModalState((previous) => ({
      ...previous,
      activeListing: undefined,
      isBuyModalOpen: false
    }))
  }, [])

  const handlePurchaseSuccess = useCallback(
    ({ receipts }: PurchaseSuccessPayload) => {
      if (receipts.length > 0) {
        receipts.forEach(upsertPurchasedItem)
      }
      refreshWallet()
    },
    [refreshWallet, upsertPurchasedItem]
  )

  const openAddItemModal = useCallback(() => {
    setModalState((previous) => ({ ...previous, isAddItemModalOpen: true }))
  }, [])

  const closeAddItemModal = useCallback(() => {
    setModalState((previous) => ({ ...previous, isAddItemModalOpen: false }))
  }, [])

  const openAddDiscountModal = useCallback(() => {
    setModalState((previous) => ({
      ...previous,
      isAddDiscountModalOpen: true
    }))
  }, [])

  const closeAddDiscountModal = useCallback(() => {
    setModalState((previous) => ({
      ...previous,
      isAddDiscountModalOpen: false
    }))
  }, [])

  const openAddCurrencyModal = useCallback(() => {
    setModalState((previous) => ({
      ...previous,
      isAddCurrencyModalOpen: true
    }))
  }, [])

  const closeAddCurrencyModal = useCallback(() => {
    setModalState((previous) => ({
      ...previous,
      isAddCurrencyModalOpen: false
    }))
  }, [])

  const openRemoveItemModal = useCallback((listing: ItemListingSummary) => {
    setModalState((previous) => ({
      ...previous,
      activeListingToRemove: listing,
      isRemoveItemModalOpen: true
    }))
  }, [])

  const closeRemoveItemModal = useCallback(() => {
    setModalState((previous) => ({
      ...previous,
      activeListingToRemove: undefined,
      isRemoveItemModalOpen: false
    }))
  }, [])

  const openRemoveCurrencyModal = useCallback(
    (currency: AcceptedCurrencySummary) => {
      setModalState((previous) => ({
        ...previous,
        activeCurrencyToRemove: currency,
        isRemoveCurrencyModalOpen: true
      }))
    },
    []
  )

  const closeRemoveCurrencyModal = useCallback(() => {
    setModalState((previous) => ({
      ...previous,
      activeCurrencyToRemove: undefined,
      isRemoveCurrencyModalOpen: false
    }))
  }, [])

  const openRemoveDiscountModal = useCallback(
    (template: DiscountTemplateSummary) => {
      setModalState((previous) => ({
        ...previous,
        activeDiscountToRemove: template,
        isRemoveDiscountModalOpen: true
      }))
    },
    []
  )

  const closeRemoveDiscountModal = useCallback(() => {
    setModalState((previous) => ({
      ...previous,
      activeDiscountToRemove: undefined,
      isRemoveDiscountModalOpen: false
    }))
  }, [])

  const handleListingCreated = useCallback(
    (listing?: ItemListingSummary) => {
      if (listing) {
        upsertItemListing(listing)
        return
      }

      refreshStorefront()
    },
    [refreshStorefront, upsertItemListing]
  )

  const handleDiscountCreated = useCallback(
    (template?: DiscountTemplateSummary) => {
      if (template) {
        upsertDiscountTemplate(template)
        return
      }

      refreshStorefront()
    },
    [refreshStorefront, upsertDiscountTemplate]
  )

  const handleCurrencyCreated = useCallback(
    (currency?: AcceptedCurrencySummary) => {
      if (currency) {
        upsertAcceptedCurrency(currency)
        return
      }

      refreshStorefront()
    },
    [refreshStorefront, upsertAcceptedCurrency]
  )

  const handleListingRemoved = useCallback(
    (listingId?: string) => {
      if (listingId) {
        removeItemListing(listingId)
        return
      }

      refreshStorefront()
    },
    [refreshStorefront, removeItemListing]
  )

  const handleCurrencyRemoved = useCallback(
    (tableEntryFieldId?: string) => {
      if (tableEntryFieldId) {
        removeAcceptedCurrency(tableEntryFieldId)
        return
      }

      refreshStorefront()
    },
    [refreshStorefront, removeAcceptedCurrency]
  )

  const handleDiscountUpdated = useCallback(
    (template?: DiscountTemplateSummary) => {
      if (template) {
        upsertDiscountTemplate(template)
        if (!template.activeFlag) {
          refreshStorefront()
        }
        return
      }

      refreshStorefront()
    },
    [refreshStorefront, upsertDiscountTemplate]
  )

  return {
    shopId,
    storefront,
    wallet,
    hasShopConfig,
    hasWalletConfig,
    canBuy: Boolean(currentAccount?.address),
    canManageListings: Boolean(hasShopConfig && isShopOwner),
    canManageCurrencies: Boolean(hasShopConfig && isShopOwner),
    canManageDiscounts: Boolean(hasShopConfig && isShopOwner),
    claimDiscountTicket: handleClaimDiscount,
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
  }
}
