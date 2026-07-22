"use client"

import {
  describeRuleKind,
  discountRuleChoices,
  parseDiscountRuleKind,
  type DiscountRuleKindLabel
} from "@sui-oracle-market/domain-core/models/discount"
import type { ItemListingSummary } from "@sui-oracle-market/domain-core/models/item-listing"
import clsx from "clsx"
import {
  formatUsdFromCents,
  getStructLabel,
  shortenId
} from "../helpers/format"
import {
  useAddItemModalState,
  type ListingTransactionSummary
} from "../hooks/useAddItemModalState"
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

const describeCreateSpotlightDiscount = (
  createSpotlightDiscount?: ListingTransactionSummary["createSpotlightDiscount"]
): string => {
  if (!createSpotlightDiscount) return "None"
  try {
    const ruleValueLabel =
      createSpotlightDiscount.ruleKind === 0
        ? `$${(Number(createSpotlightDiscount.ruleValue) / 100).toFixed(2)} off`
        : `${(Number(createSpotlightDiscount.ruleValue) / 100).toFixed(2)}% off`
    return `${describeRuleKind(createSpotlightDiscount.ruleKind)} (${ruleValueLabel})`
  } catch {
    return describeRuleKind(createSpotlightDiscount.ruleKind)
  }
}

const ListingSummarySection = ({
  summary,
  shopId,
  explorerUrl
}: {
  summary: ListingTransactionSummary
  shopId?: string
  explorerUrl?: string
}) => (
  <ModalSection title="Listing details" subtitle="Inventory and pricing record">
    <div className="grid gap-3 text-xs sm:grid-cols-2">
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Name
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {summary.itemName}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Item type
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {getStructLabel(summary.itemType)}
        </div>
        <div className="mt-2 overflow-auto text-[0.7rem] text-slate-500 dark:text-slate-200/60">
          {summary.itemType}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Base price
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {formatUsdFromCents(summary.basePriceUsdCents.toString())}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Stock
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {summary.stock.toString()}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 sm:col-span-2 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Spotlight discount
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {describeCreateSpotlightDiscount(summary.createSpotlightDiscount)}
        </div>
      </div>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
      {summary.listingId ? (
        <CopyableId
          value={summary.listingId}
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

const ListingSuccessView = ({
  summary,
  shopId,
  explorerUrl,
  onClose,
  onReset
}: {
  summary: ListingTransactionSummary
  shopId?: string
  explorerUrl?: string
  onClose: () => void
  onReset: () => void
}) => (
  <>
    <ModalStatusHeader
      status="success"
      title="Listing created"
      subtitle={summary.itemName}
      description="The inventory entry is live on chain."
      onClose={onClose}
    />
    <ModalBody>
      <ListingSummarySection
        summary={summary}
        shopId={shopId}
        explorerUrl={explorerUrl}
      />
      <TransactionRecap
        transactionBlock={summary.transactionBlock}
        digest={summary.digest}
        explorerUrl={explorerUrl}
      />
    </ModalBody>
    <ModalSuccessFooter
      actionLabel="Add another"
      onAction={onReset}
      onClose={onClose}
    />
  </>
)

const ListingErrorView = ({
  error,
  details,
  itemName,
  onClose,
  onReset
}: {
  error: string
  details?: string
  itemName: string
  onClose: () => void
  onReset: () => void
}) => (
  <>
    <ModalStatusHeader
      status="error"
      title="Listing failed"
      subtitle={itemName}
      description="Review the error details and try again."
      onClose={onClose}
    />
    <ModalBody>
      <ModalErrorNotice error={error} details={details} />
    </ModalBody>
    <ModalErrorFooter onRetry={onReset} onClose={onClose} />
  </>
)

const AddItemModal = ({
  open,
  onClose,
  shopId,
  onListingCreated
}: {
  open: boolean
  onClose: () => void
  shopId?: string
  onListingCreated?: (listing?: ItemListingSummary) => void
}) => {
  const {
    formState,
    fieldErrors,
    pricePreview,
    stockPreview,
    itemTypeLabel,
    transactionState,
    transactionSummary,
    isSuccessState,
    isErrorState,
    canSubmit,
    explorerUrl,
    handleAddItem,
    handleInputChange,
    markFieldBlur,
    shouldShowFieldError,
    resetForm
  } = useAddItemModalState({ open, shopId, onListingCreated })
  const errorState =
    transactionState.status === "error" ? transactionState : undefined
  const createSpotlightEnabled = formState.spotlightDiscountMode === "create"

  if (!open) return <></>

  return (
    <ModalFrame onClose={onClose}>
      {isSuccessState && transactionSummary ? (
        <ListingSuccessView
          summary={transactionSummary}
          shopId={shopId}
          explorerUrl={explorerUrl}
          onClose={onClose}
          onReset={resetForm}
        />
      ) : isErrorState ? (
        <ListingErrorView
          error={errorState?.error ?? "Unknown error"}
          details={errorState?.details}
          itemName={formState.itemName || "Listing"}
          onClose={onClose}
          onReset={resetForm}
        />
      ) : (
        <>
          <ModalHeader
            eyebrow="Inventory"
            title="Add Item"
            description="Create a new listing for your storefront."
            onClose={onClose}
            footer={
              shopId ? (
                <CopyableId
                  value={shopId}
                  label="Shop"
                  explorerUrl={explorerUrl}
                />
              ) : undefined
            }
          />

          <ModalBody>
            <ModalSection
              title="Item identity"
              subtitle="Set the listing name and item type metadata."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <label className={modalFieldLabelClassName}>
                  <span className={modalFieldTitleClassName}>Item name</span>
                  <span className={modalFieldDescriptionClassName}>
                    Visible label shown to buyers in the storefront.
                  </span>
                  <input
                    type="text"
                    value={formState.itemName}
                    onChange={(event) =>
                      handleInputChange("itemName", event.target.value)
                    }
                    onBlur={() => markFieldBlur("itemName")}
                    placeholder="e.g. Midnight commuter bike"
                    className={clsx(
                      modalFieldInputClassName,
                      shouldShowFieldError("itemName", fieldErrors.itemName) &&
                        modalFieldInputErrorClassName
                    )}
                  />
                  {shouldShowFieldError("itemName", fieldErrors.itemName) ? (
                    <span className={modalFieldErrorTextClassName}>
                      {fieldErrors.itemName}
                    </span>
                  ) : undefined}
                </label>
                <label className={modalFieldLabelClassName}>
                  <span className={modalFieldTitleClassName}>Item type</span>
                  <span className={modalFieldDescriptionClassName}>
                    Fully qualified Move type minted in the item receipt.
                    Example (works on all Sui networks): 0x2::kiosk::Item.
                  </span>
                  <input
                    type="text"
                    value={formState.itemType}
                    onChange={(event) =>
                      handleInputChange("itemType", event.target.value)
                    }
                    onBlur={() => markFieldBlur("itemType")}
                    placeholder="0x2::kiosk::Item"
                    className={clsx(
                      modalFieldInputClassName,
                      shouldShowFieldError("itemType", fieldErrors.itemType) &&
                        modalFieldInputErrorClassName
                    )}
                  />
                  {shouldShowFieldError("itemType", fieldErrors.itemType) ? (
                    <span className={modalFieldErrorTextClassName}>
                      {fieldErrors.itemType}
                    </span>
                  ) : undefined}
                </label>
              </div>
            </ModalSection>

            <ModalSection
              title="Pricing & inventory"
              subtitle="Define the USD price and initial stock level."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <label className={modalFieldLabelClassName}>
                  <span className={modalFieldTitleClassName}>
                    Base price (USD)
                  </span>
                  <span className={modalFieldDescriptionClassName}>
                    Decimal USD amount that converts to cents on chain.
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={formState.basePrice}
                    onChange={(event) =>
                      handleInputChange("basePrice", event.target.value)
                    }
                    onBlur={() => markFieldBlur("basePrice")}
                    placeholder="19.95"
                    className={clsx(
                      modalFieldInputClassName,
                      shouldShowFieldError(
                        "basePrice",
                        fieldErrors.basePrice
                      ) && modalFieldInputErrorClassName
                    )}
                  />
                  {shouldShowFieldError("basePrice", fieldErrors.basePrice) ? (
                    <span className={modalFieldErrorTextClassName}>
                      {fieldErrors.basePrice}
                    </span>
                  ) : undefined}
                </label>
                <label className={modalFieldLabelClassName}>
                  <span className={modalFieldTitleClassName}>Stock</span>
                  <span className={modalFieldDescriptionClassName}>
                    Initial quantity available for purchase (u64).
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formState.stock}
                    onChange={(event) =>
                      handleInputChange("stock", event.target.value)
                    }
                    onBlur={() => markFieldBlur("stock")}
                    placeholder="25"
                    className={clsx(
                      modalFieldInputClassName,
                      shouldShowFieldError("stock", fieldErrors.stock) &&
                        modalFieldInputErrorClassName
                    )}
                  />
                  {shouldShowFieldError("stock", fieldErrors.stock) ? (
                    <span className={modalFieldErrorTextClassName}>
                      {fieldErrors.stock}
                    </span>
                  ) : undefined}
                </label>
              </div>
            </ModalSection>

            <ModalSection
              title="Spotlight discount (optional)"
              subtitle="Create a listing-scoped discount alongside this listing."
            >
              <label className="flex items-center gap-3 text-sm text-sds-dark dark:text-sds-light">
                <input
                  type="checkbox"
                  checked={createSpotlightEnabled}
                  onChange={(event) =>
                    handleInputChange(
                      "spotlightDiscountMode",
                      event.target.checked ? "create" : "none"
                    )
                  }
                />
                <span>
                  Create a spotlight discount scoped to this listing. It is
                  featured automatically once the listing is created.
                </span>
              </label>

              {createSpotlightEnabled ? (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className={modalFieldLabelClassName}>
                    <span className={modalFieldTitleClassName}>Rule type</span>
                    <span className={modalFieldDescriptionClassName}>
                      Choose a fixed dollar discount or a percent-off promotion.
                    </span>
                    <select
                      value={formState.createSpotlightRuleKind}
                      onChange={(event) =>
                        handleInputChange(
                          "createSpotlightRuleKind",
                          event.target.value as DiscountRuleKindLabel
                        )
                      }
                      className={modalFieldInputClassName}
                    >
                      {discountRuleChoices.map((rule) => (
                        <option key={rule} value={rule}>
                          {rule === "fixed" ? "Fixed amount" : "Percent off"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={modalFieldLabelClassName}>
                    <span className={modalFieldTitleClassName}>Rule value</span>
                    <span className={modalFieldDescriptionClassName}>
                      {formState.createSpotlightRuleKind === "fixed"
                        ? "USD amount to subtract (e.g. 5.25)."
                        : "Percent off (e.g. 12.5)."}
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={formState.createSpotlightValue}
                      onChange={(event) =>
                        handleInputChange(
                          "createSpotlightValue",
                          event.target.value
                        )
                      }
                      onBlur={() => markFieldBlur("createSpotlightValue")}
                      placeholder={
                        formState.createSpotlightRuleKind === "fixed"
                          ? "5.25"
                          : "12.5"
                      }
                      className={clsx(
                        modalFieldInputClassName,
                        shouldShowFieldError(
                          "createSpotlightValue",
                          fieldErrors.createSpotlightValue
                        ) && modalFieldInputErrorClassName
                      )}
                    />
                    {shouldShowFieldError(
                      "createSpotlightValue",
                      fieldErrors.createSpotlightValue
                    ) ? (
                      <span className={modalFieldErrorTextClassName}>
                        {fieldErrors.createSpotlightValue}
                      </span>
                    ) : undefined}
                  </label>
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
                      value={formState.createSpotlightStartsAt}
                      onChange={(event) =>
                        handleInputChange(
                          "createSpotlightStartsAt",
                          event.target.value
                        )
                      }
                      onBlur={() => markFieldBlur("createSpotlightStartsAt")}
                      className={clsx(
                        modalFieldInputClassName,
                        shouldShowFieldError(
                          "createSpotlightStartsAt",
                          fieldErrors.createSpotlightStartsAt
                        ) && modalFieldInputErrorClassName
                      )}
                    />
                    {shouldShowFieldError(
                      "createSpotlightStartsAt",
                      fieldErrors.createSpotlightStartsAt
                    ) ? (
                      <span className={modalFieldErrorTextClassName}>
                        {fieldErrors.createSpotlightStartsAt}
                      </span>
                    ) : undefined}
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
                      value={formState.createSpotlightExpiresAt}
                      onChange={(event) =>
                        handleInputChange(
                          "createSpotlightExpiresAt",
                          event.target.value
                        )
                      }
                      onBlur={() => markFieldBlur("createSpotlightExpiresAt")}
                      className={clsx(
                        modalFieldInputClassName,
                        shouldShowFieldError(
                          "createSpotlightExpiresAt",
                          fieldErrors.createSpotlightExpiresAt
                        ) && modalFieldInputErrorClassName
                      )}
                    />
                    {shouldShowFieldError(
                      "createSpotlightExpiresAt",
                      fieldErrors.createSpotlightExpiresAt
                    ) ? (
                      <span className={modalFieldErrorTextClassName}>
                        {fieldErrors.createSpotlightExpiresAt}
                      </span>
                    ) : undefined}
                  </label>
                  <label
                    className={clsx(modalFieldLabelClassName, "md:col-span-2")}
                  >
                    <span className={modalFieldTitleClassName}>
                      Max redemptions (optional)
                    </span>
                    <span className={modalFieldDescriptionClassName}>
                      Leave blank for unlimited redemptions.
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formState.createSpotlightMaxRedemptions}
                      onChange={(event) =>
                        handleInputChange(
                          "createSpotlightMaxRedemptions",
                          event.target.value
                        )
                      }
                      onBlur={() =>
                        markFieldBlur("createSpotlightMaxRedemptions")
                      }
                      className={clsx(
                        modalFieldInputClassName,
                        shouldShowFieldError(
                          "createSpotlightMaxRedemptions",
                          fieldErrors.createSpotlightMaxRedemptions
                        ) && modalFieldInputErrorClassName
                      )}
                    />
                    {shouldShowFieldError(
                      "createSpotlightMaxRedemptions",
                      fieldErrors.createSpotlightMaxRedemptions
                    ) ? (
                      <span className={modalFieldErrorTextClassName}>
                        {fieldErrors.createSpotlightMaxRedemptions}
                      </span>
                    ) : undefined}
                  </label>
                </div>
              ) : undefined}
            </ModalSection>

            <ModalSection
              title="Review"
              subtitle="Confirm the listing details before submitting."
            >
              <div className="grid gap-3 text-xs sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                  <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                    Name
                  </div>
                  <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                    {formState.itemName || "Enter a name"}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                  <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                    Item type
                  </div>
                  <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                    {itemTypeLabel}
                  </div>
                  {formState.itemType.trim() ? (
                    <div className="mt-2 overflow-auto text-[0.7rem] text-slate-500 dark:text-slate-200/60">
                      {shortenId(formState.itemType, 10, 8)}
                    </div>
                  ) : undefined}
                </div>
                <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                  <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                    Price
                  </div>
                  <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                    {pricePreview}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                  <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                    Stock
                  </div>
                  <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                    {stockPreview}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 sm:col-span-2 dark:border-slate-50/15 dark:bg-slate-950/60">
                  <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                    Spotlight discount
                  </div>
                  <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                    {createSpotlightEnabled
                      ? `Create ${describeRuleKind(
                          parseDiscountRuleKind(
                            formState.createSpotlightRuleKind
                          )
                        )} discount`
                      : "None"}
                  </div>
                </div>
              </div>
            </ModalSection>
          </ModalBody>

          <div className="border-t border-slate-200/70 px-6 py-4 dark:border-slate-50/15">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                {transactionState.status === "processing"
                  ? "Waiting for wallet confirmation..."
                  : "Ready to create the listing."}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={handleAddItem} disabled={!canSubmit}>
                  {transactionState.status === "processing"
                    ? "Processing..."
                    : "Add listing"}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </ModalFrame>
  )
}

export default AddItemModal
