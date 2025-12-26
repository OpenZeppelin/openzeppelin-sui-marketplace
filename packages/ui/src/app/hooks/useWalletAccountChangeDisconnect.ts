"use client"

import { useCurrentWallet, useDisconnectWallet } from "@mysten/dapp-kit"
import { normalizeSuiAddress } from "@mysten/sui/utils"
import type { WalletAccount } from "@mysten/wallet-standard"
import { useEffect, useMemo, useRef } from "react"

const normalizeAddress = (address?: string) =>
  address ? normalizeSuiAddress(address) : undefined

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

type WalletEventUnsubscribe = (() => void) | { remove?: () => void } | undefined

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
    if (!wallet.isConnected) {
      lastKnownAddressRef.current = null
      lastWalletIdentifierRef.current = null
      return
    }

    if (walletIdentifier !== lastWalletIdentifierRef.current) {
      lastKnownAddressRef.current = null
      lastWalletIdentifierRef.current = walletIdentifier ?? null
    }

    if (!lastKnownAddressRef.current) {
      const primaryAddress = getPrimaryAddress(wallet.currentWallet?.accounts)
      if (primaryAddress) {
        lastKnownAddressRef.current = primaryAddress
      }
    }
  }, [wallet.isConnected, walletIdentifier, wallet.currentWallet?.accounts])

  useEffect(() => {
    if (!wallet.isConnected) return
    const eventsFeature = wallet.currentWallet?.features?.["standard:events"]
    if (!eventsFeature?.on) return

    const unsubscribe = eventsFeature.on("change", ({ accounts }) => {
      if (!accounts || accounts.length === 0) return
      if (!lastKnownAddressRef.current) {
        lastKnownAddressRef.current = getPrimaryAddress(accounts) ?? null
        return
      }
      if (shouldDisconnectForAccounts(lastKnownAddressRef.current, accounts)) {
        disconnectWallet()
      }
    }) as WalletEventUnsubscribe

    if (typeof unsubscribe === "function") {
      return () => unsubscribe()
    }

    return () => unsubscribe?.remove?.()
  }, [disconnectWallet, wallet.currentWallet, wallet.isConnected])
}
