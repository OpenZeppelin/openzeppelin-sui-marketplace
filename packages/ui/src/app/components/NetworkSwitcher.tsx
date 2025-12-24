"use client"

import { useSuiClientContext } from "@mysten/dapp-kit"
import type { ENetwork } from "@sui-oracle-market/tooling-core/types"
import type { ChangeEvent } from "react"
import { useCallback, useMemo } from "react"
import { supportedNetworks } from "../helpers/network"

type NetworkOption = {
  value: string
  label: string
  disabled?: boolean
}

const formatNetworkLabel = (network: string) => {
  if (!network) return "Unknown"
  return `${network.charAt(0).toUpperCase()}${network.slice(1)}`
}

const buildNetworkOptions = (
  supported: ENetwork[],
  currentNetwork?: string
): NetworkOption[] => {
  const supportedOptions = supported.map((network) => ({
    value: network,
    label: formatNetworkLabel(network)
  }))

  if (!currentNetwork) return supportedOptions
  if (supported.includes(currentNetwork as ENetwork)) return supportedOptions

  return [
    {
      value: currentNetwork,
      label: `${formatNetworkLabel(currentNetwork)} (unconfigured)`,
      disabled: true
    },
    ...supportedOptions
  ]
}

const NetworkSwitcher = () => {
  const { network: currentNetwork, selectNetwork } = useSuiClientContext()
  const configuredNetworks = useMemo(() => supportedNetworks(), [])
  const options = useMemo(
    () => buildNetworkOptions(configuredNetworks, currentNetwork),
    [configuredNetworks, currentNetwork]
  )

  const handleNetworkChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const nextNetwork = event.target.value
      if (!nextNetwork || nextNetwork === currentNetwork) return
      selectNetwork(nextNetwork)
    },
    [currentNetwork, selectNetwork]
  )

  if (options.length === 0) return null

  return (
    <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-200/70">
      <select
        value={currentNetwork}
        onChange={handleNetworkChange}
        className="sds-match-wallet-width focus:ring-sds-blue/40 rounded-lg border border-slate-300/70 bg-white/90 px-3 py-2 text-sm font-semibold text-sds-dark shadow-[0_10px_24px_-20px_rgba(15,23,42,0.3)] transition focus:outline-none focus:ring-2 dark:border-slate-50/25 dark:bg-slate-950/60 dark:text-sds-light"
      >
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export default NetworkSwitcher
