"use client"

import { useWalletAccountChangeDisconnect } from "../hooks/useWalletAccountChangeDisconnect"

const WalletAccountGuard = () => {
  useWalletAccountChangeDisconnect()
  return null
}

export default WalletAccountGuard
