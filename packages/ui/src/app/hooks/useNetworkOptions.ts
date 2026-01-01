"use client"

import { useMemo } from "react"
import { ENetwork } from "@sui-oracle-market/tooling-core/types"
import { supportedNetworks } from "../helpers/network"
import type { TNetworkOption } from "../types/TNetworkOption"
import useCustomNetworks from "./useCustomNetworks"
import useHostNetworkPolicy from "./useHostNetworkPolicy"

const baseNetworks: ENetwork[] = [ENetwork.LOCALNET, ENetwork.TESTNET]

const formatNetworkLabel = (network: string) => {
  if (!network) return "Unknown"
  return `${network.charAt(0).toUpperCase()}${network.slice(1)}`
}

const useNetworkOptions = (currentNetwork?: string) => {
  const { allowNetworkSwitching } = useHostNetworkPolicy()
  const { networks: customNetworks } = useCustomNetworks()
  const configuredNetworks = useMemo(() => supportedNetworks(), [])

  return useMemo(() => {
    if (!allowNetworkSwitching) return []

    const builtInOptions: TNetworkOption[] = [
      ...baseNetworks,
      ...configuredNetworks.filter((network) => !baseNetworks.includes(network))
    ].map((network) => ({
      value: network,
      label: configuredNetworks.includes(network)
        ? formatNetworkLabel(network)
        : `${formatNetworkLabel(network)} (unconfigured)`
    }))
    const customOptions: TNetworkOption[] = customNetworks.map((network) => ({
      value: network.networkKey,
      label: network.label
    }))
    const combinedOptions = [...builtInOptions, ...customOptions]

    if (!currentNetwork) return combinedOptions
    if (combinedOptions.some((option) => option.value === currentNetwork)) {
      return combinedOptions
    }

    return [
      {
        value: currentNetwork,
        label: `${formatNetworkLabel(currentNetwork)} (unconfigured)`,
        disabled: true
      },
      ...combinedOptions
    ]
  }, [
    allowNetworkSwitching,
    configuredNetworks,
    customNetworks,
    currentNetwork
  ])
}

export default useNetworkOptions
