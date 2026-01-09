"use client"

import type { SuiTransactionBlockResponse } from "@mysten/sui/client"
import type { AcceptedCurrencySummary } from "@sui-oracle-market/domain-core/models/currency"
import type {
  DiscountTemplateSummary,
  DiscountTicketDetails
} from "@sui-oracle-market/domain-core/models/discount"
import type { ItemListingSummary } from "@sui-oracle-market/domain-core/models/item-listing"
import { mapOwnerToLabel } from "@sui-oracle-market/tooling-core/object-info"
import { summarizeGasUsed } from "@sui-oracle-market/tooling-core/transactions"
import clsx from "clsx"
import { parseBalance } from "../helpers/balance"
import {
  formatCoinBalance,
  formatUsdFromCents,
  getStructLabel,
  shortenId
} from "../helpers/format"
import {
  extractCreatedObjects,
  formatTimestamp,
  summarizeObjectChanges
} from "../helpers/transactionFormat"
import {
  useBuyFlowModalState,
  type TransactionSummary
} from "../hooks/useBuyFlowModalState"
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

const getCurrencyLabel = (currency: AcceptedCurrencySummary) =>
  currency.symbol || getStructLabel(currency.coinType)

const getListingLabel = (listing?: ItemListingSummary) =>
  listing?.name || getStructLabel(listing?.itemType)

const extractReceiptIds = (transactionBlock: SuiTransactionBlockResponse) =>
  extractCreatedObjects(transactionBlock)
    .filter((change) => change.objectType.includes("::shop::ShopItem"))
    .map((change) => change.objectId)

