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
import {
  CONTRACT_PACKAGE_ID_NOT_DEFINED,
  CONTRACT_PACKAGE_VARIABLE_NAME,
  SHOP_ID_NOT_DEFINED,
  SHOP_ID_VARIABLE_NAME
} from "../config/network"
import { buildDiscountTemplateLookup } from "../helpers/discountTemplates"
import { resolveConfiguredId } from "../helpers/network"
import { useClaimDiscountTicketAction } from "./useClaimDiscountTicketAction"
import useNetworkConfig from "./useNetworkConfig"
import { useShopDashboardData } from "./useShopDashboardData"

type DashboardModalState = {
  activeListing: ItemListingSummary | null
  activeListingToRemove: ItemListingSummary | null
  activeCurrencyToRemove: AcceptedCurrencySummary | null
  activeDiscountToRemove: DiscountTemplateSummary | null
  isBuyModalOpen: boolean
  isAddItemModalOpen: boolean
  isAddDiscountModalOpen: boolean
  isAddCurrencyModalOpen: boolean
  isRemoveItemModalOpen: boolean
  isRemoveCurrencyModalOpen: boolean
  isRemoveDiscountModalOpen: boolean
}

const emptyModalState = (): DashboardModalState => ({
  activeListing: null,
  activeListingToRemove: null,
  activeCurrencyToRemove: null,
  activeDiscountToRemove: null,
  isBuyModalOpen: false,
  isAddItemModalOpen: false,
  isAddDiscountModalOpen: false,
  isAddCurrencyModalOpen: false,
  isRemoveItemModalOpen: false,
  isRemoveCurrencyModalOpen: false,
  isRemoveDiscountModalOpen: false
})

export const useStoreDashboardViewModel = () => {
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

  const [modalState, setModalState] =
    useState<DashboardModalState>(emptyModalState())

  const {
    storefront,
    wallet,
    refreshStorefront,
    refreshWallet,
    upsertAcceptedCurrency,
    upsertItemListing,
    upsertDiscountTemplate,
    upsertDiscountTicket,
    removeItemListing,
    removeAcceptedCurrency
  } = useShopDashboardData({
    shopId,
    packageId,
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

  const {
    claimingTemplateId,
    isClaiming,
    handleClaimDiscount
  } = useClaimDiscountTicketAction({
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
      activeListing: null,
      isBuyModalOpen: false
    }))
  }, [])

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
      activeListingToRemove: null,
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
      activeCurrencyToRemove: null,
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
      activeDiscountToRemove: null,
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
    (currencyId?: string) => {
      if (currencyId) {
        removeAcceptedCurrency(currencyId)
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
