"use client"

import { useCallback, useSyncExternalStore } from "react"
import { validateCustomNetworkDraft } from "../helpers/customNetworks"
import { customNetworkStore } from "../stores/customNetworkStore"
import type {
  TCustomNetworkConfig,
  TCustomNetworkDraft,
  TCustomNetworkErrors
} from "../types/TCustomNetwork"

type SaveResult =
  | { ok: true; network: TCustomNetworkConfig }
  | { ok: false; errors: TCustomNetworkErrors }

const useCustomNetworks = () => {
  const state = useSyncExternalStore(
    customNetworkStore.subscribe,
    customNetworkStore.getSnapshot,
    customNetworkStore.getSnapshot
  )

  const addNetwork = useCallback(
    (draft: TCustomNetworkDraft): SaveResult => {
      const result = validateCustomNetworkDraft({
        draft,
        existingKeys: state.networks.map((network) => network.networkKey)
      })

      if (!result.ok) {
        return result
      }

      customNetworkStore.setNetworks([...state.networks, result.network])
      return { ok: true, network: result.network }
    },
    [state.networks]
  )

  const updateNetwork = useCallback(
    (networkKey: string, draft: TCustomNetworkDraft): SaveResult => {
      const exists = state.networks.some(
        (network) => network.networkKey === networkKey
      )

      if (!exists) {
        return {
          ok: false,
          errors: { networkKey: "Network could not be found." }
        }
      }

      const result = validateCustomNetworkDraft({
        draft,
        existingKeys: state.networks.map((network) => network.networkKey),
        allowNetworkKey: networkKey
      })

      if (!result.ok) {
        return result
      }

      const nextNetworks = state.networks.map((network) =>
        network.networkKey === networkKey ? result.network : network
      )

      customNetworkStore.setNetworks(nextNetworks)
      return { ok: true, network: result.network }
    },
    [state.networks]
  )

  const removeNetwork = useCallback(
    (networkKey: string) => {
      const nextNetworks = state.networks.filter(
        (network) => network.networkKey !== networkKey
      )
      customNetworkStore.setNetworks(nextNetworks)
    },
    [state.networks]
  )

  return {
    networks: state.networks,
    storageError: state.error,
    addNetwork,
    updateNetwork,
    removeNetwork
  }
}

export default useCustomNetworks
