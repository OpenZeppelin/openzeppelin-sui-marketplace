"use client"

import { useCurrentAccount, useCurrentWallet } from "@mysten/dapp-kit"
import type { ENetwork } from "@sui-oracle-market/tooling-core/types"
import { useMemo } from "react"
import { resolveWalletNetworkType, supportedNetworks } from "../helpers/network"

const NetworkSupportChecker = () => {
  const currentAccount = useCurrentAccount()
  const wallet = useCurrentWallet()

  const configuredNetworks = useMemo(() => supportedNetworks(), [])
  const walletNetworkType = useMemo(
    () =>
      wallet.isConnected
        ? resolveWalletNetworkType(wallet.currentWallet?.accounts?.[0]?.chains)
        : undefined,
    [wallet]
  )
  const walletNetworkSupported = useMemo(
    () =>
      Boolean(
        walletNetworkType &&
        configuredNetworks.includes(walletNetworkType as ENetwork)
      ),
    [configuredNetworks, walletNetworkType]
  )

  if (currentAccount == null || configuredNetworks.length === 0) {
    return <></>
  }

  if (!walletNetworkType || walletNetworkSupported) {
    return <></>
  }

  return (
    <div className="mx-auto w-full max-w-lg px-3 py-2">
      <div className="w-full rounded border border-red-400 px-3 py-2 text-center text-red-400">
        The <span className="font-bold">{walletNetworkType}</span> is not
        currently supported by the app.
        <br />
        Please switch to a supported network [
        <span className="font-bold">{configuredNetworks.join(", ")}</span>] in
        your wallet settings.
      </div>
    </div>
  )
}

export default NetworkSupportChecker
