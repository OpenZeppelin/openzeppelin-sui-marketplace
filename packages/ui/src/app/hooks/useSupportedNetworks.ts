"use client"

import { useMemo } from "react"
import { ENetwork } from "@sui-oracle-market/tooling-core/types"
import { supportedNetworks } from "../helpers/network"
import useCustomNetworks from "./useCustomNetworks"
import useHostNetworkPolicy from "./useHostNetworkPolicy"

const baseNetworks: ENetwork[] = [ENetwork.LOCALNET, ENetwork.TESTNET]

const useSupportedNetworks = () => {
  const { allowNetworkSwitching } = useHostNetworkPolicy()
  const configuredNetworks = useMemo(() => supportedNetworks(), [])
  const { networks: customNetworks } = useCustomNetworks()

  return useMemo(() => {
    if (allowNetworkSwitching) {
      return [
        ...baseNetworks,
        ...configuredNetworks.filter(
          (network) => !baseNetworks.includes(network)
        ),
        ...customNetworks.map((network) => network.networkKey)
      ]
    }
    return configuredNetworks.includes(ENetwork.TESTNET)
      ? [ENetwork.TESTNET]
      : []
  }, [allowNetworkSwitching, configuredNetworks, customNetworks])
}

export default useSupportedNetworks
