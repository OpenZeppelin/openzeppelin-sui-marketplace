"use client"

import { useCurrentAccount } from "@mysten/dapp-kit"
import { useCallback, useEffect, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import ShopSelection from "./ShopSelection"
import StoreDashboard from "./StoreDashboard"
import NetworkSupportChecker from "./NetworkSupportChecker"
import SelectedShopHeader from "./SelectedShopHeader"
import CreateShopModal from "./CreateShopModal"
import useResolvedPackageId from "../hooks/useResolvedPackageId"
import { useShopSelectionViewModel } from "../hooks/useShopSelectionViewModel"

const ShopDashboardShell = () => {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const urlShopId = searchParams.get("shopId") ?? undefined
  const packageId = useResolvedPackageId()
  const currentAccount = useCurrentAccount()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const {
    status,
    error,
    shops,
    filteredShops,
    refresh,
    selectedShopId,
    selectedShop,
    searchQuery,
    setSearchQuery,
    selectShop,
    clearSelection
  } = useShopSelectionViewModel({ packageId })

  const updateShopIdInUrl = useCallback(
    (shopId?: string, mode: "push" | "replace" = "push") => {
      const params = new URLSearchParams(searchParams.toString())
      if (shopId) {
        params.set("shopId", shopId)
      } else {
        params.delete("shopId")
      }
      const query = params.toString()
      const href = query ? `${pathname}?${query}` : pathname
      if (mode === "replace") {
        router.replace(href)
      } else {
        router.push(href)
      }
    },
    [pathname, router, searchParams]
  )

  useEffect(() => {
    if (urlShopId) {
      selectShop(urlShopId)
    } else {
      clearSelection()
    }
  }, [urlShopId, selectShop, clearSelection])

  const openCreateShop = useCallback(() => {
    setIsCreateOpen(true)
  }, [])

  const closeCreateShop = useCallback(() => {
    setIsCreateOpen(false)
  }, [])

  const handleSelectShop = useCallback(
    (shopId: string) => {
      selectShop(shopId)
      updateShopIdInUrl(shopId)
    },
    [selectShop, updateShopIdInUrl]
  )

  const handleClearSelection = useCallback(() => {
    clearSelection()
    updateShopIdInUrl(undefined, "replace")
  }, [clearSelection, updateShopIdInUrl])

  const handleShopCreated = useCallback(
    (shopId: string) => {
      handleSelectShop(shopId)
      refresh({ expectedShopId: shopId })
      setIsCreateOpen(false)
    },
    [handleSelectShop, refresh]
  )

  const walletConnected = Boolean(currentAccount?.address)

  return (
    <>
      <NetworkSupportChecker />
      <div className="flex w-full flex-grow flex-col items-center justify-center rounded-md p-3">
        {selectedShopId ? (
          <div className="flex w-full flex-col items-center gap-6">
            <SelectedShopHeader
              shopId={selectedShopId}
              shop={selectedShop}
              onChangeShop={handleClearSelection}
            />
            <StoreDashboard shopId={selectedShopId} packageId={packageId} />
          </div>
        ) : (
          <ShopSelection
            packageId={packageId}
            shops={filteredShops}
            totalShops={shops.length}
            status={status}
            error={error}
            searchQuery={searchQuery}
            onSearchChange={(value) => setSearchQuery(value)}
            onCreateShop={openCreateShop}
            canCreateShop={Boolean(packageId)}
            walletConnected={walletConnected}
            onSelectShop={handleSelectShop}
            onRefresh={() => refresh()}
          />
        )}
      </div>
      <CreateShopModal
        open={isCreateOpen}
        onClose={closeCreateShop}
        packageId={packageId}
        onShopCreated={handleShopCreated}
      />
    </>
  )
}

export default ShopDashboardShell
