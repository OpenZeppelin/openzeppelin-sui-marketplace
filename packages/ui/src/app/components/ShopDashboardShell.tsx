"use client"

import { useCurrentAccount, useSuiClientContext } from "@mysten/dapp-kit"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import useResolvedPackageId from "../hooks/useResolvedPackageId"
import { useShopSelectionViewModel } from "../hooks/useShopSelectionViewModel"
import CreateShopModal from "./CreateShopModal"
import NetworkSupportChecker from "./NetworkSupportChecker"
import SelectedShopHeader from "./SelectedShopHeader"
import ShopSelection from "./ShopSelection"
import StoreDashboard from "./StoreDashboard"

const normalizeNetworkKey = (value: string | null | undefined) => {
  const normalized = value?.trim().toLowerCase()
  return normalized ? normalized : undefined
}

const ShopDashboardShell = () => {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const urlShopId = searchParams.get("shopId") ?? undefined
  const urlNetwork = normalizeNetworkKey(
    searchParams.get("network") ?? searchParams.get("network")
  )
  const packageId = useResolvedPackageId()
  const currentAccount = useCurrentAccount()
  const { network: currentNetwork } = useSuiClientContext()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const previousNetworkRef = useRef<string | undefined>(undefined)
  const initialDeepLinkRef = useRef<{ network?: string; shopId?: string }>({
    network: urlNetwork,
    shopId: urlShopId
  })
  const initialDeepLinkHandledRef = useRef(false)
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
      // `packageId` changes (network switch) reset selection in the view model,
      // so we must re-apply the URL selection after network sync.
      selectShop(urlShopId)
    } else {
      clearSelection()
    }
  }, [urlShopId, packageId, selectShop, clearSelection])

  useEffect(() => {
    const normalizedCurrentNetwork = normalizeNetworkKey(currentNetwork)
    const previousNetwork = previousNetworkRef.current
    previousNetworkRef.current = normalizedCurrentNetwork

    // Skip until we can compare an actual change.
    if (!previousNetwork || !normalizedCurrentNetwork) return
    if (previousNetwork === normalizedCurrentNetwork) return
    if (!selectedShopId) return

    // Allow one "initial deep link" case:
    // visiting with both `?network=...` and `?shopId=...` should switch network
    // without losing the intended shop selection.
    const initial = initialDeepLinkRef.current
    if (
      !initialDeepLinkHandledRef.current &&
      initial.shopId &&
      initial.network &&
      normalizeNetworkKey(initial.network) === normalizedCurrentNetwork &&
      urlShopId === initial.shopId
    ) {
      initialDeepLinkHandledRef.current = true
      return
    }

    // Network changed while in shop view: go back to shop selection.
    clearSelection()
    {
      const params = new URLSearchParams(searchParams.toString())
      params.delete("shopId")
      params.delete("network")
      if (normalizedCurrentNetwork) {
        params.set("network", normalizedCurrentNetwork)
      }
      const query = params.toString()
      const href = query ? `${pathname}?${query}` : pathname
      router.replace(href)
    }
  }, [
    clearSelection,
    currentNetwork,
    selectedShopId,
    pathname,
    router,
    searchParams,
    urlShopId
  ])

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
