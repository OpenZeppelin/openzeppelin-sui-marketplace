"use client"

import { useSuiClientContext } from "@mysten/dapp-kit"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useRef } from "react"
import useClientReady from "../hooks/useClientReady"
import useHostNetworkPolicy from "../hooks/useHostNetworkPolicy"

const NETWORK_QUERY_PARAM = "network"

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
  const pendingUrlNetworkRef = useRef<string | undefined>(undefined)
  const pendingAppNetworkRef = useRef<string | undefined>(undefined)

  const networkFromUrl = useMemo(() => {
    return normalizeNetworkKey(searchParams.get(NETWORK_QUERY_PARAM))
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

    // If the app already switched (e.g. via UI) and we're waiting for the URL
    // to catch up, don't revert the app based on a stale URL value.
    if (
      pendingAppNetworkRef.current &&
      pendingAppNetworkRef.current !== networkFromUrl
    ) {
      return
    }

    pendingUrlNetworkRef.current = networkFromUrl
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
      searchParams.get(NETWORK_QUERY_PARAM)
    )

    const pendingUrlNetwork = pendingUrlNetworkRef.current

    const pendingAppNetwork = pendingAppNetworkRef.current
    if (pendingAppNetwork && currentUrlNetwork === pendingAppNetwork) {
      pendingAppNetworkRef.current = undefined
    }

    if (pendingUrlNetwork && normalizedCurrentNetwork === pendingUrlNetwork) {
      pendingUrlNetworkRef.current = undefined
    }

    // If a network switch is in progress because the URL requested it,
    // don't fight it (wait for the app network to catch up).
    if (
      allowNetworkSwitching &&
      pendingUrlNetwork &&
      currentUrlNetwork === pendingUrlNetwork &&
      normalizedCurrentNetwork !== pendingUrlNetwork
    ) {
      return
    }

    // Nothing to do: correct canonical param is already present.
    if (
      currentUrlNetwork === normalizedCurrentNetwork &&
      searchParams.has(NETWORK_QUERY_PARAM)
    ) {
      return
    }

    const params = new URLSearchParams(searchParams.toString())
    params.set(NETWORK_QUERY_PARAM, normalizedCurrentNetwork)

    const query = params.toString()
    const href = query ? `${pathname}?${query}` : pathname

    // Mark that the URL update is pending so URL->app sync doesn't "bounce".
    pendingAppNetworkRef.current = normalizedCurrentNetwork
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
