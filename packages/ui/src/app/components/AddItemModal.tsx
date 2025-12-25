"use client"

import {
  useCurrentAccount,
  useCurrentWallet,
  useSignAndExecuteTransaction,
  useSignTransaction,
  useSuiClient,
  useSuiClientContext
} from "@mysten/dapp-kit"
import type { SuiTransactionBlockResponse } from "@mysten/sui/client"
import clsx from "clsx"
import { useEffect, useMemo, useState } from "react"

import type { ItemListingSummary } from "@sui-oracle-market/domain-core/models/item-listing"
import { getItemListingSummary } from "@sui-oracle-market/domain-core/models/item-listing"
import { parseUsdToCents } from "@sui-oracle-market/domain-core/models/shop"
import { buildAddItemListingTransaction } from "@sui-oracle-market/domain-core/ptb/item-listing"
import {
  deriveRelevantPackageId,
  normalizeOptionalId
} from "@sui-oracle-market/tooling-core/object"
import { getSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { ENetwork } from "@sui-oracle-market/tooling-core/types"
import { parsePositiveU64 } from "@sui-oracle-market/tooling-core/utils/utility"
import { EXPLORER_URL_VARIABLE_NAME } from "../config/network"
import { copyToClipboard } from "../helpers/clipboard"
import { formatUsdFromCents, getStructLabel, shortenId } from "../helpers/format"
import {
  getLocalnetClient,
  makeLocalnetExecutor,
  walletSupportsChain
} from "../helpers/localnet"
import {
  extractErrorDetails,
  formatErrorMessage,
  safeJsonStringify,
  serializeForJson
} from "../helpers/transactionErrors"
import { resolveOwnerCapabilityId } from "../helpers/ownerCapabilities"
import {
  resolveValidationMessage,
  validateMoveType,
  validateOptionalSuiObjectId
} from "../helpers/inputValidation"
import {
  extractCreatedObjects,
  formatTimestamp,
  summarizeObjectChanges
} from "../helpers/transactionFormat"
import useNetworkConfig from "../hooks/useNetworkConfig"
import { useIdleFieldValidation } from "../hooks/useIdleFieldValidation"
import CopyableId from "./CopyableId"
import {
  ModalSection,
  modalFieldErrorTextClassName,
  modalFieldInputErrorClassName,
  modalFieldDescriptionClassName,
  modalFieldInputClassName,
  modalFieldLabelClassName,
  modalFieldTitleClassName,
  modalCloseButtonClassName,
  secondaryActionButtonClassName
} from "./ModalPrimitives"

type ListingFormState = {
  itemName: string
  itemType: string
  basePrice: string
  stock: string
  spotlightDiscountId: string
}

type ListingInputs = {
  itemName: string
  itemType: string
  basePriceUsdCents: bigint
  stock: bigint
  spotlightDiscountId?: string
}

type ListingTransactionSummary = ListingInputs & {
  digest: string
  transactionBlock: SuiTransactionBlockResponse
  listingId?: string
}

type TransactionState =
  | { status: "idle" }
  | { status: "processing" }
  | { status: "success"; summary: ListingTransactionSummary }
  | { status: "error"; error: string; details?: string }

const emptyFormState = (): ListingFormState => ({
  itemName: "",
  itemType: "",
  basePrice: "",
  stock: "",
  spotlightDiscountId: ""
})

type ListingFieldErrors = Partial<Record<keyof ListingFormState, string>>

const buildListingFieldErrors = (
  formState: ListingFormState
): ListingFieldErrors => {
  const errors: ListingFieldErrors = {}
  const itemName = formState.itemName.trim()
  const basePrice = formState.basePrice.trim()
  const stock = formState.stock.trim()

  if (!itemName) errors.itemName = "Item name is required."

  const itemTypeError = validateMoveType(formState.itemType, "Item type")
  if (itemTypeError) errors.itemType = itemTypeError

  if (!basePrice) {
    errors.basePrice = "Base price is required."
  } else {
    try {
      const basePriceUsdCents = parseUsdToCents(basePrice)
      if (basePriceUsdCents <= 0n)
        errors.basePrice = "Base price must be greater than zero."
    } catch (error) {
      errors.basePrice = resolveValidationMessage(
        error,
        "Enter a valid USD amount."
      )
    }
  }

  if (!stock) {
    errors.stock = "Stock is required."
  } else {
    try {
      parsePositiveU64(stock, "Stock")
    } catch (error) {
      errors.stock = resolveValidationMessage(
        error,
        "Stock must be a valid u64."
      )
    }
  }

  const spotlightError = validateOptionalSuiObjectId(
    formState.spotlightDiscountId,
    "Spotlight discount template id"
  )
  if (spotlightError) errors.spotlightDiscountId = spotlightError

  return errors
}


const parseListingInputs = (formState: ListingFormState): ListingInputs => {
  const itemName = formState.itemName.trim()
  if (!itemName) throw new Error("Item name is required.")

  const itemType = formState.itemType.trim()
  if (!itemType) throw new Error("Item type is required.")

  const basePriceUsdCents = parseUsdToCents(formState.basePrice)
  const stock = parsePositiveU64(formState.stock, "stock")
  const spotlightDiscountId = normalizeOptionalId(
    formState.spotlightDiscountId.trim() || undefined
  )

  return {
    itemName,
    itemType,
    basePriceUsdCents,
    stock,
    spotlightDiscountId
  }
}

const ListingSuccessHeader = ({
  itemName,
  onClose
}: {
  itemName: string
  onClose: () => void
}) => (
  <div className="relative overflow-hidden border-b border-emerald-400/90 px-6 py-5 dark:border-emerald-400/50">
    <div className="absolute inset-0 bg-gradient-to-br from-emerald-300/95 via-white/80 to-emerald-200/90 opacity-95 dark:from-emerald-500/45 dark:via-slate-950/35 dark:to-emerald-400/30" />
    <div className="relative flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-emerald-800 dark:text-emerald-100">
          Success
        </div>
        <div className="mt-2 text-xl font-semibold text-sds-dark dark:text-sds-light">
          Listing created
        </div>
        <div className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          {itemName}
        </div>
        <div className="mt-2 text-[0.7rem] font-semibold text-emerald-900 dark:text-emerald-100">
          The inventory entry is live on chain.
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        className={modalCloseButtonClassName}
      >
        Close
      </button>
    </div>
  </div>
)

const ListingErrorHeader = ({
  itemName,
  onClose
}: {
  itemName: string
  onClose: () => void
}) => (
  <div className="relative overflow-hidden border-b border-rose-300/80 px-6 py-5 dark:border-rose-400/40">
    <div className="absolute inset-0 bg-gradient-to-br from-rose-200/95 via-white/80 to-rose-100/90 opacity-95 dark:from-rose-500/40 dark:via-slate-950/35 dark:to-rose-400/25" />
    <div className="relative flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-rose-800 dark:text-rose-100">
          Error
        </div>
        <div className="mt-2 text-xl font-semibold text-sds-dark dark:text-sds-light">
          Listing failed
        </div>
        <div className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
          {itemName}
        </div>
        <div className="mt-2 text-[0.7rem] font-semibold text-rose-900 dark:text-rose-100">
          Review the error details and try again.
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        className={modalCloseButtonClassName}
      >
        Close
      </button>
    </div>
  </div>
)

const ListingErrorNotice = ({
  error,
  details
}: {
  error: string
  details?: string
}) => (
  <div className="relative overflow-hidden rounded-2xl border border-rose-200/80 bg-rose-50/70 px-4 py-4 text-xs dark:border-rose-500/30 dark:bg-rose-500/10">
    <div className="absolute inset-0 bg-gradient-to-br from-rose-100/90 via-white/85 to-rose-50/80 opacity-90 dark:from-rose-500/30 dark:via-slate-950/45 dark:to-rose-400/20" />
    <div className="relative">
      <div className="text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-rose-700/95 dark:text-rose-200/90">
        Error
      </div>
      <div className="mt-2 text-sm font-semibold text-rose-800 dark:text-rose-100">
        Transaction failed
      </div>
      <div className="mt-2 text-[0.7rem] text-rose-700/90 dark:text-rose-200/90">
        {error}
      </div>
      {details ? (
        <details className="mt-3 text-[0.7rem] text-rose-700/90 dark:text-rose-200/90">
          <summary className="cursor-pointer font-semibold">
            Raw error JSON
          </summary>
          <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-rose-200/60 bg-white/80 p-2 text-[0.65rem] text-rose-700 dark:border-rose-500/30 dark:bg-slate-950/60 dark:text-rose-200">
            {details}
          </pre>
          <button
            type="button"
            onClick={() => copyToClipboard(details)}
            className="mt-2 inline-flex items-center rounded-full border border-rose-200/70 px-3 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-rose-600 transition hover:border-rose-300 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 dark:border-rose-500/30 dark:text-rose-200"
          >
            Copy raw error
          </button>
        </details>
      ) : null}
    </div>
  </div>
)

const ListingSummarySection = ({
  summary,
  shopId
}: {
  summary: ListingTransactionSummary
  shopId?: string
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
        <div className="mt-2 text-[0.7rem] text-slate-500 dark:text-slate-200/60">
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
      <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60 sm:col-span-2">
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
            <CopyableId value={summary.spotlightDiscountId} label="Template" />
          </div>
        ) : null}
      </div>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
      {summary.listingId ? (
        <CopyableId value={summary.listingId} label="Listing ID" />
      ) : null}
      {shopId ? <CopyableId value={shopId} label="Shop ID" /> : null}
    </div>
  </ModalSection>
)

