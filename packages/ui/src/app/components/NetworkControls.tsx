"use client"

import { useSuiClientContext } from "@mysten/dapp-kit"
import { useCallback } from "react"
import useClientReady from "../hooks/useClientReady"
import useCustomNetworkManager from "../hooks/useCustomNetworkManager"
import useHostNetworkPolicy from "../hooks/useHostNetworkPolicy"
import useNetworkOptions from "../hooks/useNetworkOptions"
import CustomNetworkModal from "./CustomNetworkModal"
import NetworkSwitcher from "./NetworkSwitcher"
import { headerControlBaseClassName } from "./controlStyles"

const NetworkControls = () => {
  const isClientReady = useClientReady()
  const { allowNetworkSwitching } = useHostNetworkPolicy()
  const { network: currentNetwork, selectNetwork } = useSuiClientContext()
  const options = useNetworkOptions(currentNetwork)
  const {
    networks,
    storageError,
    state,
    openCreate,
    openEdit,
    close,
    updateField,
    submit,
    deleteNetwork
  } = useCustomNetworkManager()

  const handleNetworkChange = useCallback(
    (nextNetwork: string) => {
      selectNetwork(nextNetwork)
    },
    [selectNetwork]
  )

  const handleDelete = useCallback(
    (networkKey: string, label: string) => {
      if (
        typeof window !== "undefined" &&
        !window.confirm(`Delete ${label}? This cannot be undone.`)
      ) {
        return
      }
      deleteNetwork(networkKey)
      if (state.mode === "edit" && state.editingKey === networkKey) {
        openCreate()
      }
    },
    [deleteNetwork, openCreate, state.editingKey, state.mode]
  )

  if (!isClientReady || !allowNetworkSwitching) return <></>

  return (
    <div className="flex flex-col items-center gap-2 sm:flex-row">
      {options.length > 0 ? (
        <NetworkSwitcher
          value={currentNetwork}
          options={options}
          onChange={handleNetworkChange}
        />
      ) : undefined}
      <button
        type="button"
        onClick={openCreate}
        className={headerControlBaseClassName}
      >
        Configure network
      </button>
      <CustomNetworkModal
        open={state.isOpen}
        mode={state.mode}
        draft={state.draft}
        errors={state.errors}
        networks={networks}
        storageError={storageError}
        onClose={close}
        onSubmit={submit}
        onFieldChange={updateField}
        onEdit={openEdit}
        onDelete={(network) => handleDelete(network.networkKey, network.label)}
        onStartCreate={openCreate}
      />
    </div>
  )
}

export default NetworkControls
