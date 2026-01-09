"use client"

import { useSuiClientContext } from "@mysten/dapp-kit"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo } from "react"
import useClientReady from "../hooks/useClientReady"
import useHostNetworkPolicy from "../hooks/useHostNetworkPolicy"

const NETWORK_QUERY_PARAM = "network"
// Backwards-compatible typo support.
const LEGACY_NETWORK_QUERY_PARAM = "networ"

const normalizeNetworkKey = (value: string | null | undefined) => {
  const normalized = value?.trim().toLowerCase()
  return normalized ? normalized : undefined
}

const NetworkUrlSync = () => {
  const isClientReady = useClientReady()
  const { allowNetworkSwitching } = useHostNetworkPolicy()
  const { network: currentNetwork, selectNetwork } = useSuiClientContext()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const networkFromUrl = useMemo(() => {
    return normalizeNetworkKey(
      searchParams.get(NETWORK_QUERY_PARAM) ??
        searchParams.get(LEGACY_NETWORK_QUERY_PARAM)
    )
  }, [searchParams])

  const normalizedCurrentNetwork = useMemo(() => {
    return normalizeNetworkKey(currentNetwork)
  }, [currentNetwork])

  // 1) URL -> app network (only when switching is allowed).
  useEffect(() => {
    if (!isClientReady) return
    if (!allowNetworkSwitching) return
    if (!networkFromUrl) return
    if (networkFromUrl === normalizedCurrentNetwork) return

    selectNetwork(networkFromUrl)
  }, [
    allowNetworkSwitching,
    isClientReady,
    networkFromUrl,
    normalizedCurrentNetwork,
    selectNetwork
  ])

  // 2) App network -> URL (always keep a canonical `network` param).
  useEffect(() => {
    if (!isClientReady) return
    if (!normalizedCurrentNetwork) return

    const currentUrlNetwork = normalizeNetworkKey(
      searchParams.get(NETWORK_QUERY_PARAM) ??
        searchParams.get(LEGACY_NETWORK_QUERY_PARAM)
    )

    // If the URL explicitly requests a different network and switching is allowed,
    // don't fight it (wait for the app network to catch up).
    if (
      allowNetworkSwitching &&
      currentUrlNetwork &&
      currentUrlNetwork !== normalizedCurrentNetwork
    ) {
      return
    }

    // Nothing to do: correct canonical param is already present.
    if (
      currentUrlNetwork === normalizedCurrentNetwork &&
      searchParams.has(NETWORK_QUERY_PARAM) &&
      !searchParams.has(LEGACY_NETWORK_QUERY_PARAM)
    ) {
      return
    }

    const params = new URLSearchParams(searchParams.toString())
    params.set(NETWORK_QUERY_PARAM, normalizedCurrentNetwork)
    params.delete(LEGACY_NETWORK_QUERY_PARAM)

    const query = params.toString()
    const href = query ? `${pathname}?${query}` : pathname
    router.replace(href)
  }, [
    allowNetworkSwitching,
    isClientReady,
    normalizedCurrentNetwork,
    pathname,
    router,
    searchParams
  ])

  return null
}

export default NetworkUrlSync
