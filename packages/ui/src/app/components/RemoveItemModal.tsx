"use client"

import type { ItemListingSummary } from "@sui-oracle-market/domain-core/models/item-listing"
import { formatUsdFromCents, getStructLabel } from "../helpers/format"
import {
  useRemoveItemModalState,
  type RemoveListingTransactionSummary
} from "../hooks/useRemoveItemModalState"
import Button from "./Button"
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
import TransactionRecap from "./TransactionRecap"

const ListingSummarySection = ({
  listing,
  shopId,
  explorerUrl
}: {
  listing: ItemListingSummary
  shopId?: string
  explorerUrl?: string
}) => (
  <ModalSection
    title="Listing details"
    subtitle="Inventory record scheduled for removal"
  >
    <div className="grid gap-3 text-xs sm:grid-cols-2">
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Listing
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {listing.name || getStructLabel(listing.itemType)}
        </div>
        <div className="mt-2 overflow-auto text-[0.7rem] text-slate-500 dark:text-slate-200/60">
          {listing.itemType}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Base price
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {formatUsdFromCents(listing.basePriceUsdCents)}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Stock
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {listing.stock ?? "Unknown"}
        </div>
      </div>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
      <CopyableId
        value={listing.itemListingId}
        label="Listing ID"
        showExplorer={false}
      />
      {shopId ? (
        <CopyableId value={shopId} label="Shop ID" explorerUrl={explorerUrl} />
      ) : undefined}
    </div>
  </ModalSection>
)

const RemovalImpactSection = () => (
  <ModalSection
    title="Removal impact"
    subtitle="What changes after the listing is removed"
  >
    <div className="text-xs text-slate-500 dark:text-slate-200/70">
      Removing a listing delists it from the shop registry. Buyers will no
      longer see it in the storefront or be able to purchase it.
    </div>
  </ModalSection>
)

const ListingSuccessView = ({
  summary,
  shopId,
  explorerUrl,
  onClose
}: {
  summary: RemoveListingTransactionSummary
  shopId?: string
  explorerUrl?: string
  onClose: () => void
}) => (
  <>
    <ModalStatusHeader
      status="success"
      title="Listing removed"
      subtitle={
        summary.listing.name || getStructLabel(summary.listing.itemType)
      }
      description="The listing has been delisted on chain."
      onClose={onClose}
    />
    <ModalBody>
      <ListingSummarySection
        listing={summary.listing}
        shopId={shopId}
        explorerUrl={explorerUrl}
      />
      <TransactionRecap
        transactionBlock={summary.transactionBlock}
        digest={summary.digest}
        explorerUrl={explorerUrl}
      />
    </ModalBody>
    <ModalCloseFooter message="Listing removal confirmed." onClose={onClose} />
  </>
)

const ListingErrorView = ({
  error,
  details,
  listingLabel,
  onClose,
  onReset
}: {
  error: string
  details?: string
  listingLabel: string
  onClose: () => void
  onReset: () => void
}) => (
  <>
    <ModalStatusHeader
      status="error"
      title="Removal failed"
      subtitle={listingLabel}
      description="Review the error details and try again."
      onClose={onClose}
    />
    <ModalBody>
      <ModalErrorNotice error={error} details={details} />
    </ModalBody>
    <ModalErrorFooter onRetry={onReset} onClose={onClose} />
  </>
)

const RemoveItemModal = ({
  open,
  onClose,
  shopId,
  listing,
  onListingRemoved
}: {
  open: boolean
  onClose: () => void
  shopId?: string
  listing?: ItemListingSummary
  onListingRemoved?: (listingId?: string) => void
}) => {
  const {
    transactionState,
    transactionSummary,
    isSuccessState,
    isErrorState,
    canSubmit,
    explorerUrl,
    handleRemoveListing,
    resetState
  } = useRemoveItemModalState({
    open,
    shopId,
    listing,
    onListingRemoved
  })
  const errorState =
    transactionState.status === "error" ? transactionState : undefined

  if (!open || !listing) return <></>

  return (
    <ModalFrame onClose={onClose}>
      {isSuccessState && transactionSummary ? (
        <ListingSuccessView
          summary={transactionSummary}
          shopId={shopId}
          explorerUrl={explorerUrl}
          onClose={onClose}
        />
      ) : isErrorState ? (
        <ListingErrorView
          error={errorState?.error ?? "Unknown error"}
          details={errorState?.details}
          listingLabel={listing.name || getStructLabel(listing.itemType)}
          onClose={onClose}
          onReset={resetState}
        />
      ) : (
        <>
          <ModalHeader
            eyebrow="Inventory"
            title="Remove Item"
            description="Delist this item from the storefront."
            onClose={onClose}
            footer={
              <CopyableId
                value={listing.itemListingId}
                label="Listing ID"
                showExplorer={false}
              />
            }
          />
          <ModalBody>
            <ListingSummarySection
              listing={listing}
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
                  : "Ready to remove the listing."}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={handleRemoveListing}
                  disabled={!canSubmit}
                >
                  {transactionState.status === "processing"
                    ? "Processing..."
                    : "Remove listing"}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </ModalFrame>
  )
}

export default RemoveItemModal
