"use client"

import { useCurrentAccount } from "@mysten/dapp-kit"
import WalletRequiredNotice from "../WalletRequiredNotice"

const WalletRequiredBanner = () => {
  const walletConnected = Boolean(useCurrentAccount()?.address)

  if (walletConnected) return null

  return (
    <div className="flex justify-center px-4">
      <div className="w-full max-w-6xl">
        <WalletRequiredNotice message="Connect a wallet to interact with the app" />
      </div>
    </div>
  )
}

export default WalletRequiredBanner
