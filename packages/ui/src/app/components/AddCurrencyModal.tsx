"use client"

import clsx from "clsx"
import type { AcceptedCurrencySummary } from "@sui-oracle-market/domain-core/models/currency"
import { resolveCurrencyRegistryId } from "../helpers/currencyRegistry"
import { getStructLabel, shortenId } from "../helpers/format"
import {
  useAddCurrencyModalState,
  type CurrencyTransactionSummary
} from "../hooks/useAddCurrencyModalState"
import CopyableId from "./CopyableId"
import TransactionRecap from "./TransactionRecap"
import {
  ModalBody,
  ModalErrorFooter,
  ModalErrorNotice,
  ModalFrame,
  ModalHeader,
  ModalSection,
  ModalStatusHeader,
  ModalSuccessFooter,
  modalFieldErrorTextClassName,
  modalFieldInputErrorClassName,
  modalFieldWarningTextClassName,
  modalFieldDescriptionClassName,
  modalFieldInputClassName,
  modalFieldLabelClassName,
  modalFieldTitleClassName
} from "./ModalPrimitives"
import Button from "./Button"

const formatGuardrailCap = (value?: bigint) =>
  value ? value.toString() : "Default"

const CurrencySummarySection = ({
  summary,
  shopId
}: {
  summary: CurrencyTransactionSummary
  shopId?: string
}) => (
  <ModalSection
    title="Currency details"
    subtitle="Oracle wiring, registry lookup, and guardrails"
  >
    <div className="grid gap-3 text-xs sm:grid-cols-2">
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Coin type
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {getStructLabel(summary.coinType)}
        </div>
        <div className="mt-2 text-[0.7rem] text-slate-500 dark:text-slate-200/60">
          {summary.coinType}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Currency registry
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {shortenId(summary.currencyObjectId)}
        </div>
        <div className="mt-2 text-[0.7rem] text-slate-500 dark:text-slate-200/60">
          {summary.currencyObjectId}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Pyth feed id
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {shortenId(summary.feedIdHex, 10, 8)}
        </div>
        <div className="mt-2 text-[0.7rem] text-slate-500 dark:text-slate-200/60">
          {summary.feedIdHex}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Price info object
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {shortenId(summary.priceInfoObjectId)}
        </div>
        <div className="mt-2 text-[0.7rem] text-slate-500 dark:text-slate-200/60">
          {summary.priceInfoObjectId}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Max price age (secs)
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {formatGuardrailCap(summary.maxPriceAgeSecsCap)}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Max confidence (bps)
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {formatGuardrailCap(summary.maxConfidenceRatioBpsCap)}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          Max status lag (secs)
        </div>
        <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
          {formatGuardrailCap(summary.maxPriceStatusLagSecsCap)}
        </div>
      </div>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
      {summary.acceptedCurrencyId ? (
        <CopyableId value={summary.acceptedCurrencyId} label="Accepted ID" />
      ) : null}
      {shopId ? <CopyableId value={shopId} label="Shop ID" /> : null}
    </div>
  </ModalSection>
)

