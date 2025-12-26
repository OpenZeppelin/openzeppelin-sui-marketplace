"use client"

import { useCurrentWallet, useSuiClientContext } from "@mysten/dapp-kit"
import { useMemo } from "react"
import { resolveWalletNetworkType } from "../helpers/network"

const WalletNetworkLabel = () => {
  const wallet = useCurrentWallet()
  const { network } = useSuiClientContext()
  const walletNetworkType = useMemo(
    () =>
      wallet.isConnected
        ? resolveWalletNetworkType(wallet.currentWallet?.accounts?.[0]?.chains)
        : undefined,
    [wallet]
  )
  const label = network || walletNetworkType || "disconnected"

  return (
    <span className="sds-match-wallet-width sds-match-wallet-height inline-flex items-center justify-center rounded-lg border border-slate-300/70 bg-white/90 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600 shadow-[0_10px_24px_-20px_rgba(15,23,42,0.3)] dark:border-slate-50/25 dark:bg-slate-950/60 dark:text-slate-200/80">
      {label}
    </span>
  )
}

export default WalletNetworkLabel
