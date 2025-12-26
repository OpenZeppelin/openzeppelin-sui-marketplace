"use client"

import clsx from "clsx"
import { useMemo } from "react"

import {
  defaultStartTimestampSeconds,
  describeRuleKind,
  discountRuleChoices,
  type DiscountRuleKindLabel,
  type DiscountTemplateSummary
} from "@sui-oracle-market/domain-core/models/discount"
import type { ItemListingSummary } from "@sui-oracle-market/domain-core/models/item-listing"
import { parseNonNegativeU64 } from "@sui-oracle-market/tooling-core/utils/utility"
import {
  formatDiscountRulePreview,
  resolveRuleValuePreview
} from "../helpers/discountPreview"
import {
  formatEpochSeconds,
  getStructLabel,
  shortenId
} from "../helpers/format"
import {
  useAddDiscountModalState,
  type DiscountTransactionSummary
} from "../hooks/useAddDiscountModalState"
import Button from "./Button"
import CopyableId from "./CopyableId"
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
import TransactionRecap from "./TransactionRecap"

const buildListingLookup = (itemListings: ItemListingSummary[]) =>
  itemListings.reduce<Record<string, ItemListingSummary>>(
    (accumulator, listing) => ({
      ...accumulator,
      [listing.itemListingId]: listing
    }),
    {}
  )

const resolveListingLabel = (
  listing?: ItemListingSummary
): string | undefined => {
  if (!listing) return undefined
  return listing.name || getStructLabel(listing.itemType)
}

const DiscountSummarySection = ({
  summary,
  shopId,
  listingLabel
}: {
  summary: DiscountTransactionSummary
  shopId?: string
  listingLabel?: string
}) => (
  <ModalSection title="Discount details" subtitle="Rule, scope, and schedule">
    <div className="grid gap-3 text-xs sm:grid-cols-2">
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Rule
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {formatDiscountRulePreview({
            ruleKind: summary.ruleKind,
            ruleValue: summary.ruleValue
          })}
        </div>
        <div className="mt-2 text-[0.7rem] text-slate-500 dark:text-slate-200/60">
          {describeRuleKind(summary.ruleKind)} discount
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Starts at
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {formatEpochSeconds(summary.startsAt.toString())}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Expires at
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {summary.expiresAt
            ? formatEpochSeconds(summary.expiresAt.toString())
            : "No expiry"}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Max redemptions
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {summary.maxRedemptions?.toString() ?? "Unlimited"}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 sm:col-span-2 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Applies to listing
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {listingLabel ??
            (summary.appliesToListingId
              ? shortenId(summary.appliesToListingId)
              : "All listings")}
        </div>
        {summary.appliesToListingId ? (
          <div className="mt-2 text-[0.7rem] text-slate-500 dark:text-slate-200/60">
            {summary.appliesToListingId}
          </div>
        ) : null}
      </div>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
      {summary.discountTemplateId ? (
        <CopyableId value={summary.discountTemplateId} label="Template ID" />
      ) : null}
      {shopId ? <CopyableId value={shopId} label="Shop ID" /> : null}
    </div>
  </ModalSection>
)

