"use client"

import type { DiscountTemplateSummary } from "@sui-oracle-market/domain-core/models/discount"
import type { ItemListingSummary } from "@sui-oracle-market/domain-core/models/item-listing"
import clsx from "clsx"
import { useCallback, useMemo } from "react"
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

const spotlightTemplateStatusToneClassName: Record<string, string> = {
  active:
    "border-emerald-300 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/50 dark:text-emerald-200",
  scheduled:
    "border-amber-300 bg-amber-500/10 text-amber-700 dark:border-amber-300/50 dark:text-amber-200",
  expired:
    "border-rose-300 bg-rose-500/10 text-rose-700 dark:border-rose-300/50 dark:text-rose-200",
  maxed:
    "border-indigo-300 bg-indigo-500/10 text-indigo-700 dark:border-indigo-300/50 dark:text-indigo-200",
  disabled:
    "border-slate-300 bg-slate-500/5 text-slate-600 dark:border-slate-500/40 dark:text-slate-200/70",
  default:
    "border-slate-300 bg-slate-500/10 text-slate-600 dark:border-slate-500/40 dark:text-slate-200/80"
}

const getSpotlightTemplateStatusTone = (status?: string) =>
  spotlightTemplateStatusToneClassName[status ?? "default"] ??
  spotlightTemplateStatusToneClassName.default

const SpotlightTemplateStatusBadge = ({ status }: { status?: string }) => (
  <span
    className={clsx(
      "rounded-full border px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide",
      getSpotlightTemplateStatusTone(status)
    )}
  >
    {status ?? "unknown"}
  </span>
)

const SpotlightTemplateCard = ({
  template,
  selected,
  onSelect,
  explorerUrl
}: {
  template: DiscountTemplateSummary
  selected: boolean
  onSelect: (templateId: string) => void
  explorerUrl?: string
}) => (
  <div
    className={clsx(
      "rounded-2xl border border-slate-200/80 bg-white/85 p-3 text-left transition dark:border-slate-50/20 dark:bg-slate-900/40",
      selected
        ? "border-sds-primary shadow-sds-primary/10 dark:border-sds-primary shadow-lg"
        : "hover:border-slate-300/80 dark:hover:border-slate-50/30"
    )}
  >
    <button
      type="button"
      onClick={() => onSelect(template.discountTemplateId)}
      className="focus-visible:ring-sds-primary/40 w-full text-left focus-visible:outline-none focus-visible:ring-2"
    >
      <div className="flex items-center justify-between text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
        <span>Template</span>
        <SpotlightTemplateStatusBadge status={template.status} />
      </div>
      <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
        {template.ruleDescription}
      </div>
      <div className="mt-2 text-[0.7rem] text-slate-500 dark:text-slate-200/60">
        {template.appliesToListingId
          ? "Applies to a specific listing."
          : "Reusable across all listings."}
      </div>
    </button>
    <div className="mt-3 border-t border-slate-200/70 pt-3 text-xs dark:border-slate-50/15">
      <div className="mt-2">
        <CopyableId
          value={template.discountTemplateId}
          label="Template"
          explorerUrl={explorerUrl}
        />
      </div>
    </div>
  </div>
)

const SpotlightTemplateSelector = ({
  templates,
  selectedTemplateId,
  onSelectTemplate,
  onClearSelection,
  explorerUrl
}: {
  templates: DiscountTemplateSummary[]
  selectedTemplateId?: string
  onSelectTemplate: (templateId: string) => void
  onClearSelection: () => void
  explorerUrl?: string
}) => {
  if (templates.length === 0)
    return (
      <div className="rounded-xl border border-dashed border-slate-200/70 bg-white/50 p-4 text-sm text-slate-500 dark:border-slate-50/20 dark:bg-slate-950/40 dark:text-slate-200/70">
        No discount templates are available yet. Create one to highlight it on
        this listing.
      </div>
    )

  const noSelection = !selectedTemplateId

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onClearSelection}
        className={clsx(
          "inline-flex items-center rounded-full border px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.18em] transition",
          noSelection
            ? "border-sds-primary bg-sds-primary/10 text-sds-primary"
            : "hover:border-sds-primary/60 border-slate-200/70 text-slate-500 dark:border-slate-50/15 dark:text-slate-200/70"
        )}
      >
        No spotlight discount
      </button>
      <div className="grid gap-3 sm:grid-cols-2">
        {templates.map((template) => (
          <SpotlightTemplateCard
            key={template.discountTemplateId}
            template={template}
            selected={template.discountTemplateId === selectedTemplateId}
            onSelect={onSelectTemplate}
            explorerUrl={explorerUrl}
          />
        ))}
      </div>
    </div>
  )
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
        ) : undefined}
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
  discountTemplates,
  onListingCreated
}: {
  open: boolean
  onClose: () => void
  shopId?: string
  discountTemplates?: DiscountTemplateSummary[]
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
  const availableSpotlightTemplates = useMemo(
    () =>
      (discountTemplates ?? [])
        .slice()
        .sort((templateA, templateB) =>
          templateA.ruleDescription.localeCompare(templateB.ruleDescription)
        ),
    [discountTemplates]
  )
  const selectedSpotlightTemplateId =
    formState.spotlightDiscountId.trim() || undefined
  const handleSpotlightTemplateCardSelect = useCallback(
    (templateId: string) => {
      handleInputChange("spotlightDiscountId", templateId)
    },
    [handleInputChange]
  )
  const clearSpotlightTemplateSelection = useCallback(() => {
    handleInputChange("spotlightDiscountId", "")
  }, [handleInputChange])
  const errorState =
    transactionState.status === "error" ? transactionState : undefined

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
                <div
                  className={clsx(modalFieldLabelClassName, "md:col-span-2")}
                >
                  <div>
                    <span className={modalFieldTitleClassName}>
                      Spotlight discount template (optional)
                    </span>
                    <span className={modalFieldDescriptionClassName}>
                      DiscountTemplate object ID to highlight on the listing.
                    </span>
                  </div>
                  <div className="mt-3">
                    <SpotlightTemplateSelector
                      templates={availableSpotlightTemplates}
                      selectedTemplateId={selectedSpotlightTemplateId}
                      onSelectTemplate={handleSpotlightTemplateCardSelect}
                      onClearSelection={clearSpotlightTemplateSelection}
                      explorerUrl={explorerUrl}
                    />
                  </div>
                  <label className="mt-4 block">
                    <span className={modalFieldDescriptionClassName}>
                      Custom template ID
                    </span>
                    <br />
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
                  </label>
                  {shouldShowFieldError(
                    "spotlightDiscountId",
                    fieldErrors.spotlightDiscountId
                  ) ? (
                    <span className={modalFieldErrorTextClassName}>
                      {fieldErrors.spotlightDiscountId}
                    </span>
                  ) : undefined}
                </div>
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
