"use client"

import { useEffect, useState } from "react"
import { ENetwork } from "@sui-oracle-market/tooling-core/types"
import { isLocalhostHost } from "../helpers/host"

const useHostNetworkPolicy = () => {
  const [hostname, setHostname] = useState<string | undefined>(undefined)

  useEffect(() => {
    setHostname(window.location.hostname)
  }, [])

  const isLocalhost = isLocalhostHost(hostname)

  return {
    isLocalhost,
    allowNetworkSwitching: isLocalhost,
    defaultNetwork: isLocalhost ? ENetwork.LOCALNET : ENetwork.TESTNET
  }
}

export default useHostNetworkPolicy
