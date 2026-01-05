"use client"

import clsx from "clsx"
import type { SuiTransactionBlockResponse } from "@mysten/sui/client"
import { useCreateShopModalState } from "../hooks/useCreateShopModalState"
import CopyableId from "./CopyableId"
import TransactionRecap from "./TransactionRecap"
import Button from "./Button"
import {
  ModalBody,
  ModalErrorFooter,
  ModalErrorNotice,
  ModalFrame,
  ModalHeader,
  ModalSection,
  ModalStatusHeader,
  ModalSuccessFooter,
  modalFieldDescriptionClassName,
  modalFieldErrorTextClassName,
  modalFieldInputClassName,
  modalFieldInputErrorClassName,
  modalFieldLabelClassName,
  modalFieldTitleClassName
} from "./ModalPrimitives"

const ShopSummarySection = ({
  shopName,
  shopId,
  packageId,
  explorerUrl
}: {
  shopName: string
  shopId?: string
  packageId?: string
  explorerUrl?: string
}) => (
  <ModalSection title="Shop details" subtitle="Shared shop object summary">
    <div className="grid gap-3 text-xs sm:grid-cols-2">
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Name
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {shopName}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Shop ID
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {shopId ? "Ready" : "Pending"}
        </div>
        {shopId ? (
          <div className="mt-2">
            <CopyableId value={shopId} label="Shop" explorerUrl={explorerUrl} />
          </div>
        ) : undefined}
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 sm:col-span-2 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Package
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {packageId ? "Confirmed" : "Missing"}
        </div>
        {packageId ? (
          <div className="mt-2">
            <CopyableId
              value={packageId}
              label="Package"
              explorerUrl={explorerUrl}
            />
          </div>
        ) : undefined}
      </div>
    </div>
  </ModalSection>
)

const ShopSuccessView = ({
  shopName,
  shopId,
  packageId,
  transactionBlock,
  digest,
  explorerUrl,
  onClose,
  onReset
}: {
  shopName: string
  shopId?: string
  packageId?: string
  transactionBlock: SuiTransactionBlockResponse
  digest: string
  explorerUrl?: string
  onClose: () => void
  onReset: () => void
}) => (
  <>
    <ModalStatusHeader
      status="success"
      title="Shop created"
      subtitle={shopName}
      description="The shared shop is live on chain."
      onClose={onClose}
    />
    <ModalBody>
      <ShopSummarySection
        shopName={shopName}
        shopId={shopId}
        packageId={packageId}
        explorerUrl={explorerUrl}
      />
      <TransactionRecap
        transactionBlock={transactionBlock}
        digest={digest}
        explorerUrl={explorerUrl}
      />
    </ModalBody>
    <ModalSuccessFooter
      actionLabel="Create another"
      onAction={onReset}
      onClose={onClose}
    />
  </>
)

const ShopErrorView = ({
  error,
  details,
  shopName,
  onClose,
  onReset
}: {
  error: string
  details?: string
  shopName: string
  onClose: () => void
  onReset: () => void
}) => (
  <>
    <ModalStatusHeader
      status="error"
      title="Shop creation failed"
      subtitle={shopName}
      description="Review the error details and try again."
      onClose={onClose}
    />
    <ModalBody>
      <ModalErrorNotice error={error} details={details} />
    </ModalBody>
    <ModalErrorFooter onRetry={onReset} onClose={onClose} />
  </>
)

const CreateShopModal = ({
  open,
  onClose,
  packageId,
  onShopCreated
}: {
  open: boolean
  onClose: () => void
  packageId?: string
  onShopCreated?: (shopId: string) => void
}) => {
  const {
    formState,
    fieldErrors,
    transactionState,
    transactionSummary,
    isSuccessState,
    isErrorState,
    canSubmit,
    explorerUrl,
    handleCreateShop,
    handleInputChange,
    markFieldBlur,
    shouldShowFieldError,
    resetForm
  } = useCreateShopModalState({ open, packageId, onShopCreated })
  const errorState =
    transactionState.status === "error" ? transactionState : undefined

  if (!open) return <></>

  return (
    <ModalFrame onClose={onClose}>
      {isSuccessState && transactionSummary ? (
        <ShopSuccessView
          shopName={transactionSummary.shopName}
          shopId={transactionSummary.shopId}
          packageId={packageId}
          transactionBlock={transactionSummary.transactionBlock}
          digest={transactionSummary.digest}
          explorerUrl={explorerUrl}
          onClose={onClose}
          onReset={resetForm}
        />
      ) : isErrorState ? (
        <ShopErrorView
          error={errorState?.error ?? "Unknown error"}
          details={errorState?.details}
          shopName={formState.shopName || "Shop"}
          onClose={onClose}
          onReset={resetForm}
        />
      ) : (
        <>
          <ModalHeader
            eyebrow="Storefront"
            title="Create shop"
            description="Create a new shared shop object for this package."
            onClose={onClose}
            footer={
              packageId ? (
                <CopyableId
                  value={packageId}
                  label="Package"
                  explorerUrl={explorerUrl}
                />
              ) : undefined
            }
          />

          <ModalBody>
            <ModalSection
              title="Shop identity"
              subtitle="Pick a human-friendly name for the storefront."
            >
              <label className={modalFieldLabelClassName}>
                <span className={modalFieldTitleClassName}>Shop name</span>
                <span className={modalFieldDescriptionClassName}>
                  Visible label shown in dashboards and on receipts.
                </span>
                <input
                  type="text"
                  value={formState.shopName}
                  onChange={(event) =>
                    handleInputChange("shopName", event.target.value)
                  }
                  onBlur={() => markFieldBlur("shopName")}
                  placeholder="e.g. Atlas Supply Co."
                  className={clsx(
                    modalFieldInputClassName,
                    shouldShowFieldError("shopName", fieldErrors.shopName) &&
                      modalFieldInputErrorClassName
                  )}
                />
                {shouldShowFieldError("shopName", fieldErrors.shopName) ? (
                  <span className={modalFieldErrorTextClassName}>
                    {fieldErrors.shopName}
                  </span>
                ) : undefined}
              </label>
            </ModalSection>

            <ModalSection
              title="Review"
              subtitle="Confirm the name before submitting."
            >
              <div className="grid gap-3 text-xs sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                  <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                    Name
                  </div>
                  <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                    {formState.shopName || "Enter a name"}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                  <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                    Package
                  </div>
                  <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                    {packageId ? "Configured" : "Missing package ID"}
                  </div>
                  {packageId ? (
                    <div className="mt-2">
                      <CopyableId value={packageId} explorerUrl={explorerUrl} />
                    </div>
                  ) : undefined}
                </div>
              </div>
            </ModalSection>
          </ModalBody>

          <div className="border-t border-slate-200/70 px-6 py-4 dark:border-slate-50/15">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                {transactionState.status === "processing"
                  ? "Waiting for wallet confirmation..."
                  : "Ready to create the shop."}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={handleCreateShop} disabled={!canSubmit}>
                  {transactionState.status === "processing"
                    ? "Processing..."
                    : "Create shop"}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </ModalFrame>
  )
}

export default CreateShopModal
