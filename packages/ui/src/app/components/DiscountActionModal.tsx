"use client"

import type { DiscountSummary } from "@sui-oracle-market/domain-core/models/discount"
import { formatEpochSeconds, shortenId } from "../helpers/format"
import {
  useDiscountActionModalState,
  type DiscountAction,
  type DiscountActionTransactionSummary
} from "../hooks/useDiscountActionModalState"
import CopyableId from "./CopyableId"
import {
  ModalBody,
  ModalCloseFooter,
  ModalErrorFooter,
  ModalErrorNotice,
  ModalFrame,
  ModalHeader,
  ModalSection,
  ModalStatusHeader
} from "./ModalPrimitives"
import Button from "./Button"
import TransactionRecap from "./TransactionRecap"

const resolveActionLabel = ({
  action,
  activeFlag,
  isSpotlight
}: {
  action: DiscountAction
  activeFlag: boolean
  isSpotlight: boolean
}) => {
  if (action === "remove") return "Remove discount"
  if (action === "spotlight")
    return isSpotlight ? "Unspotlight discount" : "Spotlight discount"
  return activeFlag ? "Disable discount" : "Enable discount"
}

const resolveActionTitle = ({
  action,
  activeFlag,
  isSpotlight
}: {
  action: DiscountAction
  activeFlag: boolean
  isSpotlight: boolean
}) => {
  if (action === "remove") return "Remove Discount"
  if (action === "spotlight")
    return isSpotlight ? "Unspotlight Discount" : "Spotlight Discount"
  return activeFlag ? "Disable Discount" : "Enable Discount"
}

const resolveActionDescription = ({
  action,
  activeFlag,
  isSpotlight
}: {
  action: DiscountAction
  activeFlag: boolean
  isSpotlight: boolean
}) => {
  if (action === "remove")
    return "Permanently remove this discount from the shop."
  if (action === "spotlight")
    return isSpotlight
      ? "Stop featuring this discount on its listings."
      : "Feature this discount on its listings."
  return activeFlag
    ? "Stop this discount from applying to new purchases."
    : "Enable this discount so it can apply to new purchases."
}

const resolveSuccessTitle = ({
  action,
  activeFlag,
  isSpotlight
}: {
  action: DiscountAction
  activeFlag: boolean
  isSpotlight: boolean
}) => {
  if (action === "remove") return "Discount removed"
  if (action === "spotlight")
    return isSpotlight ? "Discount spotlighted" : "Discount unspotlighted"
  return activeFlag ? "Discount disabled" : "Discount enabled"
}

const resolveSuccessDescription = ({
  action,
  activeFlag,
  isSpotlight
}: {
  action: DiscountAction
  activeFlag: boolean
  isSpotlight: boolean
}) => {
  if (action === "remove") return "The discount has been removed from the shop."
  if (action === "spotlight")
    return isSpotlight
      ? "The discount is now featured on its listings."
      : "The discount is no longer featured on its listings."
  return activeFlag
    ? "The discount has been disabled on chain."
    : "The discount has been enabled on chain."
}

const DiscountSummarySection = ({
  discount,
  shopId,
  explorerUrl
}: {
  discount: DiscountSummary
  shopId?: string
  explorerUrl?: string
}) => (
  <ModalSection title="Discount details" subtitle="Selected discount">
    <div className="grid gap-3 text-xs sm:grid-cols-2">
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Rule
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {discount.ruleDescription}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Status
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {discount.status}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Starts
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {discount.startsAt ? formatEpochSeconds(discount.startsAt) : "Now"}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Expires
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {discount.expiresAt
            ? formatEpochSeconds(discount.expiresAt)
            : "Never"}
        </div>
      </div>
      {discount.appliesToListingId ? (
        <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 sm:col-span-2 dark:border-slate-50/15 dark:bg-slate-950/60">
          <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
            Listing scope
          </div>
          <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
            Listing {shortenId(discount.appliesToListingId)}
          </div>
        </div>
      ) : undefined}
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
      <CopyableId
        value={discount.discountId}
        label="Discount ID"
        explorerUrl={explorerUrl}
      />
      {discount.appliesToListingId ? (
        <CopyableId
          value={discount.appliesToListingId}
          label="Listing ID"
          showExplorer={false}
        />
      ) : undefined}
      {shopId ? (
        <CopyableId value={shopId} label="Shop ID" explorerUrl={explorerUrl} />
      ) : undefined}
    </div>
  </ModalSection>
)

const resolveActionImpact = (action: DiscountAction) => {
  if (action === "remove")
    return "Removing a discount deletes it from shop storage."
  if (action === "spotlight")
    return "Spotlighting controls whether this discount is featured on its listings in the storefront."
  return "Toggling updates whether this discount can be selected for new purchases."
}

