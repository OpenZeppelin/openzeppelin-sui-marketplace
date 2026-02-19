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
import type { IdentifierString } from "@mysten/wallet-standard"
import type { ItemListingSummary } from "@sui-oracle-market/domain-core/models/item-listing"
import {
  findAddedItemListingId,
  getItemListingSummary
} from "@sui-oracle-market/domain-core/models/item-listing"
import { parseUsdToCents } from "@sui-oracle-market/domain-core/models/shop"
import { buildAddItemListingTransaction } from "@sui-oracle-market/domain-core/ptb/item-listing"
import {
  deriveRelevantPackageId,
  normalizeOptionalId
} from "@sui-oracle-market/tooling-core/object"
import { getSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { ENetwork } from "@sui-oracle-market/tooling-core/types"
import { parsePositiveU64 } from "@sui-oracle-market/tooling-core/utils/utility"
import { useCallback, useEffect, useMemo, useState } from "react"
import { EXPLORER_URL_VARIABLE_NAME } from "../config/network"
import { formatUsdFromCents, getStructLabel } from "../helpers/format"
import {
  resolveValidationMessage,
  validateItemType,
  validateOptionalSuiObjectId
} from "../helpers/inputValidation"
import {
  getLocalnetClient,
  makeLocalnetExecutor,
  walletSupportsChain
} from "../helpers/localnet"
import { resolveOwnerCapabilityId } from "../helpers/ownerCapabilities"
import {
  extractErrorDetails,
  formatErrorMessage,
  safeJsonStringify,
  serializeForJson
} from "../helpers/transactionErrors"
import { waitForTransactionBlock } from "../helpers/transactionWait"
import { useIdleFieldValidation } from "./useIdleFieldValidation"
import useNetworkConfig from "./useNetworkConfig"

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

export type ListingTransactionSummary = ListingInputs & {
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

  const itemTypeError = validateItemType(formState.itemType, "Item type")
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

type AddItemModalState = {
  formState: ListingFormState
  fieldErrors: ListingFieldErrors
  pricePreview: string
  stockPreview: string
  itemTypeLabel: string
  transactionState: TransactionState
  transactionSummary?: ListingTransactionSummary
  isSuccessState: boolean
  isErrorState: boolean
  canSubmit: boolean
  walletConnected: boolean
  explorerUrl?: string
  handleAddItem: () => Promise<void>
  handleInputChange: <K extends keyof ListingFormState>(
    key: K,
    value: ListingFormState[K]
  ) => void
  markFieldBlur: (key: keyof ListingFormState) => void
  shouldShowFieldError: <K extends keyof ListingFormState>(
    key: K,
    error?: string
  ) => error is string
  resetForm: () => void
}

export const useAddItemModalState = ({
  open,
  shopId,
  onListingCreated
}: {
  open: boolean
  shopId?: string
  onListingCreated?: (listing?: ItemListingSummary) => void
}): AddItemModalState => {
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

  const [formState, setFormState] = useState<ListingFormState>(emptyFormState())
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
  const walletConnected = Boolean(walletAddress)

  const resetForm = useCallback(() => {
    setFormState(emptyFormState())
    setTransactionState({ status: "idle" })
    setHasAttemptedSubmit(false)
    resetFieldState()
  }, [resetFieldState])

  useEffect(() => {
    if (!open) return
    resetForm()
  }, [open, resetForm])

  const handleInputChange = useCallback(
    <K extends keyof ListingFormState>(key: K, value: ListingFormState[K]) => {
      markFieldChange(key)
      setFormState((previous) => ({
        ...previous,
        [key]: value
      }))
    },
    [markFieldChange]
  )

  const shouldShowFieldError = useCallback(
    <K extends keyof ListingFormState>(
      key: K,
      error?: string
    ): error is string =>
      Boolean(error && shouldShowFieldFeedback(key, hasAttemptedSubmit)),
    [hasAttemptedSubmit, shouldShowFieldFeedback]
  )

  const handleAddItem = useCallback(async () => {
    setHasAttemptedSubmit(true)

    if (!walletAddress || !shopId) {
      setTransactionState({
        status: "error",
        error: "Wallet and shop details are required to add a listing."
      })
      return
    }

    if (hasFieldErrors) return

    const expectedChain = `sui:${network}` as IdentifierString
    const accountChains = currentAccount?.chains ?? []
    const localnetSupported = walletSupportsChain(
      currentWallet ?? currentAccount ?? undefined,
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
        transactionBlock = await waitForTransactionBlock(suiClient, digest)
      }

      const listingId = findAddedItemListingId(transactionBlock)

      setTransactionState({
        status: "success",
        summary: {
          ...listingInputs,
          digest,
          transactionBlock,
          listingId
        }
      })

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
  }, [
    currentAccount,
    currentWallet,
    formState,
    hasFieldErrors,
    isLocalnet,
    localnetExecutor,
    network,
    onListingCreated,
    shopId,
    signAndExecuteTransaction,
    suiClient,
    walletAddress
  ])

  const isSuccessState = transactionState.status === "success"
  const isErrorState = transactionState.status === "error"
  const transactionSummary = isSuccessState
    ? transactionState.summary
    : undefined

  return {
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
    walletConnected,
    explorerUrl,
    handleAddItem,
    handleInputChange,
    markFieldBlur,
    shouldShowFieldError,
    resetForm
  }
}
