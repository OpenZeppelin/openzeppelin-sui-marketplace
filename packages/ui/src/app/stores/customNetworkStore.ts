"use client"

import {
  CUSTOM_NETWORK_STORAGE_KEY,
  parseStoredCustomNetworks
} from "../helpers/customNetworks"
import type { TCustomNetworkConfig } from "../types/TCustomNetwork"

type CustomNetworkState = {
  networks: TCustomNetworkConfig[]
  error?: string
}

type CustomNetworkListener = () => void

let state: CustomNetworkState = { networks: [] }
let hasHydrated = false
const listeners = new Set<CustomNetworkListener>()

const notifyListeners = () => {
  listeners.forEach((listener) => listener())
}

const readFromStorage = () => {
  if (typeof window === "undefined") return

  const { networks, error } = parseStoredCustomNetworks(
    window.localStorage.getItem(CUSTOM_NETWORK_STORAGE_KEY) ?? undefined
  )
  state = { networks, error }
}

const writeToStorage = (nextNetworks: TCustomNetworkConfig[]) => {
  if (typeof window === "undefined") return

  try {
    window.localStorage.setItem(
      CUSTOM_NETWORK_STORAGE_KEY,
      JSON.stringify(nextNetworks)
    )
    state = { ...state, networks: nextNetworks, error: undefined }
  } catch {
    state = {
      ...state,
      networks: nextNetworks,
      error: "Unable to persist custom network settings."
    }
  }
}

const hydrateFromStorage = () => {
  if (hasHydrated || typeof window === "undefined") return
  hasHydrated = true
  readFromStorage()
  notifyListeners()
}

export const customNetworkStore = {
  getSnapshot: (): CustomNetworkState => {
    return state
  },
  getServerSnapshot: (): CustomNetworkState => state,
  subscribe: (listener: CustomNetworkListener) => {
    listeners.add(listener)
    hydrateFromStorage()
    return () => listeners.delete(listener)
  },
  setNetworks: (nextNetworks: TCustomNetworkConfig[]) => {
    writeToStorage(nextNetworks)
    notifyListeners()
  }
}
