"use client"

import { useSuiClient } from "@mysten/dapp-kit"
import type { ShopCreatedSummary } from "@sui-oracle-market/domain-core/models/shop"
import { getShopCreatedSummaries } from "@sui-oracle-market/domain-core/models/shop"
import { normalizeOptionalId } from "@sui-oracle-market/tooling-core/object"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

export type ShopSelectionStatus = "idle" | "loading" | "success" | "error"

type ShopSelectionState = {
  status: ShopSelectionStatus
  shops: ShopCreatedSummary[]
  error?: string
}

const emptySelectionState = (): ShopSelectionState => ({
  status: "idle",
  shops: []
})

const shopSelectionRetryDelaysMs = [200, 400, 800]

const waitMs = (delayMs: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs)
  })

const normalizeSearchValue = (value?: string) => value?.toLowerCase() ?? ""

const stripHexPrefix = (value: string) =>
  value.startsWith("0x") ? value.slice(2) : value

const matchesSearch = ({
  shop,
  query,
  queryNoPrefix
}: {
  shop: ShopCreatedSummary
  query: string
  queryNoPrefix: string
}) => {
  const shopId = normalizeSearchValue(shop.shopId)
  const shopIdNoPrefix = stripHexPrefix(shopId)
  const ownerAddress = normalizeSearchValue(shop.ownerAddress)
  const ownerNoPrefix = ownerAddress ? stripHexPrefix(ownerAddress) : ""
  const name = normalizeSearchValue(shop.name)

  return [shopId, shopIdNoPrefix, ownerAddress, ownerNoPrefix, name].some(
    (candidate) =>
      candidate &&
      (candidate.includes(query) ||
        (queryNoPrefix && candidate.includes(queryNoPrefix)))
  )
}

export const useShopSelectionViewModel = ({
  packageId
}: {
  packageId?: string
}) => {
  const suiClient = useSuiClient()
  const [state, setState] = useState<ShopSelectionState>(emptySelectionState())
  const [refreshIndex, setRefreshIndex] = useState(0)
  const [selectedShopId, setSelectedShopId] = useState<string | undefined>()
  const awaitedShopIdRef = useRef<string | undefined>(undefined)
  const [searchQuery, setSearchQuery] = useState("")

  const refresh = useCallback((options?: { expectedShopId?: string }) => {
    if (options?.expectedShopId) {
      awaitedShopIdRef.current = normalizeOptionalId(options.expectedShopId)
    }
    setRefreshIndex((current) => current + 1)
  }, [])

  const selectShop = useCallback((shopId: string) => {
    setSelectedShopId(shopId)
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedShopId(undefined)
  }, [])

  useEffect(() => {
    setSelectedShopId(undefined)
    setSearchQuery("")
    awaitedShopIdRef.current = undefined
  }, [packageId])

  useEffect(() => {
    let active = true

    if (!packageId) {
      setState({
        status: "error",
        shops: [],
        error: "Contract package ID is not configured for this network."
      })
      return () => {
        active = false
      }
    }

    setState((previous) => ({
      ...previous,
      status: "loading",
      error: undefined
    }))

    const load = async () => {
      try {
        const expectedShopId = awaitedShopIdRef.current
        let shops: ShopCreatedSummary[] = []

        for (
          let attempt = 0;
          attempt <= shopSelectionRetryDelaysMs.length;
          attempt += 1
        ) {
          shops = await getShopCreatedSummaries({
            shopPackageId: packageId,
            suiClient
          })
          if (!active) return

          const shouldRetry =
            Boolean(expectedShopId) &&
            !shops.some((shop) => shop.shopId === expectedShopId) &&
            attempt < shopSelectionRetryDelaysMs.length

          if (!shouldRetry) break

          await waitMs(shopSelectionRetryDelaysMs[attempt])
          if (!active) return
        }

        if (!active) return
        setState({ status: "success", shops })

        if (
          expectedShopId &&
          shops.some((shop) => shop.shopId === expectedShopId)
        ) {
          awaitedShopIdRef.current = undefined
        }
      } catch (error) {
        if (!active) return
        const message =
          error instanceof Error ? error.message : "Unable to load shops."
        setState({ status: "error", shops: [], error: message })
      }
    }

    load()

    return () => {
      active = false
    }
  }, [packageId, refreshIndex, suiClient])

  const selectedShop = useMemo(
    () =>
      selectedShopId
        ? state.shops.find((shop) => shop.shopId === selectedShopId)
        : undefined,
    [selectedShopId, state.shops]
  )

  const filteredShops = useMemo(() => {
    const normalizedQuery = normalizeSearchValue(searchQuery.trim())
    if (!normalizedQuery) return state.shops

    const queryNoPrefix = stripHexPrefix(normalizedQuery)
    return state.shops.filter((shop) =>
      matchesSearch({ shop, query: normalizedQuery, queryNoPrefix })
    )
  }, [searchQuery, state.shops])

  return {
    status: state.status,
    error: state.error,
    shops: state.shops,
    filteredShops,
    refresh,
    selectedShopId,
    selectedShop,
    searchQuery,
    setSearchQuery,
    selectShop,
    clearSelection
  }
}
