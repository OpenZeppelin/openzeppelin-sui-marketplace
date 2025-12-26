"use client"

import {
  useCurrentAccount,
  useCurrentWallet,
  useDisconnectWallet
} from "@mysten/dapp-kit"
import { normalizeSuiAddress } from "@mysten/sui/utils"
import type { WalletAccount } from "@mysten/wallet-standard"
import { useEffect, useMemo, useRef } from "react"

const ACCOUNT_POLL_INTERVAL_MS = 1000

const normalizeAddress = (address?: string) =>
  address ? normalizeSuiAddress(address) : undefined

const isSuiChain = (chain: string) => chain.split(":")[0] === "sui"

const filterSuiAccounts = (accounts: readonly WalletAccount[]) =>
  accounts.filter((account) => account.chains.some(isSuiChain))

const resolveWalletIdentifier = (wallet?: { id?: string; name?: string }) =>
  wallet?.id ?? wallet?.name

type WalletConnectResult = {
  accounts?: readonly WalletAccount[]
}

type WalletWithConnectFeature = {
  features?: {
    ["standard:connect"]?: {
      connect?: (input: { silent?: boolean }) => Promise<WalletConnectResult>
    }
  }
}

const fetchSuiAccountsFromWallet = async (wallet?: WalletWithConnectFeature) => {
  const connectFeature = wallet?.features?.["standard:connect"]
  if (!connectFeature?.connect) return null

  const result = await connectFeature.connect({ silent: true })
  return filterSuiAccounts(result?.accounts ?? [])
}

const shouldDisconnectForAccounts = (
  normalizedAddress: string | undefined,
  accounts: readonly WalletAccount[]
) => {
  if (!normalizedAddress || accounts.length === 0) return false

  const normalizedPrimaryAddress = normalizeAddress(accounts[0]?.address)
  if (normalizedPrimaryAddress && normalizedPrimaryAddress !== normalizedAddress) {
    return true
  }

  return !accounts.some(
    (account) => normalizeAddress(account.address) === normalizedAddress
  )
}

export const useWalletAccountChangeDisconnect = () => {
  const currentAccount = useCurrentAccount()
  const wallet = useCurrentWallet()
  const { mutate: disconnectWallet } = useDisconnectWallet()
  const lastVerifiedKeyRef = useRef<string | null>(null)

  const normalizedCurrentAddress = useMemo(
    () => normalizeAddress(currentAccount?.address),
    [currentAccount?.address]
  )
  const walletIdentifier = useMemo(
    () => resolveWalletIdentifier(wallet.currentWallet ?? undefined),
    [wallet.currentWallet]
  )

  useEffect(() => {
    if (!wallet.isConnected || !normalizedCurrentAddress) return
    if (
      shouldDisconnectForAccounts(
        normalizedCurrentAddress,
        wallet.currentWallet?.accounts ?? []
      )
    ) {
      disconnectWallet()
    }
  }, [
    disconnectWallet,
    normalizedCurrentAddress,
    wallet.isConnected,
    wallet.currentWallet?.accounts
  ])

  useEffect(() => {
    if (!wallet.isConnected || !normalizedCurrentAddress) return
    const eventsFeature = wallet.currentWallet?.features?.["standard:events"]
    if (!eventsFeature?.on) return

    const unsubscribe = eventsFeature.on("change", ({ accounts }) => {
      if (!accounts || accounts.length === 0) return
      if (shouldDisconnectForAccounts(normalizedCurrentAddress, accounts)) {
        disconnectWallet()
      }
    })

    if (typeof unsubscribe === "function") {
      return () => unsubscribe()
    }

    return () => unsubscribe?.remove?.()
  }, [
    disconnectWallet,
    normalizedCurrentAddress,
    wallet.currentWallet,
    wallet.isConnected
  ])

  useEffect(() => {
    if (!wallet.isConnected || !wallet.currentWallet || !normalizedCurrentAddress)
      return
    const verificationKey = `${walletIdentifier ?? "wallet"}:${normalizedCurrentAddress}`
    if (lastVerifiedKeyRef.current === verificationKey) return
    lastVerifiedKeyRef.current = verificationKey

    const connectFeature = wallet.currentWallet.features?.["standard:connect"]
    if (!connectFeature?.connect) return

    let isActive = true
    const verifyAccounts = async () => {
      try {
        const result = await connectFeature.connect({ silent: true })
        if (!isActive) return
        const suiAccounts = filterSuiAccounts(result.accounts ?? [])
        if (shouldDisconnectForAccounts(normalizedCurrentAddress, suiAccounts)) {
          disconnectWallet()
        }
      } catch {
        // Ignore silent connect errors to avoid prompting users on load.
      }
    }

    verifyAccounts()

    return () => {
      isActive = false
    }
  }, [
    disconnectWallet,
    normalizedCurrentAddress,
    wallet.currentWallet,
    wallet.isConnected,
    walletIdentifier
  ])

  useEffect(() => {
    if (!wallet.isConnected || !wallet.currentWallet) return
    let isPolling = false
    const pollOnce = async () => {
      if (isPolling) return
      isPolling = true
      try {
        const accounts =
          (await fetchSuiAccountsFromWallet(wallet.currentWallet)) ??
          wallet.currentWallet?.accounts ??
          []
        if (shouldDisconnectForAccounts(normalizedCurrentAddress, accounts)) {
          disconnectWallet()
        }
      } catch {
        // Ignore polling failures to avoid disconnecting on transient wallet errors.
      } finally {
        isPolling = false
      }
    }

    const pollIntervalId = window.setInterval(() => {
      void pollOnce()
    }, ACCOUNT_POLL_INTERVAL_MS)

    return () => window.clearInterval(pollIntervalId)
  }, [
    disconnectWallet,
    normalizedCurrentAddress,
    wallet.currentWallet,
    wallet.isConnected
  ])
}
