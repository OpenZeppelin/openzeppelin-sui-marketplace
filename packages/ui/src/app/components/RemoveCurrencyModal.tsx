"use client"

import type { AcceptedCurrencySummary } from "@sui-oracle-market/domain-core/models/currency"
import { resolveCurrencyRegistryId } from "../helpers/currencyRegistry"
import { getStructLabel, shortenId } from "../helpers/format"
import {
  useRemoveCurrencyModalState,
  type RemoveCurrencyTransactionSummary
} from "../hooks/useRemoveCurrencyModalState"
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

const CurrencySummarySection = ({
  currency,
  shopId,
  explorerUrl
}: {
  currency: AcceptedCurrencySummary
  shopId?: string
  explorerUrl?: string
}) => {
  const registryId = resolveCurrencyRegistryId(currency.coinType)

  return (
    <ModalSection
      title="Currency details"
      subtitle="Accepted currency scheduled for removal"
    >
      <div className="grid gap-3 text-xs sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
          <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
            Coin type
          </div>
          <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
            {getStructLabel(currency.coinType)}
          </div>
          <div className="mt-2 overflow-auto text-[0.7rem] text-slate-500 dark:text-slate-200/60">
            {currency.coinType}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
          <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
            Feed id
          </div>
          <div
            className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light"
            title={currency.feedIdHex}
          >
            {shortenId(currency.feedIdHex, 10, 8)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
          <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
            Decimals
          </div>
          <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
            {currency.decimals ?? "--"}
          </div>
        </div>
        {currency.pythObjectId ? (
          <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
            <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
              Pyth object
            </div>
            <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
              {shortenId(currency.pythObjectId)}
            </div>
          </div>
        ) : undefined}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
        <CopyableId
          value={currency.tableEntryFieldId}
          label="Table Entry"
          explorerUrl={explorerUrl}
        />
        {registryId ? (
          <CopyableId
            value={registryId}
            label="Registry"
            explorerUrl={explorerUrl}
          />
        ) : undefined}
        {shopId ? (
          <CopyableId
            value={shopId}
            label="Shop ID"
            explorerUrl={explorerUrl}
          />
        ) : undefined}
      </div>
    </ModalSection>
  )
}

const RemovalImpactSection = () => (
  <ModalSection
    title="Removal impact"
    subtitle="What changes after the currency is removed"
  >
    <div className="text-xs text-slate-500 dark:text-slate-200/70">
      Removing a currency disables it for checkout. Buyers will no longer be
      able to pay with this coin type.
    </div>
  </ModalSection>
)

const CurrencySuccessView = ({
  summary,
  shopId,
  explorerUrl,
  onClose
}: {
  summary: RemoveCurrencyTransactionSummary
  shopId?: string
  explorerUrl?: string
  onClose: () => void
}) => (
  <>
    <ModalStatusHeader
      status="success"
      title="Currency removed"
      subtitle={getStructLabel(summary.currency.coinType)}
      description="The currency has been removed from the shop."
      onClose={onClose}
    />
    <ModalBody>
      <CurrencySummarySection
        currency={summary.currency}
        shopId={shopId}
        explorerUrl={explorerUrl}
      />
      <TransactionRecap
        transactionBlock={summary.transactionBlock}
        digest={summary.digest}
        explorerUrl={explorerUrl}
      />
    </ModalBody>
    <ModalCloseFooter message="Currency removal confirmed." onClose={onClose} />
  </>
)

const CurrencyErrorView = ({
  error,
  details,
  currencyLabel,
  onClose,
  onReset
}: {
  error: string
  details?: string
  currencyLabel: string
  onClose: () => void
  onReset: () => void
}) => (
  <>
    <ModalStatusHeader
      status="error"
      title="Removal failed"
      subtitle={currencyLabel}
      description="Review the error details and try again."
      onClose={onClose}
    />
    <ModalBody>
      <ModalErrorNotice error={error} details={details} />
    </ModalBody>
    <ModalErrorFooter onRetry={onReset} onClose={onClose} />
  </>
)

const RemoveCurrencyModal = ({
  open,
  onClose,
  shopId,
  currency,
  onCurrencyRemoved
}: {
  open: boolean
  onClose: () => void
  shopId?: string
  currency?: AcceptedCurrencySummary
  onCurrencyRemoved?: (tableEntryFieldId?: string) => void
}) => {
  const {
    transactionState,
    transactionSummary,
    isSuccessState,
    isErrorState,
    canSubmit,
    explorerUrl,
    handleRemoveCurrency,
    resetState
  } = useRemoveCurrencyModalState({
    open,
    shopId,
    currency,
    onCurrencyRemoved
  })
  const errorState =
    transactionState.status === "error" ? transactionState : undefined

  if (!open || !currency) return <></>

  return (
    <ModalFrame onClose={onClose}>
      {isSuccessState && transactionSummary ? (
        <CurrencySuccessView
          summary={transactionSummary}
          shopId={shopId}
          explorerUrl={explorerUrl}
          onClose={onClose}
        />
      ) : isErrorState ? (
        <CurrencyErrorView
          error={errorState?.error ?? "Unknown error"}
          details={errorState?.details}
          currencyLabel={getStructLabel(currency.coinType)}
          onClose={onClose}
          onReset={resetState}
        />
      ) : (
        <>
          <ModalHeader
            eyebrow="Registry"
            title="Remove Currency"
            description="Deregister this currency from the shop."
            onClose={onClose}
            footer={
              <CopyableId
                value={currency.tableEntryFieldId}
                label="Table Entry"
                explorerUrl={explorerUrl}
              />
            }
          />
          <ModalBody>
            <CurrencySummarySection
              currency={currency}
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
                  : "Ready to remove the currency."}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={handleRemoveCurrency}
                  disabled={!canSubmit}
                >
                  {transactionState.status === "processing"
                    ? "Processing..."
                    : "Remove currency"}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </ModalFrame>
  )
}

export default RemoveCurrencyModal
