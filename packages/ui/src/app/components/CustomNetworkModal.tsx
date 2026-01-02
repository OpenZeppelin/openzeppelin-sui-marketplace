"use client"

import { shortenId } from "../helpers/format"
import type {
  TCustomNetworkConfig,
  TCustomNetworkDraft,
  TCustomNetworkErrors
} from "../types/TCustomNetwork"
import Button from "./Button"
import {
  ModalBody,
  ModalFrame,
  ModalHeader,
  ModalSection,
  modalFieldErrorTextClassName,
  modalFieldInputClassName,
  modalFieldInputErrorClassName,
  modalFieldLabelClassName
} from "./ModalPrimitives"

const inputClassName = (error?: string) =>
  [modalFieldInputClassName, error ? modalFieldInputErrorClassName : ""]
    .filter(Boolean)
    .join(" ")

const CustomNetworkModal = ({
  open,
  mode,
  draft,
  errors,
  networks,
  storageError,
  onClose,
  onSubmit,
  onFieldChange,
  onEdit,
  onDelete,
  onStartCreate
}: {
  open: boolean
  mode: "create" | "edit"
  draft: TCustomNetworkDraft
  errors: TCustomNetworkErrors
  networks: TCustomNetworkConfig[]
  storageError?: string
  onClose: () => void
  onSubmit: () => void
  onFieldChange: (field: keyof TCustomNetworkDraft, value: string) => void
  onEdit: (network: TCustomNetworkConfig) => void
  onDelete: (network: TCustomNetworkConfig) => void
  onStartCreate: () => void
}) => {
  if (!open) return null

  const isEditing = mode === "edit"

  return (
    <ModalFrame onClose={onClose}>
      <ModalHeader
        eyebrow="Network configuration"
        title="Configure networks"
        description="Custom RPC endpoints and contract package IDs are saved in your browser and only apply on localhost."
        onClose={onClose}
      />
      <ModalBody>
        {storageError ? (
          <div className="rounded-2xl border border-amber-200/70 bg-amber-50/70 px-4 py-3 text-xs text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
            {storageError}
          </div>
        ) : null}

        <ModalSection
          title="Configured custom networks"
          subtitle="These entries are available in the network selector."
        >
          {networks.length === 0 ? (
            <div className="text-xs text-slate-500 dark:text-slate-200/70">
              No custom networks saved yet.
            </div>
          ) : (
            <div className="space-y-3">
              {networks.map((network) => (
                <div
                  key={network.networkKey}
                  className="rounded-xl border border-slate-200/80 bg-white/80 px-4 py-3 text-xs shadow-[0_12px_28px_-24px_rgba(15,23,42,0.4)] dark:border-slate-50/15 dark:bg-slate-950/70"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-sm font-semibold text-sds-dark dark:text-sds-light">
                        {network.label}
                      </div>
                      <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/70">
                        {network.networkKey}
                      </div>
                      <div className="text-[0.7rem] text-slate-500 dark:text-slate-200/70">
                        RPC:{" "}
                        <span className="break-all font-medium text-slate-600 dark:text-slate-100">
                          {network.rpcUrl}
                        </span>
                      </div>
                      <div className="text-[0.7rem] text-slate-500 dark:text-slate-200/70">
                        Explorer:{" "}
                        <span className="break-all font-medium text-slate-600 dark:text-slate-100">
                          {network.explorerUrl}
                        </span>
                      </div>
                      <div className="text-[0.7rem] text-slate-500 dark:text-slate-200/70">
                        Package {shortenId(network.contractPackageId)}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="secondary"
                        size="compact"
                        onClick={() => onEdit(network)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="danger"
                        size="compact"
                        onClick={() => onDelete(network)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ModalSection>

        <ModalSection
          title={isEditing ? "Edit network" : "Add a network"}
          subtitle="Supply RPC, explorer, and contract package IDs for the target chain."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <label className={modalFieldLabelClassName}>
              <span>Network key</span>
              <input
                value={draft.networkKey}
                onChange={(event) =>
                  onFieldChange("networkKey", event.target.value)
                }
                className={inputClassName(errors.networkKey)}
                placeholder="customnet"
                disabled={isEditing}
              />
              {errors.networkKey ? (
                <span className={modalFieldErrorTextClassName}>
                  {errors.networkKey}
                </span>
              ) : null}
            </label>

            <label className={modalFieldLabelClassName}>
              <span>Display label</span>
              <input
                value={draft.label}
                onChange={(event) => onFieldChange("label", event.target.value)}
                className={inputClassName(errors.label)}
                placeholder="Customnet"
              />
              {errors.label ? (
                <span className={modalFieldErrorTextClassName}>
                  {errors.label}
                </span>
              ) : null}
            </label>
          </div>

          <label className={modalFieldLabelClassName}>
            <span>RPC URL</span>
            <input
              value={draft.rpcUrl}
              onChange={(event) => onFieldChange("rpcUrl", event.target.value)}
              className={inputClassName(errors.rpcUrl)}
              placeholder="https://fullnode.customnet.xyz"
            />
            {errors.rpcUrl ? (
              <span className={modalFieldErrorTextClassName}>
                {errors.rpcUrl}
              </span>
            ) : null}
          </label>

          <label className={modalFieldLabelClassName}>
            <span>Explorer URL</span>
            <input
              value={draft.explorerUrl}
              onChange={(event) =>
                onFieldChange("explorerUrl", event.target.value)
              }
              className={inputClassName(errors.explorerUrl)}
              placeholder="https://explorer.customnet.xyz"
            />
            {errors.explorerUrl ? (
              <span className={modalFieldErrorTextClassName}>
                {errors.explorerUrl}
              </span>
            ) : null}
          </label>

          <label className={modalFieldLabelClassName}>
            <span>Contract package ID</span>
            <input
              value={draft.contractPackageId}
              onChange={(event) =>
                onFieldChange("contractPackageId", event.target.value)
              }
              className={inputClassName(errors.contractPackageId)}
              placeholder="0x..."
            />
            {errors.contractPackageId ? (
              <span className={modalFieldErrorTextClassName}>
                {errors.contractPackageId}
              </span>
            ) : null}
          </label>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/70">
              {isEditing
                ? "Update configuration for this network."
                : "Create a new custom network entry."}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isEditing ? (
                <Button
                  variant="secondary"
                  size="compact"
                  onClick={onStartCreate}
                >
                  Add new
                </Button>
              ) : null}
              <Button onClick={onSubmit}>
                {isEditing ? "Update network" : "Add network"}
              </Button>
            </div>
          </div>
        </ModalSection>
      </ModalBody>
    </ModalFrame>
  )
}

export default CustomNetworkModal