const DiscountSuccessView = ({
  summary,
  shopId,
  explorerUrl,
  listingLabel,
  onClose,
  onReset
}: {
  summary: DiscountTransactionSummary
  shopId?: string
  explorerUrl?: string
  listingLabel?: string
  onClose: () => void
  onReset: () => void
}) => (
  <>
    <ModalStatusHeader
      status="success"
      title="Discount template created"
      subtitle={formatDiscountRulePreview({
        ruleKind: summary.ruleKind,
        ruleValue: summary.ruleValue
      })}
      description="The discount is now available on chain."
      onClose={onClose}
    />
    <ModalBody>
      <DiscountSummarySection
        summary={summary}
        shopId={shopId}
        listingLabel={listingLabel}
      />
      <TransactionRecap
        transactionBlock={summary.transactionBlock}
        digest={summary.digest}
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

const DiscountErrorView = ({
  error,
  details,
  rulePreview,
  onClose,
  onReset
}: {
  error: string
  details?: string
  rulePreview: string
  onClose: () => void
  onReset: () => void
}) => (
  <>
    <ModalStatusHeader
      status="error"
      title="Discount creation failed"
      subtitle={rulePreview}
      description="Review the error details and try again."
      onClose={onClose}
    />
    <ModalBody>
      <ModalErrorNotice error={error} details={details} />
    </ModalBody>
    <ModalErrorFooter onRetry={onReset} onClose={onClose} />
  </>
)

const AddDiscountModal = ({
  open,
  onClose,
  shopId,
  itemListings,
  onDiscountCreated
}: {
  open: boolean
  onClose: () => void
  shopId?: string
  itemListings: ItemListingSummary[]
  onDiscountCreated?: (template?: DiscountTemplateSummary) => void
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
    handleAddDiscount,
    handleInputChange,
    markFieldBlur,
    shouldShowFieldError,
    resetForm
  } = useAddDiscountModalState({ open, shopId, onDiscountCreated })

  const listingLookup = useMemo(
    () => buildListingLookup(itemListings),
    [itemListings]
  )

  if (!open) return null

  const rulePreview = resolveRuleValuePreview(
    formState.ruleKind,
    formState.ruleValue
  )
  const ruleValuePreview = rulePreview

  const startsAtPreview = (() => {
    const startsAt = formState.startsAt.trim()
    if (!startsAt) return "Enter start time"
    try {
      return formatEpochSeconds(
        parseNonNegativeU64(startsAt, "startsAt").toString()
      )
    } catch {
      return "Invalid start time"
    }
  })()

  const expiresAtPreview = (() => {
    const expiresAt = formState.expiresAt.trim()
    if (!expiresAt) return "No expiry"
    try {
      return formatEpochSeconds(
        parseNonNegativeU64(expiresAt, "expiresAt").toString()
      )
    } catch {
      return "Invalid expiry"
    }
  })()

  const listingPreviewLabel = (() => {
    const listingId = formState.appliesToListingId.trim()
    if (!listingId) return "All listings"
    const listing = listingLookup[listingId]
    const label = listing ? resolveListingLabel(listing) : undefined
    return label ?? shortenId(listingId)
  })()

  const listingLabel =
    transactionSummary?.appliesToListingId &&
    listingLookup[transactionSummary.appliesToListingId]
      ? resolveListingLabel(
          listingLookup[transactionSummary.appliesToListingId]
        )
      : undefined

  const ruleValuePlaceholder = formState.ruleKind === "fixed" ? "5.25" : "12.5"
  const ruleValueHint =
    formState.ruleKind === "fixed"
      ? "USD amount in dollars that converts to cents on chain."
      : "Percent off with up to two decimals (0 - 100)."

  return (
    <ModalFrame onClose={onClose}>
      {isSuccessState && transactionSummary ? (
        <DiscountSuccessView
          summary={transactionSummary}
          shopId={shopId}
          explorerUrl={explorerUrl}
          listingLabel={listingLabel}
          onClose={onClose}
          onReset={resetForm}
        />
      ) : isErrorState ? (
        <DiscountErrorView
          error={transactionState.error}
          details={transactionState.details}
          rulePreview={rulePreview}
          onClose={onClose}
          onReset={resetForm}
        />
      ) : (
        <>
          <ModalHeader
            eyebrow="Promotions"
            title="Add Discount"
            description="Create a discount template for your storefront."
            onClose={onClose}
            footer={shopId ? <CopyableId value={shopId} label="Shop" /> : null}
          />

          <ModalBody>
            <ModalSection
              title="Discount rule"
              subtitle="Define the promotion mechanics."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <label className={modalFieldLabelClassName}>
                  <span className={modalFieldTitleClassName}>Rule type</span>
                  <span className={modalFieldDescriptionClassName}>
                    Choose a fixed dollar discount or a percent-off promotion.
                  </span>
                  <select
                    value={formState.ruleKind}
                    onChange={(event) =>
                      handleInputChange(
                        "ruleKind",
                        event.target.value as DiscountRuleKindLabel
                      )
                    }
                    onBlur={() => markFieldBlur("ruleKind")}
                    className={clsx(
                      modalFieldInputClassName,
                      shouldShowFieldError("ruleKind", fieldErrors.ruleKind) &&
                        modalFieldInputErrorClassName
                    )}
                  >
                    {discountRuleChoices.map((rule) => (
                      <option key={rule} value={rule}>
                        {rule === "fixed" ? "Fixed amount" : "Percent off"}
                      </option>
                    ))}
                  </select>
                  {shouldShowFieldError("ruleKind", fieldErrors.ruleKind) ? (
                    <span className={modalFieldErrorTextClassName}>
                      {fieldErrors.ruleKind}
                    </span>
                  ) : null}
                </label>
                <label className={modalFieldLabelClassName}>
                  <span className={modalFieldTitleClassName}>Rule value</span>
                  <span className={modalFieldDescriptionClassName}>
                    {ruleValueHint}
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={formState.ruleValue}
                    onChange={(event) =>
                      handleInputChange("ruleValue", event.target.value)
                    }
                    onBlur={() => markFieldBlur("ruleValue")}
                    placeholder={ruleValuePlaceholder}
                    className={clsx(
                      modalFieldInputClassName,
                      shouldShowFieldError(
                        "ruleValue",
                        fieldErrors.ruleValue
                      ) && modalFieldInputErrorClassName
                    )}
                  />
                  {shouldShowFieldError("ruleValue", fieldErrors.ruleValue) ? (
                    <span className={modalFieldErrorTextClassName}>
                      {fieldErrors.ruleValue}
                    </span>
                  ) : null}
                </label>
              </div>
            </ModalSection>

            <ModalSection
              title="Schedule & limits"
              subtitle="Set the activation window and redemption cap."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <label className={modalFieldLabelClassName}>
                  <span className={modalFieldTitleClassName}>
                    Starts at (epoch seconds)
                  </span>
                  <span className={modalFieldDescriptionClassName}>
                    When the discount becomes active. Default is now.
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formState.startsAt}
                    onChange={(event) =>
                      handleInputChange("startsAt", event.target.value)
                    }
                    onBlur={() => markFieldBlur("startsAt")}
                    placeholder={defaultStartTimestampSeconds().toString()}
                    className={clsx(
                      modalFieldInputClassName,
                      shouldShowFieldError("startsAt", fieldErrors.startsAt) &&
                        modalFieldInputErrorClassName
                    )}
                  />
                  {shouldShowFieldError("startsAt", fieldErrors.startsAt) ? (
                    <span className={modalFieldErrorTextClassName}>
                      {fieldErrors.startsAt}
                    </span>
                  ) : null}
                </label>
                <label className={modalFieldLabelClassName}>
                  <span className={modalFieldTitleClassName}>
                    Expires at (optional)
                  </span>
                  <span className={modalFieldDescriptionClassName}>
                    Leave blank for no expiry. Must be after starts at.
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formState.expiresAt}
                    onChange={(event) =>
                      handleInputChange("expiresAt", event.target.value)
                    }
                    onBlur={() => markFieldBlur("expiresAt")}
                    placeholder="e.g. 1735689600"
                    className={clsx(
                      modalFieldInputClassName,
                      shouldShowFieldError(
                        "expiresAt",
                        fieldErrors.expiresAt
                      ) && modalFieldInputErrorClassName
                    )}
                  />
                  {shouldShowFieldError("expiresAt", fieldErrors.expiresAt) ? (
                    <span className={modalFieldErrorTextClassName}>
                      {fieldErrors.expiresAt}
                    </span>
                  ) : null}
                </label>
                <label
                  className={clsx(modalFieldLabelClassName, "md:col-span-2")}
                >
                  <span className={modalFieldTitleClassName}>
                    Max redemptions (optional)
                  </span>
                  <span className={modalFieldDescriptionClassName}>
                    Global redemption cap across all buyers. Leave blank for
                    unlimited.
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formState.maxRedemptions}
                    onChange={(event) =>
                      handleInputChange("maxRedemptions", event.target.value)
                    }
                    onBlur={() => markFieldBlur("maxRedemptions")}
                    placeholder="e.g. 500"
                    className={clsx(
                      modalFieldInputClassName,
                      shouldShowFieldError(
                        "maxRedemptions",
                        fieldErrors.maxRedemptions
                      ) && modalFieldInputErrorClassName
                    )}
                  />
                  {shouldShowFieldError(
                    "maxRedemptions",
                    fieldErrors.maxRedemptions
                  ) ? (
                    <span className={modalFieldErrorTextClassName}>
                      {fieldErrors.maxRedemptions}
                    </span>
                  ) : null}
                </label>
              </div>
            </ModalSection>

            <ModalSection
              title="Applies to"
              subtitle="Scope the discount to a listing or leave it global."
            >
              <div className="grid gap-4">
                <label className={modalFieldLabelClassName}>
                  <span className={modalFieldTitleClassName}>
                    Listing ID (optional)
                  </span>
                  <span className={modalFieldDescriptionClassName}>
                    Link the discount to a single listing or leave blank to
                    apply to all items.
                  </span>
                  <input
                    type="text"
                    list="listing-options"
                    value={formState.appliesToListingId}
                    onChange={(event) =>
                      handleInputChange(
                        "appliesToListingId",
                        event.target.value
                      )
                    }
                    onBlur={() => markFieldBlur("appliesToListingId")}
                    placeholder="0x... listing id"
                    className={clsx(
                      modalFieldInputClassName,
                      shouldShowFieldError(
                        "appliesToListingId",
                        fieldErrors.appliesToListingId
                      ) && modalFieldInputErrorClassName
                    )}
                  />
                  {shouldShowFieldError(
                    "appliesToListingId",
                    fieldErrors.appliesToListingId
                  ) ? (
                    <span className={modalFieldErrorTextClassName}>
                      {fieldErrors.appliesToListingId}
                    </span>
                  ) : null}
                  <datalist id="listing-options">
                    {itemListings.map((listing) => (
                      <option
                        key={listing.itemListingId}
                        value={listing.itemListingId}
                      >
                        {resolveListingLabel(listing) ?? "Listing"} -{" "}
                        {shortenId(listing.itemListingId)}
                      </option>
                    ))}
                  </datalist>
                </label>
              </div>
            </ModalSection>

            <ModalSection
              title="Review"
              subtitle="Confirm the discount details before submitting."
            >
              <div className="grid gap-3 text-xs sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                  <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                    Rule
                  </div>
                  <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                    {ruleValuePreview}
                  </div>
                  <div className="mt-1 text-[0.65rem] text-slate-500 dark:text-slate-200/60">
                    {formState.ruleKind === "fixed"
                      ? "Fixed discount"
                      : "Percent discount"}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                  <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                    Starts at
                  </div>
                  <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                    {startsAtPreview}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                  <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                    Expires at
                  </div>
                  <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                    {formState.expiresAt.trim()
                      ? expiresAtPreview
                      : "No expiry"}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                  <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                    Max redemptions
                  </div>
                  <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                    {formState.maxRedemptions.trim()
                      ? formState.maxRedemptions.trim()
                      : "Unlimited"}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 sm:col-span-2 dark:border-slate-50/15 dark:bg-slate-950/60">
                  <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                    Applies to listing
                  </div>
                  <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                    {listingPreviewLabel}
                  </div>
                  {formState.appliesToListingId.trim() ? (
                    <div className="mt-1 text-[0.65rem] text-slate-500 dark:text-slate-200/60">
                      {formState.appliesToListingId.trim()}
                    </div>
                  ) : null}
                </div>
              </div>
            </ModalSection>
          </ModalBody>

          <div className="border-t border-slate-200/70 px-6 py-4 dark:border-slate-50/15">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                {transactionState.status === "processing"
                  ? "Waiting for wallet confirmation..."
                  : "Ready to create the discount."}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={handleAddDiscount} disabled={!canSubmit}>
                  {transactionState.status === "processing"
                    ? "Processing..."
                    : "Create discount"}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </ModalFrame>
  )
}

export default AddDiscountModal