const ActionImpactSection = ({ action }: { action: DiscountAction }) => (
  <ModalSection title="Action impact" subtitle="Expected storefront behavior">
    <div className="text-xs text-slate-500 dark:text-slate-200/70">
      {resolveActionImpact(action)}
    </div>
  </ModalSection>
)

const DiscountSuccessView = ({
  summary,
  shopId,
  explorerUrl,
  onClose
}: {
  summary: DiscountActionTransactionSummary
  shopId?: string
  explorerUrl?: string
  onClose: () => void
}) => (
  <>
    <ModalStatusHeader
      status="success"
      title={resolveSuccessTitle({
        action: summary.action,
        activeFlag: summary.discount.activeFlag,
        isSpotlight: summary.discount.isSpotlight
      })}
      subtitle={summary.discount.ruleDescription}
      description={resolveSuccessDescription({
        action: summary.action,
        activeFlag: summary.discount.activeFlag,
        isSpotlight: summary.discount.isSpotlight
      })}
      onClose={onClose}
    />
    <ModalBody>
      <DiscountSummarySection
        discount={summary.discount}
        shopId={shopId}
        explorerUrl={explorerUrl}
      />
      <TransactionRecap
        transactionBlock={summary.transactionBlock}
        digest={summary.digest}
        explorerUrl={explorerUrl}
      />
    </ModalBody>
    <ModalCloseFooter
      message={
        summary.action === "remove"
          ? "Discount removal confirmed."
          : "Discount update confirmed."
      }
      onClose={onClose}
    />
  </>
)

const DiscountErrorView = ({
  error,
  details,
  discountLabel,
  onClose,
  onReset
}: {
  error: string
  details?: string
  discountLabel: string
  onClose: () => void
  onReset: () => void
}) => (
  <>
    <ModalStatusHeader
      status="error"
      title="Action failed"
      subtitle={discountLabel}
      description="Review the error details and try again."
      onClose={onClose}
    />
    <ModalBody>
      <ModalErrorNotice error={error} details={details} />
    </ModalBody>
    <ModalErrorFooter onRetry={onReset} onClose={onClose} />
  </>
)

const DiscountActionModal = ({
  open,
  action,
  onClose,
  shopId,
  discount,
  onDiscountUpdated,
  onDiscountRemoved
}: {
  open: boolean
  action: DiscountAction
  onClose: () => void
  shopId?: string
  discount?: DiscountSummary
  onDiscountUpdated?: (discount?: DiscountSummary) => void
  onDiscountRemoved?: (discountId?: string) => void
}) => {
  const {
    transactionState,
    transactionSummary,
    isSuccessState,
    isErrorState,
    canSubmit,
    explorerUrl,
    handleDiscountAction,
    resetState
  } = useDiscountActionModalState({
    open,
    action,
    shopId,
    discount,
    onDiscountUpdated,
    onDiscountRemoved
  })
  const errorState =
    transactionState.status === "error" ? transactionState : undefined

  if (!open || !discount) return <></>

  const submitLabel = resolveActionLabel({
    action,
    activeFlag: discount.activeFlag,
    isSpotlight: discount.isSpotlight
  })
  const submitVariant = action === "remove" ? "danger" : "primary"

  return (
    <ModalFrame onClose={onClose}>
      {isSuccessState && transactionSummary ? (
        <DiscountSuccessView
          summary={transactionSummary}
          shopId={shopId}
          explorerUrl={explorerUrl}
          onClose={onClose}
        />
      ) : isErrorState ? (
        <DiscountErrorView
          error={errorState?.error ?? "Unknown error"}
          details={errorState?.details}
          discountLabel={discount.ruleDescription}
          onClose={onClose}
          onReset={resetState}
        />
      ) : (
        <>
          <ModalHeader
            eyebrow="Discounts"
            title={resolveActionTitle({
              action,
              activeFlag: discount.activeFlag,
              isSpotlight: discount.isSpotlight
            })}
            description={resolveActionDescription({
              action,
              activeFlag: discount.activeFlag,
              isSpotlight: discount.isSpotlight
            })}
            onClose={onClose}
            footer={
              <CopyableId
                value={discount.discountId}
                label="Discount"
                explorerUrl={explorerUrl}
              />
            }
          />
          <ModalBody>
            <DiscountSummarySection
              discount={discount}
              shopId={shopId}
              explorerUrl={explorerUrl}
            />
            <ActionImpactSection action={action} />
          </ModalBody>
          <div className="border-t border-slate-200/70 px-6 py-4 dark:border-slate-50/15">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                {transactionState.status === "processing"
                  ? "Waiting for wallet confirmation..."
                  : "Ready to submit."}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  variant={submitVariant}
                  onClick={handleDiscountAction}
                  disabled={!canSubmit}
                >
                  {transactionState.status === "processing"
                    ? "Processing..."
                    : submitLabel}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </ModalFrame>
  )
}

export default DiscountActionModal
