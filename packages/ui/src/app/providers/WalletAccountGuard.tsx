"use client"

import { useWalletAccountChangeDisconnect } from "../hooks/useWalletAccountChangeDisconnect"

const WalletAccountGuard = () => {
  useWalletAccountChangeDisconnect()
  return <></>
}

export default WalletAccountGuard
