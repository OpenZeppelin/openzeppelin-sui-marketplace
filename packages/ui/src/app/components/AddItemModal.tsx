"use client"

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
          {summary.spotlightDiscountId
            ? shortenId(summary.spotlightDiscountId)
            : "None"}
        </div>
        {summary.spotlightDiscountId ? (
          <div className="mt-2">
            <CopyableId
              value={summary.spotlightDiscountId}
              label="Template"
              explorerUrl={explorerUrl}
            />
          </div>
        ) : null}
      </div>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
      {summary.listingId ? (
        <CopyableId
          value={summary.listingId}
          label="Listing ID"
          explorerUrl={explorerUrl}
        />
      ) : null}
      {shopId ? (
        <CopyableId value={shopId} label="Shop ID" explorerUrl={explorerUrl} />
      ) : null}
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

  if (!open) return null

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
              ) : null
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
                  ) : null}
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
                    placeholder="0x...::items::Bike"
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
                  ) : null}
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
                  ) : null}
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
                  ) : null}
                </label>
                <label
                  className={clsx(modalFieldLabelClassName, "md:col-span-2")}
                >
                  <span className={modalFieldTitleClassName}>
                    Spotlight discount template (optional)
                  </span>
                  <span className={modalFieldDescriptionClassName}>
                    DiscountTemplate object ID to highlight on the listing.
                  </span>
                  <input
                    type="text"
                    value={formState.spotlightDiscountId}
                    onChange={(event) =>
                      handleInputChange(
                        "spotlightDiscountId",
                        event.target.value
                      )
                    }
                    onBlur={() => markFieldBlur("spotlightDiscountId")}
                    placeholder="0x... discount template id"
                    className={clsx(
                      modalFieldInputClassName,
                      shouldShowFieldError(
                        "spotlightDiscountId",
                        fieldErrors.spotlightDiscountId
                      ) && modalFieldInputErrorClassName
                    )}
                  />
                  {shouldShowFieldError(
                    "spotlightDiscountId",
                    fieldErrors.spotlightDiscountId
                  ) ? (
                    <span className={modalFieldErrorTextClassName}>
                      {fieldErrors.spotlightDiscountId}
                    </span>
                  ) : null}
                </label>
              </div>
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
                  ) : null}
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
                    {formState.spotlightDiscountId
                      ? shortenId(formState.spotlightDiscountId)
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