const CurrencySuccessView = ({
  summary,
  shopId,
  explorerUrl,
  onClose,
  onReset
}: {
  summary: CurrencyTransactionSummary
  shopId?: string
  explorerUrl?: string
  onClose: () => void
  onReset: () => void
}) => (
  <>
    <ModalStatusHeader
      status="success"
      title="Currency added"
      subtitle={getStructLabel(summary.coinType)}
      description="The currency is now accepted by the shop."
      onClose={onClose}
    />
    <ModalBody>
      <CurrencySummarySection summary={summary} shopId={shopId} />
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
      title="Currency failed"
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

const AvailableFeedsSection = ({
  acceptedCurrencies
}: {
  acceptedCurrencies: AcceptedCurrencySummary[]
}) => (
  <ModalSection
    title="Available price feeds"
    subtitle="Existing currencies already wired to the shop"
  >
    {acceptedCurrencies.length === 0 ? (
      <div className="text-xs text-slate-500 dark:text-slate-200/60">
        No accepted currencies registered yet.
      </div>
    ) : (
      <div className="space-y-3">
        {acceptedCurrencies.map((currency) => {
          const registryId = resolveCurrencyRegistryId(currency.coinType)
          return (
            <div
              key={currency.acceptedCurrencyId}
              className="rounded-xl border border-slate-200/70 bg-white/85 px-4 py-3 text-xs shadow-[0_12px_28px_-24px_rgba(15,23,42,0.3)] dark:border-slate-50/20 dark:bg-slate-950/60"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-sds-dark dark:text-sds-light">
                    {currency.symbol || getStructLabel(currency.coinType)}
                  </div>
                  <div className="mt-1 text-[0.65rem] text-slate-500 dark:text-slate-200/60">
                    {currency.coinType}
                  </div>
                </div>
                <span className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                  {currency.decimals ?? "--"} decimals
                </span>
              </div>
              <div className="mt-3 grid gap-3 text-[0.65rem] text-slate-500 sm:grid-cols-2 dark:text-slate-200/70">
                <div>
                  <div className="text-[0.55rem] uppercase tracking-[0.18em]">
                    Feed id
                  </div>
                  <div
                    className="mt-1 font-semibold text-sds-dark dark:text-sds-light"
                    title={currency.feedIdHex}
                  >
                    {shortenId(currency.feedIdHex, 10, 8)}
                  </div>
                </div>
                {currency.pythObjectId ? (
                  <div>
                    <div className="text-[0.55rem] uppercase tracking-[0.18em]">
                      Price info object
                    </div>
                    <div className="mt-1 font-semibold text-sds-dark dark:text-sds-light">
                      {shortenId(currency.pythObjectId)}
                    </div>
                  </div>
                ) : null}
                {registryId ? (
                  <div>
                    <div className="text-[0.55rem] uppercase tracking-[0.18em]">
                      Currency registry
                    </div>
                    <div className="mt-1 font-semibold text-sds-dark dark:text-sds-light">
                      {shortenId(registryId)}
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-[0.65rem]">
                <CopyableId
                  value={currency.acceptedCurrencyId}
                  label="Accepted"
                />
                {currency.pythObjectId ? (
                  <CopyableId value={currency.pythObjectId} label="Pyth" />
                ) : null}
                {registryId ? (
                  <CopyableId value={registryId} label="Registry" />
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    )}
  </ModalSection>
)

const AddCurrencyModal = ({
  open,
  onClose,
  shopId,
  acceptedCurrencies,
  onCurrencyCreated
}: {
  open: boolean
  onClose: () => void
  shopId?: string
  acceptedCurrencies: AcceptedCurrencySummary[]
  onCurrencyCreated?: (currency?: AcceptedCurrencySummary) => void
}) => {
  const {
    formState,
    fieldErrors,
    fieldWarnings,
    coinTypeLabel,
    feedIdPreview,
    priceInfoPreview,
    registryPreview,
    guardrailPreview,
    transactionState,
    transactionSummary,
    isSuccessState,
    isErrorState,
    canSubmit,
    explorerUrl,
    handleAddCurrency,
    handleInputChange,
    markFieldBlur,
    shouldShowFieldError,
    shouldShowFieldWarning,
    resetForm
  } = useAddCurrencyModalState({ open, shopId, onCurrencyCreated })

  if (!open) return null

  return (
    <ModalFrame onClose={onClose}>
      {isSuccessState && transactionSummary ? (
        <CurrencySuccessView
          summary={transactionSummary}
          shopId={shopId}
          explorerUrl={explorerUrl}
          onClose={onClose}
          onReset={resetForm}
        />
      ) : isErrorState ? (
        <CurrencyErrorView
          error={transactionState.error}
          details={transactionState.details}
          currencyLabel={coinTypeLabel}
          onClose={onClose}
          onReset={resetForm}
        />
      ) : (
        <>
          <ModalHeader
            eyebrow="Accepted currencies"
            title="Add Currency"
            description="Wire a new coin type to a Pyth price feed."
            onClose={onClose}
            footer={shopId ? <CopyableId value={shopId} label="Shop" /> : null}
          />

          <ModalBody>
            <AvailableFeedsSection acceptedCurrencies={acceptedCurrencies} />

            <ModalSection
              title="Currency identity"
              subtitle="Describe the coin type and registry object."
            >
              <div className="grid gap-4 md:grid-cols-2 md:items-end">
                <label className={modalFieldLabelClassName}>
                  <span className={modalFieldTitleClassName}>Coin type</span>
                  <span className={modalFieldDescriptionClassName}>
                    Fully qualified Move type for the coin to accept.
                  </span>
                  <input
                    type="text"
                    value={formState.coinType}
                    onChange={(event) =>
                      handleInputChange("coinType", event.target.value)
                    }
                    onBlur={() => markFieldBlur("coinType")}
                    placeholder="0x2::sui::SUI"
                    className={clsx(
                      modalFieldInputClassName,
                      shouldShowFieldError("coinType", fieldErrors.coinType) &&
                        modalFieldInputErrorClassName
                    )}
                  />
                  {shouldShowFieldError("coinType", fieldErrors.coinType) ? (
                    <span className={modalFieldErrorTextClassName}>
                      {fieldErrors.coinType}
                    </span>
                  ) : null}
                </label>
                <label className={modalFieldLabelClassName}>
                  <span className={modalFieldTitleClassName}>
                    Currency registry id (optional)
                  </span>
                  <span className={modalFieldDescriptionClassName}>
                    Currency&lt;T&gt; object id from the coin registry. If
                    omitted, it is derived from the coin type.
                  </span>
                  <input
                    type="text"
                    value={formState.currencyObjectId}
                    onChange={(event) =>
                      handleInputChange("currencyObjectId", event.target.value)
                    }
                    onBlur={() => markFieldBlur("currencyObjectId")}
                    placeholder="0x... registry currency id"
                    className={clsx(
                      modalFieldInputClassName,
                      shouldShowFieldError(
                        "currencyObjectId",
                        fieldErrors.currencyObjectId
                      ) && modalFieldInputErrorClassName
                    )}
                  />
                  {shouldShowFieldError(
                    "currencyObjectId",
                    fieldErrors.currencyObjectId
                  ) ? (
                    <span className={modalFieldErrorTextClassName}>
                      {fieldErrors.currencyObjectId}
                    </span>
                  ) : null}
                </label>
              </div>
            </ModalSection>

            <ModalSection
              title="Oracle wiring"
              subtitle="Connect the coin to its Pyth feed."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <label className={modalFieldLabelClassName}>
                  <span className={modalFieldTitleClassName}>Pyth feed id</span>
                  <span className={modalFieldDescriptionClassName}>
                    32-byte hex identifier for the price feed (0x...).
                  </span>
                  <input
                    type="text"
                    value={formState.feedId}
                    onChange={(event) =>
                      handleInputChange("feedId", event.target.value)
                    }
                    onBlur={() => markFieldBlur("feedId")}
                    placeholder="0x..."
                    className={clsx(
                      modalFieldInputClassName,
                      shouldShowFieldError("feedId", fieldErrors.feedId) &&
                        modalFieldInputErrorClassName
                    )}
                  />
                  {shouldShowFieldError("feedId", fieldErrors.feedId) ? (
                    <span className={modalFieldErrorTextClassName}>
                      {fieldErrors.feedId}
                    </span>
                  ) : null}
                </label>
                <label className={modalFieldLabelClassName}>
                  <span className={modalFieldTitleClassName}>
                    Price info object id
                  </span>
                  <span className={modalFieldDescriptionClassName}>
                    Shared PriceInfoObject id matching the selected feed.
                  </span>
                  <input
                    type="text"
                    value={formState.priceInfoObjectId}
                    onChange={(event) =>
                      handleInputChange("priceInfoObjectId", event.target.value)
                    }
                    onBlur={() => markFieldBlur("priceInfoObjectId")}
                    placeholder="0x... price info object id"
                    className={clsx(
                      modalFieldInputClassName,
                      shouldShowFieldError(
                        "priceInfoObjectId",
                        fieldErrors.priceInfoObjectId
                      ) && modalFieldInputErrorClassName
                    )}
                  />
                  {shouldShowFieldError(
                    "priceInfoObjectId",
                    fieldErrors.priceInfoObjectId
                  ) ? (
                    <span className={modalFieldErrorTextClassName}>
                      {fieldErrors.priceInfoObjectId}
                    </span>
                  ) : null}
                </label>
              </div>
            </ModalSection>

            <ModalSection
              title="Guardrails"
              subtitle="Optional caps that override module defaults."
            >
              <div className="grid gap-4 md:grid-cols-3 md:items-end">
                <label className={modalFieldLabelClassName}>
                  <span className={modalFieldTitleClassName}>
                    Max price age (secs)
                  </span>
                  <span className={modalFieldDescriptionClassName}>
                    Maximum accepted publish time age in seconds.
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formState.maxPriceAgeSecsCap}
                    onChange={(event) =>
                      handleInputChange(
                        "maxPriceAgeSecsCap",
                        event.target.value
                      )
                    }
                    onBlur={() => markFieldBlur("maxPriceAgeSecsCap")}
                    placeholder="Default"
                    className={clsx(
                      modalFieldInputClassName,
                      shouldShowFieldError(
                        "maxPriceAgeSecsCap",
                        fieldErrors.maxPriceAgeSecsCap
                      ) && modalFieldInputErrorClassName
                    )}
                  />
                  {shouldShowFieldError(
                    "maxPriceAgeSecsCap",
                    fieldErrors.maxPriceAgeSecsCap
                  ) ? (
                    <span className={modalFieldErrorTextClassName}>
                      {fieldErrors.maxPriceAgeSecsCap}
                    </span>
                  ) : shouldShowFieldWarning(
                      "maxPriceAgeSecsCap",
                      fieldWarnings.maxPriceAgeSecsCap
                    ) ? (
                    <span className={modalFieldWarningTextClassName}>
                      {fieldWarnings.maxPriceAgeSecsCap}
                    </span>
                  ) : null}
                </label>
                <label className={modalFieldLabelClassName}>
                  <span className={modalFieldTitleClassName}>
                    Max confidence (bps)
                  </span>
                  <span className={modalFieldDescriptionClassName}>
                    Maximum confidence ratio, expressed in basis points.
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formState.maxConfidenceRatioBpsCap}
                    onChange={(event) =>
                      handleInputChange(
                        "maxConfidenceRatioBpsCap",
                        event.target.value
                      )
                    }
                    onBlur={() => markFieldBlur("maxConfidenceRatioBpsCap")}
                    placeholder="Default"
                    className={clsx(
                      modalFieldInputClassName,
                      shouldShowFieldError(
                        "maxConfidenceRatioBpsCap",
                        fieldErrors.maxConfidenceRatioBpsCap
                      ) && modalFieldInputErrorClassName
                    )}
                  />
                  {shouldShowFieldError(
                    "maxConfidenceRatioBpsCap",
                    fieldErrors.maxConfidenceRatioBpsCap
                  ) ? (
                    <span className={modalFieldErrorTextClassName}>
                      {fieldErrors.maxConfidenceRatioBpsCap}
                    </span>
                  ) : shouldShowFieldWarning(
                      "maxConfidenceRatioBpsCap",
                      fieldWarnings.maxConfidenceRatioBpsCap
                    ) ? (
                    <span className={modalFieldWarningTextClassName}>
                      {fieldWarnings.maxConfidenceRatioBpsCap}
                    </span>
                  ) : null}
                </label>
                <label className={modalFieldLabelClassName}>
                  <span className={modalFieldTitleClassName}>
                    Max status lag (secs)
                  </span>
                  <span className={modalFieldDescriptionClassName}>
                    Maximum gap between price status and publish time.
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formState.maxPriceStatusLagSecsCap}
                    onChange={(event) =>
                      handleInputChange(
                        "maxPriceStatusLagSecsCap",
                        event.target.value
                      )
                    }
                    onBlur={() => markFieldBlur("maxPriceStatusLagSecsCap")}
                    placeholder="Default"
                    className={clsx(
                      modalFieldInputClassName,
                      shouldShowFieldError(
                        "maxPriceStatusLagSecsCap",
                        fieldErrors.maxPriceStatusLagSecsCap
                      ) && modalFieldInputErrorClassName
                    )}
                  />
                  {shouldShowFieldError(
                    "maxPriceStatusLagSecsCap",
                    fieldErrors.maxPriceStatusLagSecsCap
                  ) ? (
                    <span className={modalFieldErrorTextClassName}>
                      {fieldErrors.maxPriceStatusLagSecsCap}
                    </span>
                  ) : shouldShowFieldWarning(
                      "maxPriceStatusLagSecsCap",
                      fieldWarnings.maxPriceStatusLagSecsCap
                    ) ? (
                    <span className={modalFieldWarningTextClassName}>
                      {fieldWarnings.maxPriceStatusLagSecsCap}
                    </span>
                  ) : null}
                </label>
              </div>
            </ModalSection>

            <ModalSection
              title="Review"
              subtitle="Confirm the currency wiring before submitting."
            >
              <div className="grid gap-3 text-xs sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                  <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                    Coin type
                  </div>
                  <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                    {coinTypeLabel}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                  <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                    Registry id
                  </div>
                  <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                    {registryPreview}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                  <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                    Feed id
                  </div>
                  <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                    {feedIdPreview}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                  <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                    Price info object
                  </div>
                  <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                    {priceInfoPreview}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                  <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                    Max price age
                  </div>
                  <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                    {guardrailPreview.maxPriceAgeSecsCap}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
                  <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                    Max confidence
                  </div>
                  <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                    {guardrailPreview.maxConfidenceRatioBpsCap}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 sm:col-span-2 dark:border-slate-50/15 dark:bg-slate-950/60">
                  <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                    Max status lag
                  </div>
                  <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
                    {guardrailPreview.maxPriceStatusLagSecsCap}
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
                  : "Ready to register the currency."}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={handleAddCurrency} disabled={!canSubmit}>
                  {transactionState.status === "processing"
                    ? "Processing..."
                    : "Add currency"}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </ModalFrame>
  )
}

export default AddCurrencyModal