const TransactionRecap = ({
  summary,
  explorerUrl
}: {
  summary: TransactionSummary
  explorerUrl?: string
}) => {
  const { transactionBlock, digest, selectedCurrency } = summary
  const status = transactionBlock.effects?.status?.status ?? "unknown"
  const error = transactionBlock.effects?.status?.error
  const gasSummary = summarizeGasUsed(transactionBlock.effects?.gasUsed)
  const receipts = extractReceiptIds(transactionBlock)
  const objectChanges = transactionBlock.objectChanges ?? []
  const objectChangeSummary = summarizeObjectChanges(objectChanges)
  const eventTypes = transactionBlock.events?.map((event) => event.type) ?? []
  const balanceChanges = transactionBlock.balanceChanges ?? []

  const explorerLink =
    explorerUrl && digest ? `${explorerUrl}/txblock/${digest}` : undefined

  return (
    <ModalSection
      title="Transaction Recap"
      subtitle="On-chain checkout receipt"
    >
      <div className="space-y-4 text-xs text-slate-600 dark:text-slate-200/70">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
            <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
              Status
            </div>
            <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
              {status}
            </div>
            {error ? (
              <div className="mt-2 break-all text-xs text-rose-500">
                {error}
              </div>
            ) : undefined}
          </div>
          <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
            <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
              Timestamp
            </div>
            <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
              {formatTimestamp(transactionBlock.timestampMs || undefined)}
            </div>
            {transactionBlock.checkpoint ? (
              <div className="mt-1 text-[0.65rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                Checkpoint {transactionBlock.checkpoint}
              </div>
            ) : undefined}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
            Digest
          </span>
          <CopyableId value={digest} showExplorer={false} />
          {explorerLink ? (
            <a
              href={explorerLink}
              target="_blank"
              rel="noreferrer"
              className="dark:text-sds-blue/80 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-sds-blue hover:text-sds-dark dark:hover:text-sds-light"
            >
              View on explorer
            </a>
          ) : undefined}
        </div>

        {gasSummary ? (
          <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
            <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
              Gas breakdown
            </div>
            <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
              <div>
                <div className="text-[0.55rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                  Computation
                </div>
                <div>{gasSummary.computation.toString()}</div>
              </div>
              <div>
                <div className="text-[0.55rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                  Storage
                </div>
                <div>{gasSummary.storage.toString()}</div>
              </div>
              <div>
                <div className="text-[0.55rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                  Rebate
                </div>
                <div>{gasSummary.rebate.toString()}</div>
              </div>
            </div>
            <div className="mt-2 text-sm font-semibold text-sds-dark dark:text-sds-light">
              Total gas: {gasSummary.total.toString()}
            </div>
          </div>
        ) : undefined}

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
            <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
              Receipts
            </div>
            {receipts.length > 0 ? (
              <div className="mt-2 flex flex-col gap-2">
                {receipts.map((receiptId) => (
                  <CopyableId
                    key={receiptId}
                    value={receiptId}
                    label="ShopItem"
                    explorerUrl={explorerUrl}
                  />
                ))}
              </div>
            ) : (
              <div className="mt-2 text-xs text-slate-500 dark:text-slate-200/60">
                No ShopItem receipts detected in created objects.
              </div>
            )}
          </div>
          <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
            <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
              Object changes
            </div>
            <div className="mt-2 text-sm font-semibold text-sds-dark dark:text-sds-light">
              {objectChanges.length} total changes
            </div>
            {objectChanges.length > 0 ? (
              <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                {objectChangeSummary
                  .filter((item) => item.count > 0)
                  .map((item) => {
                    const typeLabels = item.types
                      .slice(0, 3)
                      .map((type) =>
                        type.count > 1
                          ? `${type.label} x${type.count}`
                          : type.label
                      )
                      .join(", ")

                    return (
                      <div key={item.label}>
                        <div className="text-[0.55rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                          {item.label}
                        </div>
                        <div>{item.count}</div>
                        {typeLabels ? (
                          <div className="mt-1 text-[0.6rem] text-slate-500 dark:text-slate-200/60">
                            {typeLabels}
                            {item.types.length > 3
                              ? ` +${item.types.length - 3} more`
                              : ""}
                          </div>
                        ) : undefined}
                      </div>
                    )
                  })}
              </div>
            ) : (
              <div className="mt-2 text-xs text-slate-500 dark:text-slate-200/60">
                No object changes detected.
              </div>
            )}
            {eventTypes.length > 0 ? (
              <div className="mt-3">
                <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                  Events
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-[0.65rem]">
                  {eventTypes.slice(0, 6).map((eventType) => (
                    <span
                      key={eventType}
                      className="rounded-full border border-slate-200/70 px-2 py-1 text-slate-500 dark:border-slate-50/15 dark:text-slate-200/60"
                    >
                      {eventType.split("::").slice(-1)[0]}
                    </span>
                  ))}
                  {eventTypes.length > 6 ? (
                    <span className="text-slate-500 dark:text-slate-200/60">
                      +{eventTypes.length - 6} more
                    </span>
                  ) : undefined}
                </div>
              </div>
            ) : undefined}
          </div>
        </div>

        {balanceChanges.length > 0 ? (
          <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
            <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
              Balance changes
            </div>
            <div className="mt-2 space-y-2">
              {balanceChanges.slice(0, 6).map((change, index) => {
                const amount = parseBalance(change.amount)
                const sign = amount >= 0n ? "+" : "-"
                const magnitude = amount >= 0n ? amount : -amount
                const formattedAmount =
                  change.coinType === selectedCurrency.coinType &&
                  selectedCurrency.decimals !== undefined
                    ? formatCoinBalance({
                        balance: magnitude,
                        decimals: selectedCurrency.decimals
                      })
                    : magnitude.toString()

                return (
                  <div
                    key={`${change.coinType}-${index}`}
                    className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-200/60"
                  >
                    <span>
                      {sign}
                      {formattedAmount} {getStructLabel(change.coinType)}
                    </span>
                    <span className="text-[0.65rem] uppercase tracking-[0.18em]">
                      {mapOwnerToLabel(change.owner) ?? "Unknown"}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        ) : undefined}
      </div>
    </ModalSection>
  )
}

const TransactionSuccessView = ({
  summary,
  listingLabel,
  explorerUrl,
  onClose,
  onReset
}: {
  summary: TransactionSummary
  listingLabel: string
  explorerUrl?: string
  onClose: () => void
  onReset: () => void
}) => (
  <>
    <ModalStatusHeader
      status="success"
      title="Transaction executed"
      subtitle={listingLabel}
      description="Receipt and balance updates are ready below."
      onClose={onClose}
    />
    <ModalBody>
      <TransactionRecap summary={summary} explorerUrl={explorerUrl} />
    </ModalBody>
    <ModalSuccessFooter
      actionLabel="Buy another"
      onAction={onReset}
      onClose={onClose}
    />
  </>
)

const TransactionErrorView = ({
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
      title="Transaction failed"
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

/**
 * Checkout flow for Sui.
 * Builds a TransactionBlock with explicit object inputs (shared shop/listing/currency
 * objects plus a coin object used for payment). This is the big mental shift for
 * EVM devs: coins are objects, and writes happen to specific shared objects rather
 * than a single contract address. We sign + execute, then pull the transaction
 * block details (object changes, events, balance changes) for the receipt UI.
 */
const BuyFlowModal = ({
  open,
  onClose,
  onPurchaseSuccess,
  shopId,
  listing,
  acceptedCurrencies,
  discountTemplates,
  discountTickets
}: {
  open: boolean
  onClose: () => void
  onPurchaseSuccess?: () => void
  shopId?: string
  listing?: ItemListingSummary
  acceptedCurrencies: AcceptedCurrencySummary[]
  discountTemplates: DiscountTemplateSummary[]
  discountTickets: DiscountTicketDetails[]
}) => {
  const {
    explorerUrl,
    walletAddress,
    balanceStatus,
    availableCurrencies,
    discountOptions,
    hasDiscountOptions,
    selectedCurrencyId,
    selectedDiscountId,
    selectedCurrency,
    selectedDiscount,
    mintTo,
    refundTo,
    fieldErrors,
    transactionState,
    transactionSummary,
    isSuccessState,
    isErrorState,
    canSubmit,
    oracleWarning,
    oracleQuote,
    handlePurchase,
    resetTransactionState,
    setSelectedCurrencyId,
    setSelectedDiscountId,
    setMintTo,
    setRefundTo,
    markFieldChange,
    markFieldBlur,
    shouldShowFieldError
  } = useBuyFlowModalState({
    open,
    onClose,
    onPurchaseSuccess,
    shopId,
    listing,
    acceptedCurrencies,
    discountTemplates,
    discountTickets
  })
  const errorState =
    transactionState.status === "error" ? transactionState : undefined

  if (!open) return <></>

  const listingLabel = getListingLabel(listing)

  return (
    <ModalFrame onClose={onClose}>
      {isSuccessState && transactionSummary ? (
        <TransactionSuccessView
          summary={transactionSummary}
          listingLabel={listingLabel}
          explorerUrl={explorerUrl}
          onClose={onClose}
          onReset={resetTransactionState}
        />
      ) : isErrorState ? (
        <TransactionErrorView
          error={errorState?.error ?? "Unknown error"}
          details={errorState?.details}
          listingLabel={listingLabel}
          onClose={onClose}
          onReset={resetTransactionState}
        />
      ) : (
        <>
          <ModalHeader
            eyebrow="Buy Flow"
            title={listingLabel}
            description={
              <>
                <span>
                  Base price: {formatUsdFromCents(listing?.basePriceUsdCents)}
                </span>
                <span>Stock: {listing?.stock ?? "Unknown"}</span>
              </>
            }
            descriptionClassName="flex flex-wrap items-center gap-3"
            onClose={onClose}
            footer={
              listing ? (
                <CopyableId
                  value={listing.itemListingId}
                  label="Listing"
                  explorerUrl={explorerUrl}
                />
              ) : undefined
            }
          />

          <ModalBody>
            <ModalSection
              title="Payment currency"
              subtitle="Select from accepted coins you hold in your wallet."
            >
              {balanceStatus.status === "loading" ? (
                <div className="text-xs text-slate-500 dark:text-slate-200/60">
                  Loading wallet balances...
                </div>
              ) : balanceStatus.status === "error" ? (
                <div className="rounded-xl border border-rose-200/70 bg-rose-50/60 p-3 text-xs text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10">
                  {balanceStatus.error}
                </div>
              ) : availableCurrencies.length === 0 ? (
                <div className="text-xs text-slate-500 dark:text-slate-200/60">
                  No accepted currencies with a wallet balance detected.
                </div>
              ) : (
                <div className="space-y-3">
                  <label className={modalFieldLabelClassName}>
                    <span className={modalFieldTitleClassName}>Currency</span>
                    <span className={modalFieldDescriptionClassName}>
                      Choose which accepted coin to spend for checkout.
                    </span>
                    <select
                      value={selectedCurrencyId ?? ""}
                      onChange={(event) => {
                        markFieldChange("currency")
                        setSelectedCurrencyId(event.target.value)
                      }}
                      onBlur={() => markFieldBlur("currency")}
                      className={clsx(
                        modalFieldInputClassName,
                        shouldShowFieldError(
                          "currency",
                          fieldErrors.currency
                        ) && modalFieldInputErrorClassName
                      )}
                    >
                      {availableCurrencies.map((currency) => (
                        <option
                          key={currency.acceptedCurrencyId}
                          value={currency.acceptedCurrencyId}
                        >
                          {getCurrencyLabel(currency)}
                        </option>
                      ))}
                    </select>
                    {shouldShowFieldError("currency", fieldErrors.currency) ? (
                      <span className={modalFieldErrorTextClassName}>
                        {fieldErrors.currency}
                      </span>
                    ) : undefined}
                  </label>

                  {selectedCurrency ? (
                    <div className="grid gap-3 text-xs sm:grid-cols-2">
                      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                        <div className="grid gap-3 sm:grid-cols-2 sm:gap-0">
                          <div className="sm:pr-3">
                            <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                              Oracle quote
                            </div>
                            <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                              {oracleQuote.status === "loading"
                                ? "Fetching quote..."
                                : oracleQuote.status === "success"
                                  ? `${formatCoinBalance({
                                      balance: oracleQuote.amount,
                                      decimals: selectedCurrency.decimals ?? 9
                                    })} ${getCurrencyLabel(selectedCurrency)}`
                                  : oracleQuote.status === "error"
                                    ? "Quote unavailable"
                                    : "Waiting for quote..."}
                            </div>
                            {oracleQuote.status === "success" ? (
                              <div className="mt-1 text-[0.65rem] text-slate-500 dark:text-slate-200/60">
                                {getStructLabel(selectedCurrency.coinType)}
                              </div>
                            ) : oracleQuote.status === "error" ? (
                              <div className="mt-1 text-[0.65rem] text-rose-500">
                                {oracleQuote.error}
                              </div>
                            ) : undefined}
                          </div>
                          <div className="sm:pl-3">
                            <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                              Wallet balance
                            </div>
                            <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                              {formatCoinBalance({
                                balance: selectedCurrency.balance,
                                decimals: selectedCurrency.decimals ?? 9
                              })}{" "}
                              {getCurrencyLabel(selectedCurrency)}
                            </div>
                            <div className="mt-1 text-[0.65rem] text-slate-500 dark:text-slate-200/60">
                              {getStructLabel(selectedCurrency.coinType)}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                          Oracle guardrails
                        </div>
                        <div className="mt-2 text-[0.7rem] text-slate-600 dark:text-slate-200/70">
                          Max age:{" "}
                          {selectedCurrency.maxPriceAgeSecsCap ?? "Default"} sec
                        </div>
                        <div className="mt-1 text-[0.7rem] text-slate-600 dark:text-slate-200/70">
                          Max confidence:{" "}
                          {selectedCurrency.maxConfidenceRatioBpsCap ??
                            "Default"}{" "}
                          bps
                        </div>
                      </div>
                    </div>
                  ) : undefined}
                </div>
              )}
            </ModalSection>

            {hasDiscountOptions ? (
              <ModalSection
                title="Discounts"
                subtitle="Apply a ticket or claim a spotlighted discount when available."
              >
                <div className="space-y-3">
                  {discountOptions.map((option) => {
                    const isSelected = option.id === selectedDiscountId
                    return (
                      <label
                        key={option.id}
                        className={clsx(
                          "flex cursor-pointer flex-col gap-0 rounded-xl border px-3 py-3 text-xs transition",
                          isSelected
                            ? "border-sds-blue/60 bg-sds-blue/10"
                            : "border-slate-200/70 bg-white/80 hover:border-slate-300",
                          option.disabled
                            ? "cursor-not-allowed opacity-50"
                            : "",
                          "dark:border-slate-50/15 dark:bg-slate-950/60 dark:hover:border-slate-50/30"
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-sm font-semibold text-sds-dark dark:text-sds-light">
                            <input
                              type="radio"
                              name="discount-option"
                              value={option.id}
                              checked={isSelected}
                              onChange={() => setSelectedDiscountId(option.id)}
                              disabled={option.disabled}
                              className="h-4 w-4 accent-sds-blue"
                            />
                            <span>{option.label}</span>
                          </div>
                          {option.status ? (
                            <span className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                              {option.status}
                            </span>
                          ) : undefined}
                        </div>
                        {option.description ? (
                          <p className="text-[0.7rem] text-slate-500 dark:text-slate-200/60">
                            {option.description}
                          </p>
                        ) : undefined}
                      </label>
                    )
                  })}
                </div>
              </ModalSection>
            ) : undefined}

            <ModalSection
              title="Delivery details"
              subtitle="Receipt minting and refund destinations."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <label className={modalFieldLabelClassName}>
                  <span className={modalFieldTitleClassName}>
                    Receipt recipient
                  </span>
                  <span className={modalFieldDescriptionClassName}>
                    Receives the on-chain ShopItem object minted after purchase.
                  </span>
                  <input
                    type="text"
                    value={mintTo}
                    onChange={(event) => setMintTo(event.target.value)}
                    onBlur={() => markFieldBlur("mintTo")}
                    placeholder={walletAddress || "Wallet address"}
                    className={clsx(
                      modalFieldInputClassName,
                      shouldShowFieldError("mintTo", fieldErrors.mintTo) &&
                        modalFieldInputErrorClassName
                    )}
                  />
                  {shouldShowFieldError("mintTo", fieldErrors.mintTo) ? (
                    <span className={modalFieldErrorTextClassName}>
                      {fieldErrors.mintTo}
                    </span>
                  ) : undefined}
                </label>
                <label className={modalFieldLabelClassName}>
                  <span className={modalFieldTitleClassName}>
                    Refund address
                  </span>
                  <span className={modalFieldDescriptionClassName}>
                    Receives any unused payment coins after final pricing.
                  </span>
                  <input
                    type="text"
                    value={refundTo}
                    onChange={(event) => setRefundTo(event.target.value)}
                    onBlur={() => markFieldBlur("refundTo")}
                    placeholder={walletAddress || "Wallet address"}
                    className={clsx(
                      modalFieldInputClassName,
                      shouldShowFieldError("refundTo", fieldErrors.refundTo) &&
                        modalFieldInputErrorClassName
                    )}
                  />
                  {shouldShowFieldError("refundTo", fieldErrors.refundTo) ? (
                    <span className={modalFieldErrorTextClassName}>
                      {fieldErrors.refundTo}
                    </span>
                  ) : undefined}
                </label>
              </div>
              <div className="mt-3 text-[0.7rem] text-slate-500 dark:text-slate-200/60">
                Leave empty to default both to your connected wallet.
              </div>
            </ModalSection>

            <ModalSection
              title="Review"
              subtitle="Double-check the checkout inputs before submitting."
            >
              <div className="grid gap-3 text-xs sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                  <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                    Listing
                  </div>
                  <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                    {listingLabel}
                  </div>
                  {listing?.itemListingId ? (
                    <div className="mt-2 overflow-auto text-[0.7rem] text-slate-500 dark:text-slate-200/60">
                      {shortenId(listing.itemListingId)}
                    </div>
                  ) : undefined}
                </div>
                <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                  <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                    Payment currency
                  </div>
                  <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                    {selectedCurrency
                      ? getCurrencyLabel(selectedCurrency)
                      : "Select currency"}
                  </div>
                  {selectedCurrency ? (
                    <div className="mt-2 overflow-auto text-[0.7rem] text-slate-500 dark:text-slate-200/60">
                      {getStructLabel(selectedCurrency.coinType)}
                    </div>
                  ) : undefined}
                </div>
                <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                  <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                    Discount
                  </div>
                  <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                    {selectedDiscount?.label ?? "None"}
                  </div>
                  {selectedDiscount?.description ? (
                    <div className="mt-2 overflow-auto text-[0.7rem] text-slate-500 dark:text-slate-200/60">
                      {selectedDiscount.description}
                    </div>
                  ) : undefined}
                </div>
                <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                  <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                    Recipient
                  </div>
                  <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                    {shortenId(mintTo || walletAddress || "Unknown")}
                  </div>
                  <div className="mt-2 overflow-auto text-[0.7rem] text-slate-500 dark:text-slate-200/60">
                    Refund: {shortenId(refundTo || walletAddress || "Unknown")}
                  </div>
                </div>
              </div>
            </ModalSection>

            {oracleWarning ? (
              <div className="rounded-xl border border-amber-200/70 bg-amber-50/70 px-4 py-3 text-xs text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
                {oracleWarning}
              </div>
            ) : undefined}
          </ModalBody>

          <div className="border-t border-slate-200/70 px-6 py-4 dark:border-slate-50/15">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                {transactionState.status === "processing"
                  ? "Waiting for wallet confirmation..."
                  : "Ready when you are."}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={handlePurchase} disabled={!canSubmit}>
                  {transactionState.status === "processing"
                    ? "Processing..."
                    : "Confirm purchase"}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </ModalFrame>
  )
}

export default BuyFlowModal
