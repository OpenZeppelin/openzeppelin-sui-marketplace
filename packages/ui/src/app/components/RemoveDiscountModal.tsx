"use client"

import type { DiscountTemplateSummary } from "@sui-oracle-market/domain-core/models/discount"
import { formatEpochSeconds, shortenId } from "../helpers/format"
import {
  useRemoveDiscountModalState,
  type RemoveDiscountTransactionSummary
} from "../hooks/useRemoveDiscountModalState"
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

const DiscountSummarySection = ({
  template,
  shopId,
  explorerUrl
}: {
  template: DiscountTemplateSummary
  shopId?: string
  explorerUrl?: string
}) => (
  <ModalSection
    title="Discount details"
    subtitle="Template scheduled to be disabled"
  >
    <div className="grid gap-3 text-xs sm:grid-cols-2">
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Rule
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {template.ruleDescription}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Status
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {template.status}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Starts
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {template.startsAt ? formatEpochSeconds(template.startsAt) : "Now"}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Expires
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {template.expiresAt
            ? formatEpochSeconds(template.expiresAt)
            : "Never"}
        </div>
      </div>
      {template.appliesToListingId ? (
        <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 sm:col-span-2 dark:border-slate-50/15 dark:bg-slate-950/60">
          <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
            Listing scope
          </div>
          <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
            Listing {shortenId(template.appliesToListingId)}
          </div>
        </div>
      ) : null}
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
      <CopyableId
        value={template.discountTemplateId}
        label="Template ID"
        explorerUrl={explorerUrl}
      />
      {template.appliesToListingId ? (
        <CopyableId
          value={template.appliesToListingId}
          label="Listing"
          explorerUrl={explorerUrl}
        />
      ) : null}
      {shopId ? (
        <CopyableId value={shopId} label="Shop ID" explorerUrl={explorerUrl} />
      ) : null}
    </div>
  </ModalSection>
)

const RemovalImpactSection = () => (
  <ModalSection
    title="Removal impact"
    subtitle="What changes after the template is disabled"
  >
    <div className="text-xs text-slate-500 dark:text-slate-200/70">
      Disabling a discount prevents it from applying to new purchases until it
      is enabled again.
    </div>
  </ModalSection>
)

const DiscountSuccessView = ({
  summary,
  shopId,
  explorerUrl,
  onClose
}: {
  summary: RemoveDiscountTransactionSummary
  shopId?: string
  explorerUrl?: string
  onClose: () => void
}) => (
  <>
    <ModalStatusHeader
      status="success"
      title="Discount disabled"
      subtitle={summary.template.ruleDescription}
      description="The discount template has been disabled on chain."
      onClose={onClose}
    />
    <ModalBody>
      <DiscountSummarySection
        template={summary.template}
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
      message="Discount disablement confirmed."
      onClose={onClose}
    />
  </>
)

const DiscountErrorView = ({
  error,
  details,
  templateLabel,
  onClose,
  onReset
}: {
  error: string
  details?: string
  templateLabel: string
  onClose: () => void
  onReset: () => void
}) => (
  <>
    <ModalStatusHeader
      status="error"
      title="Removal failed"
      subtitle={templateLabel}
      description="Review the error details and try again."
      onClose={onClose}
    />
    <ModalBody>
      <ModalErrorNotice error={error} details={details} />
    </ModalBody>
    <ModalErrorFooter onRetry={onReset} onClose={onClose} />
  </>
)

const RemoveDiscountModal = ({
  open,
  onClose,
  shopId,
  template,
  onDiscountUpdated
}: {
  open: boolean
  onClose: () => void
  shopId?: string
  template?: DiscountTemplateSummary
  onDiscountUpdated?: (template?: DiscountTemplateSummary) => void
}) => {
  const {
    transactionState,
    transactionSummary,
    isSuccessState,
    isErrorState,
    canSubmit,
    explorerUrl,
    handleDisableDiscount,
    resetState
  } = useRemoveDiscountModalState({
    open,
    shopId,
    template,
    onDiscountUpdated
  })
  const errorState =
    transactionState.status === "error" ? transactionState : undefined

  if (!open || !template) return null

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
          templateLabel={template.ruleDescription}
          onClose={onClose}
          onReset={resetState}
        />
      ) : (
        <>
          <ModalHeader
            eyebrow="Discounts"
            title="Disable Discount"
            description="Stop this discount from applying to new purchases."
            onClose={onClose}
            footer={
              <CopyableId
                value={template.discountTemplateId}
                label="Template"
                explorerUrl={explorerUrl}
              />
            }
          />
          <ModalBody>
            <DiscountSummarySection
              template={template}
              shopId={shopId}
              explorerUrl={explorerUrl}
            />
            <RemovalImpactSection />
          </ModalBody>
          <div className="border-t border-slate-200/70 px-6 py-4 dark:border-slate-50/15">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                {transactionState.status === "processing"
                  ? "Waiting for wallet confirmation..."
                  : "Ready to disable the discount."}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={handleDisableDiscount}
                  disabled={!canSubmit}
                >
                  {transactionState.status === "processing"
                    ? "Processing..."
                    : "Disable discount"}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </ModalFrame>
  )
}

export default RemoveDiscountModal
