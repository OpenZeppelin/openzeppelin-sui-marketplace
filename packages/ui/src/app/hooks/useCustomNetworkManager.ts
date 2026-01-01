"use client"

import { useCallback, useReducer } from "react"
import { createEmptyCustomNetworkDraft } from "../helpers/customNetworks"
import type {
  TCustomNetworkConfig,
  TCustomNetworkDraft,
  TCustomNetworkErrors
} from "../types/TCustomNetwork"
import useCustomNetworks from "./useCustomNetworks"

type ManagerMode = "create" | "edit"

type ManagerState = {
  isOpen: boolean
  mode: ManagerMode
  draft: TCustomNetworkDraft
  errors: TCustomNetworkErrors
  editingKey?: string
}

type ManagerAction =
  | { type: "open_create" }
  | { type: "open_edit"; network: TCustomNetworkConfig }
  | { type: "close" }
  | { type: "update_field"; field: keyof TCustomNetworkDraft; value: string }
  | { type: "set_errors"; errors: TCustomNetworkErrors }
  | { type: "clear_errors" }

const initialState: ManagerState = {
  isOpen: false,
  mode: "create",
  draft: createEmptyCustomNetworkDraft(),
  errors: {}
}

const reducer = (state: ManagerState, action: ManagerAction): ManagerState => {
  switch (action.type) {
    case "open_create":
      return {
        isOpen: true,
        mode: "create",
        draft: createEmptyCustomNetworkDraft(),
        errors: {}
      }
    case "open_edit":
      return {
        isOpen: true,
        mode: "edit",
        draft: { ...action.network },
        errors: {},
        editingKey: action.network.networkKey
      }
    case "close":
      return { ...state, isOpen: false, errors: {} }
    case "update_field":
      return {
        ...state,
        draft: { ...state.draft, [action.field]: action.value },
        errors: { ...state.errors, [action.field]: undefined }
      }
    case "set_errors":
      return { ...state, errors: action.errors }
    case "clear_errors":
      return { ...state, errors: {} }
    default:
      return state
  }
}

const useCustomNetworkManager = () => {
  const { networks, storageError, addNetwork, updateNetwork, removeNetwork } =
    useCustomNetworks()
  const [state, dispatch] = useReducer(reducer, initialState)

  const openCreate = useCallback(() => {
    dispatch({ type: "open_create" })
  }, [])

  const openEdit = useCallback((network: TCustomNetworkConfig) => {
    dispatch({ type: "open_edit", network })
  }, [])

  const close = useCallback(() => {
    dispatch({ type: "close" })
  }, [])

  const updateField = useCallback(
    (field: keyof TCustomNetworkDraft, value: string) => {
      dispatch({ type: "update_field", field, value })
    },
    []
  )

  const submit = useCallback(() => {
    const result =
      state.mode === "edit" && state.editingKey
        ? updateNetwork(state.editingKey, state.draft)
        : addNetwork(state.draft)

    if (!result.ok) {
      dispatch({ type: "set_errors", errors: result.errors })
      return
    }

    dispatch({ type: "close" })
  }, [addNetwork, state.draft, state.editingKey, state.mode, updateNetwork])

  const handleDelete = useCallback(
    (networkKey: string) => {
      removeNetwork(networkKey)
    },
    [removeNetwork]
  )

  return {
    networks,
    storageError,
    state,
    openCreate,
    openEdit,
    close,
    updateField,
    submit,
    deleteNetwork: handleDelete
  }
}

export default useCustomNetworkManager