const ListingTransactionRecap = ({
  summary,
  explorerUrl
}: {
  summary: ListingTransactionSummary
  explorerUrl?: string
}) => {
  const { transactionBlock, digest } = summary
  const status = transactionBlock.effects?.status?.status ?? "unknown"
  const error = transactionBlock.effects?.status?.error
  const objectChanges = transactionBlock.objectChanges ?? []
  const objectChangeSummary = summarizeObjectChanges(objectChanges)

  const explorerLink =
    explorerUrl && digest ? `${explorerUrl}/txblock/${digest}` : undefined

  return (
    <ModalSection
      title="Transaction recap"
      subtitle="On-chain confirmation details"
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
              <div className="mt-2 text-xs text-rose-500">{error}</div>
            ) : null}
          </div>
          <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60">
            <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
              Timestamp
            </div>
            <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
              {formatTimestamp(transactionBlock.timestampMs)}
            </div>
            {transactionBlock.checkpoint ? (
              <div className="mt-1 text-[0.65rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                Checkpoint {transactionBlock.checkpoint}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
            Digest
          </span>
          <CopyableId value={digest} />
          {explorerLink ? (
            <a
              href={explorerLink}
              target="_blank"
              rel="noreferrer"
              className="dark:text-sds-blue/80 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-sds-blue hover:text-sds-dark dark:hover:text-sds-light"
            >
              View on explorer
            </a>
          ) : null}
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
                      ) : null}
                    </div>
                  )
                })}
            </div>
          ) : (
            <div className="mt-2 text-xs text-slate-500 dark:text-slate-200/60">
              No object changes detected.
            </div>
          )}
        </div>
      </div>
    </ModalSection>
  )
}

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
    <ListingSuccessHeader itemName={summary.itemName} onClose={onClose} />
    <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-6">
      <ListingSummarySection summary={summary} shopId={shopId} />
      <ListingTransactionRecap summary={summary} explorerUrl={explorerUrl} />
    </div>
    <div className="border-t border-slate-200/70 px-6 py-4 dark:border-slate-50/15">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-[0.18em] text-emerald-800 dark:text-emerald-100">
          On-chain confirmation complete.
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onReset}
            className={secondaryActionButtonClassName}
          >
            Add another
          </button>
          <button
            type="button"
            onClick={onClose}
            className={secondaryActionButtonClassName}
          >
            Close
          </button>
        </div>
      </div>
    </div>
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
    <ListingErrorHeader itemName={itemName} onClose={onClose} />
    <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-6">
      <ListingErrorNotice error={error} details={details} />
    </div>
    <div className="border-t border-slate-200/70 px-6 py-4 dark:border-slate-50/15">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-[0.18em] text-rose-800 dark:text-rose-100">
          Resolve the issue and retry when ready.
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onReset}
            className={secondaryActionButtonClassName}
          >
            Try again
          </button>
          <button
            type="button"
            onClick={onClose}
            className={secondaryActionButtonClassName}
          >
            Close
          </button>
        </div>
      </div>
    </div>
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
  const currentAccount = useCurrentAccount()
  const { currentWallet } = useCurrentWallet()
  const suiClient = useSuiClient()
  const { network } = useSuiClientContext()
  const { useNetworkVariable } = useNetworkConfig()
  const explorerUrl = useNetworkVariable(EXPLORER_URL_VARIABLE_NAME)
  const signAndExecuteTransaction = useSignAndExecuteTransaction()
  const signTransaction = useSignTransaction()
  const localnetClient = useMemo(() => getLocalnetClient(), [])
  const isLocalnet = network === ENetwork.LOCALNET
  const localnetExecutor = useMemo(
    () =>
      makeLocalnetExecutor({
        client: localnetClient,
        signTransaction: signTransaction.mutateAsync
      }),
    [localnetClient, signTransaction.mutateAsync]
  )

  const [formState, setFormState] = useState<ListingFormState>(
    emptyFormState()
  )
  const [transactionState, setTransactionState] = useState<TransactionState>({
    status: "idle"
  })
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const {
    markFieldChange,
    markFieldBlur,
    resetFieldState,
    shouldShowFieldFeedback
  } = useIdleFieldValidation<keyof ListingFormState>({ idleDelayMs: 600 })

  const walletAddress = currentAccount?.address

  const fieldErrors = useMemo(
    () => buildListingFieldErrors(formState),
    [formState]
  )
  const hasFieldErrors = Object.values(fieldErrors).some(Boolean)

  const pricePreview = useMemo(() => {
    if (!formState.basePrice.trim()) return "Enter price"
    try {
      return formatUsdFromCents(parseUsdToCents(formState.basePrice).toString())
    } catch {
      return "Invalid price"
    }
  }, [formState.basePrice])

  const stockPreview = useMemo(() => {
    if (!formState.stock.trim()) return "Enter stock"
    try {
      return parsePositiveU64(formState.stock, "stock").toString()
    } catch {
      return "Invalid stock"
    }
  }, [formState.stock])

  const itemTypeLabel = useMemo(
    () =>
      formState.itemType.trim()
        ? getStructLabel(formState.itemType)
        : "Item type",
    [formState.itemType]
  )

  const isSubmissionPending = isLocalnet
    ? signTransaction.isPending
    : signAndExecuteTransaction.isPending

  const canSubmit =
    Boolean(walletAddress && shopId && !hasFieldErrors) &&
    transactionState.status !== "processing" &&
    isSubmissionPending !== true

  const resetForm = () => {
    setFormState(emptyFormState())
    setTransactionState({ status: "idle" })
    setHasAttemptedSubmit(false)
    resetFieldState()
  }

  useEffect(() => {
    if (!open) return
    resetForm()
  }, [open])

  const handleInputChange = <K extends keyof ListingFormState>(
    key: K,
    value: ListingFormState[K]
  ) => {
    markFieldChange(key)
    setFormState((previous) => ({
      ...previous,
      [key]: value
    }))
  }

  const shouldShowFieldError = <K extends keyof ListingFormState>(
    key: K,
    error?: string
  ): error is string =>
    Boolean(error && shouldShowFieldFeedback(key, hasAttemptedSubmit))

  const handleAddItem = async () => {
    setHasAttemptedSubmit(true)

    if (!walletAddress || !shopId) {
      setTransactionState({
        status: "error",
        error: "Wallet and shop details are required to add a listing."
      })
      return
    }

    if (hasFieldErrors) return

    const expectedChain = `sui:${network}`
    const accountChains = currentAccount?.chains ?? []
    const localnetSupported = walletSupportsChain(
      currentWallet ?? currentAccount,
      expectedChain
    )
    const walletFeatureKeys = currentWallet
      ? Object.keys(currentWallet.features)
      : []
    const chainMismatch =
      accountChains.length > 0 && !accountChains.includes(expectedChain)

    const walletContext = {
      appNetwork: network,
      expectedChain,
      walletName: currentWallet?.name,
      walletVersion: currentWallet?.version,
      accountAddress: walletAddress,
      accountChains,
      chainMismatch,
      localnetSupported,
      walletFeatureKeys
    }

    if (!isLocalnet && chainMismatch) {
      setTransactionState({
        status: "error",
        error: `Wallet chain mismatch. Switch your wallet to ${network}.`,
        details: safeJsonStringify(
          { walletContext, reason: "chain_mismatch" },
          2
        )
      })
      return
    }

    if (!currentWallet) {
      setTransactionState({
        status: "error",
        error: "No wallet connected. Connect a wallet to continue.",
        details: safeJsonStringify(
          { walletContext, reason: "wallet_missing" },
          2
        )
      })
      return
    }

    setTransactionState({ status: "processing" })

    let failureStage: "prepare" | "execute" | "fetch" = "prepare"

    try {
      const listingInputs = parseListingInputs(formState)
      const shopShared = await getSuiSharedObject(
        { objectId: shopId, mutable: true },
        { suiClient }
      )
      const resolvedShopId = shopShared.object.objectId
      const shopPackageId = deriveRelevantPackageId(shopShared.object.type)
      const ownerCapabilityId = await resolveOwnerCapabilityId({
        shopId: resolvedShopId,
        shopPackageId,
        ownerAddress: walletAddress,
        suiClient
      })

      const addListingTransaction = buildAddItemListingTransaction({
        packageId: shopPackageId,
        itemType: listingInputs.itemType,
        shop: shopShared,
        ownerCapId: ownerCapabilityId,
        itemName: listingInputs.itemName,
        basePriceUsdCents: listingInputs.basePriceUsdCents,
        stock: listingInputs.stock,
        spotlightDiscountId: listingInputs.spotlightDiscountId
      })
      addListingTransaction.setSender(walletAddress)

      let digest = ""
      let transactionBlock: SuiTransactionBlockResponse

      if (isLocalnet) {
        failureStage = "execute"
        const result = await localnetExecutor(addListingTransaction, {
          chain: expectedChain
        })
        digest = result.digest
        transactionBlock = result
      } else {
        failureStage = "execute"
        const result = await signAndExecuteTransaction.mutateAsync({
          transaction: addListingTransaction,
          chain: expectedChain
        })

        failureStage = "fetch"
        digest = result.digest
        transactionBlock = await suiClient.getTransactionBlock({
          digest,
          options: {
            showEffects: true,
            showObjectChanges: true,
            showEvents: true,
            showBalanceChanges: true,
            showInput: true
          }
        })
      }

      const listingId = extractCreatedObjects(transactionBlock).find((change) =>
        change.objectType.includes("::shop::ItemListing")
      )?.objectId

      const optimisticListing = listingId
        ? {
            itemListingId: listingId,
            markerObjectId: listingId, // Placeholder until we fetch the marker id.
            name: listingInputs.itemName,
            itemType: listingInputs.itemType,
            basePriceUsdCents: listingInputs.basePriceUsdCents.toString(),
            stock: listingInputs.stock.toString(),
            spotlightTemplateId: listingInputs.spotlightDiscountId
          }
        : undefined

      setTransactionState({
        status: "success",
        summary: {
          ...listingInputs,
          digest,
          transactionBlock,
          listingId
        }
      })

      onListingCreated?.(optimisticListing)

      if (listingId) {
        void getItemListingSummary(resolvedShopId, listingId, suiClient)
          .then((summary) => onListingCreated?.(summary))
          .catch(() => {})
      }
    } catch (error) {
      const errorDetails = extractErrorDetails(error)
      const localnetSupportNote =
        isLocalnet && !localnetSupported && failureStage === "execute"
          ? "Wallet may not support sui:localnet signing."
          : undefined
      const errorDetailsRaw = safeJsonStringify(
        {
          summary: errorDetails,
          raw: serializeForJson(error),
          failureStage,
          localnetSupportNote,
          walletContext
        },
        2
      )
      const formattedError = formatErrorMessage(error)
      const errorMessage = localnetSupportNote
        ? `${formattedError} ${localnetSupportNote}`
        : formattedError
      setTransactionState({
        status: "error",
        error: errorMessage,
        details: errorDetailsRaw
      })
    }
  }

  if (!open) return null

  const isSuccessState = transactionState.status === "success"
  const isErrorState = transactionState.status === "error"
  const transactionSummary = isSuccessState
    ? transactionState.summary
    : undefined

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-10 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-4xl overflow-hidden rounded-3xl border border-slate-300/70 bg-white/95 shadow-[0_35px_80px_-55px_rgba(15,23,42,0.55)] dark:border-slate-50/20 dark:bg-slate-950/90">
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
            error={transactionState.error}
            details={transactionState.details}
            itemName={formState.itemName || "Listing"}
            onClose={onClose}
            onReset={resetForm}
          />
        ) : (
          <>
            <div className="relative overflow-hidden border-b border-slate-200/70 px-6 py-5 dark:border-slate-50/15">
              <div className="from-sds-blue/10 to-sds-pink/15 dark:from-sds-blue/20 dark:to-sds-pink/10 absolute inset-0 bg-gradient-to-br via-white/80 opacity-80 dark:via-slate-950/40" />
              <div className="relative flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-200/60">
                    Inventory
                  </div>
                  <div className="mt-2 text-xl font-semibold text-sds-dark dark:text-sds-light">
                    Add Item
                  </div>
                  <div className="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                    Create a new listing for your storefront.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className={modalCloseButtonClassName}
                >
                  Close
                </button>
              </div>
              {shopId ? (
                <div className="relative mt-4">
                  <CopyableId value={shopId} label="Shop" />
                </div>
              ) : null}
            </div>

            <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-6">
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
                        shouldShowFieldError(
                          "itemName",
                          fieldErrors.itemName
                        ) && modalFieldInputErrorClassName
                      )}
                    />
                    {shouldShowFieldError(
                      "itemName",
                      fieldErrors.itemName
                    ) ? (
                      <span className={modalFieldErrorTextClassName}>
                        {fieldErrors.itemName}
                      </span>
                    ) : null}
                  </label>
                  <label className={modalFieldLabelClassName}>
                    <span className={modalFieldTitleClassName}>Item type</span>
                    <span className={modalFieldDescriptionClassName}>
                      Fully qualified Move type minted in the item receipt.
                    </span>
                    <input
                      type="text"
                      value={formState.itemType}
                      onChange={(event) =>
                        handleInputChange("itemType", event.target.value)
                      }
                      onBlur={() => markFieldBlur("itemType")}
                      placeholder="0x...::item_examples::Bike"
                      className={clsx(
                        modalFieldInputClassName,
                        shouldShowFieldError(
                          "itemType",
                          fieldErrors.itemType
                        ) && modalFieldInputErrorClassName
                      )}
                    />
                    {shouldShowFieldError(
                      "itemType",
                      fieldErrors.itemType
                    ) ? (
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
                    {shouldShowFieldError(
                      "basePrice",
                      fieldErrors.basePrice
                    ) ? (
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
                        shouldShowFieldError(
                          "stock",
                          fieldErrors.stock
                        ) && modalFieldInputErrorClassName
                      )}
                    />
                    {shouldShowFieldError(
                      "stock",
                      fieldErrors.stock
                    ) ? (
                      <span className={modalFieldErrorTextClassName}>
                        {fieldErrors.stock}
                      </span>
                    ) : null}
                  </label>
                  <label
                    className={clsx(
                      modalFieldLabelClassName,
                      "md:col-span-2"
                    )}
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
                        ) &&
                          modalFieldInputErrorClassName
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
                      <div className="mt-2 text-[0.7rem] text-slate-500 dark:text-slate-200/60">
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
                  <div className="rounded-xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-50/15 dark:bg-slate-950/60 sm:col-span-2">
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
            </div>

            <div className="border-t border-slate-200/70 px-6 py-4 dark:border-slate-50/15">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                  {transactionState.status === "processing"
                    ? "Waiting for wallet confirmation..."
                    : "Ready to create the listing."}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleAddItem}
                    disabled={!canSubmit}
                    className={clsx(
                      "border-sds-blue/40 from-sds-blue/20 to-sds-pink/30 focus-visible:ring-sds-blue/40 dark:from-sds-blue/20 dark:to-sds-pink/10 inline-flex items-center gap-2 rounded-full border bg-gradient-to-r via-white/80 px-5 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-sds-dark shadow-[0_14px_36px_-26px_rgba(77,162,255,0.9)] transition focus-visible:outline-none focus-visible:ring-2 dark:via-slate-900/40 dark:text-sds-light",
                      !canSubmit
                        ? "cursor-not-allowed opacity-50"
                        : "hover:-translate-y-0.5 hover:shadow-[0_18px_45px_-25px_rgba(77,162,255,0.9)]"
                    )}
                  >
                    {transactionState.status === "processing"
                      ? "Processing..."
                      : "Add listing"}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default AddItemModal
