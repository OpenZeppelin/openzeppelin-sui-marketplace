"use client"

import {
  useCurrentWallet,
  useDisconnectWallet
} from "@mysten/dapp-kit"
import { normalizeSuiAddress } from "@mysten/sui/utils"
import type { WalletAccount } from "@mysten/wallet-standard"
import { useEffect, useMemo, useRef } from "react"

const normalizeAddress = (address?: string) =>
  address ? normalizeSuiAddress(address) : undefined

const DEBUG_WALLET =
  process.env.NEXT_PUBLIC_WALLET_DEBUG === "true"
const WALLET_STORAGE_KEY = "sui-dapp-kit:wallet-connection-info"

const debugLog = (...args: unknown[]) => {
  if (DEBUG_WALLET) {
    console.log("[wallet-debug]", ...args)
  }
}

const readWalletStorage = () => {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(WALLET_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

const resolveWalletIdentifier = (wallet?: { id?: string; name?: string }) =>
  wallet?.id ?? wallet?.name

const getPrimaryAddress = (accounts?: readonly WalletAccount[]) =>
  normalizeAddress(accounts?.[0]?.address)

const shouldDisconnectForAccounts = (
  normalizedAddress: string | undefined,
  accounts: readonly WalletAccount[]
) => {
  if (!normalizedAddress || accounts.length === 0) return false

  const normalizedPrimaryAddress = normalizeAddress(accounts[0]?.address)
  if (
    normalizedPrimaryAddress &&
    normalizedPrimaryAddress !== normalizedAddress
  ) {
    return true
  }

  return !accounts.some(
    (account) => normalizeAddress(account.address) === normalizedAddress
  )
}

export const useWalletAccountChangeDisconnect = () => {
  const wallet = useCurrentWallet()
  const { mutate: disconnectWallet } = useDisconnectWallet()
  const lastKnownAddressRef = useRef<string | null>(null)
  const lastWalletIdentifierRef = useRef<string | null>(null)

  const walletIdentifier = useMemo(
    () => resolveWalletIdentifier(wallet.currentWallet ?? undefined),
    [wallet.currentWallet]
  )

  useEffect(() => {
    debugLog("hook mounted")
  }, [])

  useEffect(() => {
    if (!DEBUG_WALLET) return
    debugLog("state snapshot", {
      connectionStatus: wallet.connectionStatus,
      walletIdentifier,
      accounts: wallet.currentWallet?.accounts?.map((account) => account.address),
      storage: readWalletStorage()
    })
  }, [
    wallet.connectionStatus,
    walletIdentifier,
    wallet.currentWallet?.accounts
  ])

  useEffect(() => {
    if (!wallet.isConnected) {
      debugLog("disconnected; clearing cached address")
      lastKnownAddressRef.current = null
      lastWalletIdentifierRef.current = null
      return
    }

    if (walletIdentifier !== lastWalletIdentifierRef.current) {
      debugLog("wallet identifier changed", {
        from: lastWalletIdentifierRef.current,
        to: walletIdentifier
      })
      lastKnownAddressRef.current = null
      lastWalletIdentifierRef.current = walletIdentifier ?? null
    }

    if (!lastKnownAddressRef.current) {
      const primaryAddress = getPrimaryAddress(wallet.currentWallet?.accounts)
      if (primaryAddress) {
        debugLog("cached baseline address", primaryAddress)
        lastKnownAddressRef.current = primaryAddress
      }
    }
  }, [wallet.isConnected, walletIdentifier, wallet.currentWallet?.accounts])

  useEffect(() => {
    if (!wallet.isConnected) return
    const eventsFeature = wallet.currentWallet?.features?.["standard:events"]
    if (!eventsFeature?.on) {
      debugLog("standard:events unavailable")
      return
    }

    const unsubscribe = eventsFeature.on("change", ({ accounts }) => {
      if (!accounts || accounts.length === 0) return
      debugLog("wallet change event", {
        accounts: accounts.map((account) => account.address),
        baseline: lastKnownAddressRef.current
      })
      if (!lastKnownAddressRef.current) {
        lastKnownAddressRef.current = getPrimaryAddress(accounts) ?? null
        debugLog("set baseline from change event", lastKnownAddressRef.current)
        return
      }
      if (shouldDisconnectForAccounts(lastKnownAddressRef.current, accounts)) {
        debugLog("disconnecting; address change detected")
        disconnectWallet()
      } else {
        debugLog("no disconnect; address unchanged")
      }
    })

    if (typeof unsubscribe === "function") {
      return () => unsubscribe()
    }

    return () => unsubscribe?.remove?.()
  }, [
    disconnectWallet,
    wallet.currentWallet,
    wallet.isConnected
  ])
}
