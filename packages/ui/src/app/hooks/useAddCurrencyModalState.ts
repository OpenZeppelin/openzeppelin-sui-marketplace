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
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import type { IdentifierString } from "@mysten/wallet-standard"
import type { AcceptedCurrencySummary } from "@sui-oracle-market/domain-core/models/currency"
import {
  getAcceptedCurrencySummary,
  MAX_CONFIDENCE_RATIO_BPS_CAP,
  MAX_PRICE_AGE_SECS_CAP,
  normalizeCoinType,
  parseAcceptedCurrencyBpsValue,
  parseAcceptedCurrencyGuardrailValue
} from "@sui-oracle-market/domain-core/models/currency"
import {
  createPythClientForNetwork,
  resolvePythPriceInfoObjectId
} from "@sui-oracle-market/domain-core/models/pyth-feeds"
import { buildAddAcceptedCurrencyTransaction } from "@sui-oracle-market/domain-core/ptb/currency"
import { resolveCurrencyObjectId } from "@sui-oracle-market/tooling-core/coin-registry"
import {
  assertBytesLength,
  ensureHexPrefix,
  hexToBytes,
  normalizeHex
} from "@sui-oracle-market/tooling-core/hex"
import { deriveRelevantPackageId } from "@sui-oracle-market/tooling-core/object"
import { getSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { ENetwork } from "@sui-oracle-market/tooling-core/types"
import {
  parseOptionalPositiveU16,
  parseOptionalPositiveU64
} from "@sui-oracle-market/tooling-core/utils/utility"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  EXPLORER_URL_VARIABLE_NAME,
  PYTH_STATE_ID_VARIABLE_NAME
} from "../config/network"
import { getStructLabel, shortenId } from "../helpers/format"
import {
  resolveCoinTypeInput,
  validateCoinType,
  validateOptionalSuiObjectId,
  validateRequiredHexBytes
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

type CurrencyFormState = {
  coinType: string
  feedId: string
  priceInfoObjectId: string
  currencyObjectId: string
  maxPriceAgeSecsCap: string
  maxConfidenceRatioBpsCap: string
}

type CurrencyInputs = {
  coinType: string
  feedIdHex: string
  feedIdBytes: number[]
  priceInfoObjectId?: string
  currencyObjectId?: string
  maxPriceAgeSecsCap?: bigint
  maxConfidenceRatioBpsCap?: number
}

export type CurrencyTransactionSummary = Omit<
  CurrencyInputs,
  "currencyObjectId" | "priceInfoObjectId"
> & {
  currencyObjectId: string
  priceInfoObjectId: string
  digest: string
  transactionBlock: SuiTransactionBlockResponse
  tableEntryFieldId?: string
}

type TransactionState =
  | { status: "idle" }
  | { status: "processing" }
  | { status: "success"; summary: CurrencyTransactionSummary; warning?: string }
  | { status: "error"; error: string; details?: string }

const emptyFormState = (): CurrencyFormState => ({
  coinType: "",
  feedId: "",
  priceInfoObjectId: "",
  currencyObjectId: "",
  maxPriceAgeSecsCap: "",
  maxConfidenceRatioBpsCap: ""
})

type CurrencyFieldErrors = Partial<Record<keyof CurrencyFormState, string>>
type CurrencyFieldWarnings = Partial<Record<keyof CurrencyFormState, string>>

// Finds an already-registered currency that uses `feedId`. The shop enforces
// one currency per feed on-chain (aborting with `EFeedIdentifierExists`), so
// we surface the collision as a field error before submitting rather than after
// a failed tx.
const findFeedCollision = (
  feedId: string,
  acceptedCurrencies: AcceptedCurrencySummary[]
): AcceptedCurrencySummary | undefined => {
  let normalizedFeedId: string
  try {
    normalizedFeedId = normalizeHex(ensureHexPrefix(feedId.trim()))
  } catch {
    return undefined
  }
  return acceptedCurrencies.find((currency) => {
    try {
      return normalizeHex(currency.feedIdHex) === normalizedFeedId
    } catch {
      return false
    }
  })
}

const buildCurrencyFieldErrors = (
  formState: CurrencyFormState,
  acceptedCurrencies: AcceptedCurrencySummary[]
): CurrencyFieldErrors => {
  const errors: CurrencyFieldErrors = {}

  const coinTypeError = validateCoinType(formState.coinType, "Coin type")
  if (coinTypeError) errors.coinType = coinTypeError

  const currencyObjectIdError = validateOptionalSuiObjectId(
    formState.currencyObjectId,
    "Currency registry id"
  )
  if (currencyObjectIdError) errors.currencyObjectId = currencyObjectIdError

  const feedIdError = validateRequiredHexBytes({
    value: formState.feedId,
    expectedBytes: 32,
    label: "Pyth feed id"
  })
  if (feedIdError) {
    errors.feedId = feedIdError
  } else {
    const feedCollision = findFeedCollision(
      formState.feedId,
      acceptedCurrencies
    )
    if (feedCollision)
      errors.feedId = `Feed already used by ${getStructLabel(
        feedCollision.coinType
      )}. Each feed can back only one currency.`
  }

  const priceInfoError = validateOptionalSuiObjectId(
    formState.priceInfoObjectId,
    "Price info object id"
  )
  if (priceInfoError) errors.priceInfoObjectId = priceInfoError

  const priceAgeResult = parseAcceptedCurrencyGuardrailValue(
    formState.maxPriceAgeSecsCap,
    "Max price age"
  )
  if (priceAgeResult.error) errors.maxPriceAgeSecsCap = priceAgeResult.error

  const confidenceResult = parseAcceptedCurrencyBpsValue(
    formState.maxConfidenceRatioBpsCap,
    "Max confidence"
  )
  if (confidenceResult.error)
    errors.maxConfidenceRatioBpsCap = confidenceResult.error

  return errors
}

const buildCurrencyFieldWarnings = (
  formState: CurrencyFormState
): CurrencyFieldWarnings => {
  const warnings: CurrencyFieldWarnings = {}

  const priceAgeResult = parseAcceptedCurrencyGuardrailValue(
    formState.maxPriceAgeSecsCap,
    "Max price age"
  )
  if (
    priceAgeResult.value !== undefined &&
    priceAgeResult.value > MAX_PRICE_AGE_SECS_CAP
  ) {
    warnings.maxPriceAgeSecsCap = `Will be clamped to ${MAX_PRICE_AGE_SECS_CAP.toString()} seconds.`
  }

  const confidenceResult = parseAcceptedCurrencyBpsValue(
    formState.maxConfidenceRatioBpsCap,
    "Max confidence"
  )
  if (
    confidenceResult.value !== undefined &&
    confidenceResult.value > MAX_CONFIDENCE_RATIO_BPS_CAP
  ) {
    warnings.maxConfidenceRatioBpsCap = `Will be clamped to ${MAX_CONFIDENCE_RATIO_BPS_CAP.toString()} bps.`
  }

  return warnings
}

const trimToOptional = (value: string) => {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const parseCurrencyInputs = (formState: CurrencyFormState): CurrencyInputs => {
  const coinType = normalizeCoinType(resolveCoinTypeInput(formState.coinType))
  const feedIdHex = ensureHexPrefix(formState.feedId.trim())
  const feedIdBytes = assertBytesLength(hexToBytes(feedIdHex), 32)
  const priceInfoObjectId = trimToOptional(formState.priceInfoObjectId)
  const currencyObjectId = trimToOptional(formState.currencyObjectId)

  return {
    coinType,
    feedIdHex,
    feedIdBytes,
    priceInfoObjectId: priceInfoObjectId
      ? normalizeSuiObjectId(priceInfoObjectId)
      : undefined,
    currencyObjectId: currencyObjectId
      ? normalizeSuiObjectId(currencyObjectId)
      : undefined,
    maxPriceAgeSecsCap: parseOptionalPositiveU64(
      trimToOptional(formState.maxPriceAgeSecsCap),
      "maxPriceAgeSecsCap"
    ),
    maxConfidenceRatioBpsCap: parseOptionalPositiveU16(
      trimToOptional(formState.maxConfidenceRatioBpsCap),
      "maxConfidenceRatioBpsCap"
    )
  }
}

type GuardrailPreview = {
  maxPriceAgeSecsCap: string
  maxConfidenceRatioBpsCap: string
}

type AddCurrencyModalState = {
  formState: CurrencyFormState
  fieldErrors: CurrencyFieldErrors
  fieldWarnings: CurrencyFieldWarnings
  coinTypeLabel: string
  feedIdPreview: string
  priceInfoPreview: string
  registryPreview: string
  guardrailPreview: GuardrailPreview
  transactionState: TransactionState
  transactionSummary?: CurrencyTransactionSummary
  transactionWarning?: string
  isSuccessState: boolean
  isErrorState: boolean
  canSubmit: boolean
  walletConnected: boolean
  explorerUrl?: string
  handleAddCurrency: () => Promise<void>
  handleInputChange: <K extends keyof CurrencyFormState>(
    key: K,
    value: CurrencyFormState[K]
  ) => void
  markFieldBlur: (key: keyof CurrencyFormState) => void
  shouldShowFieldError: <K extends keyof CurrencyFormState>(
    key: K,
    error?: string
  ) => error is string
  shouldShowFieldWarning: <K extends keyof CurrencyFormState>(
    key: K,
    warning?: string
  ) => warning is string
  resetForm: () => void
}

export const useAddCurrencyModalState = ({
  open,
  shopId,
  acceptedCurrencies = [],
  onCurrencyCreated
}: {
  open: boolean
  shopId?: string
  acceptedCurrencies?: AcceptedCurrencySummary[]
  onCurrencyCreated?: (currency?: AcceptedCurrencySummary) => void
}): AddCurrencyModalState => {
  const currentAccount = useCurrentAccount()
  const { currentWallet } = useCurrentWallet()
  const suiClient = useSuiClient()
  const { network } = useSuiClientContext()
  const { useNetworkVariable } = useNetworkConfig()
  const explorerUrl = useNetworkVariable(EXPLORER_URL_VARIABLE_NAME)
  // Localnet mock Pyth `State` id (empty on real networks). Used to resolve the
  // PriceInfoObject from the feed id, since shops no longer store an on-chain
  // pyth object id.
  const localnetPythStateId = useNetworkVariable(PYTH_STATE_ID_VARIABLE_NAME)
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

  const [formState, setFormState] =
    useState<CurrencyFormState>(emptyFormState())
  const [transactionState, setTransactionState] = useState<TransactionState>({
    status: "idle"
  })
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const {
    markFieldChange,
    markFieldBlur,
    resetFieldState,
    shouldShowFieldFeedback
  } = useIdleFieldValidation<keyof CurrencyFormState>({ idleDelayMs: 600 })

  const walletAddress = currentAccount?.address

  const fieldErrors = useMemo(
    () => buildCurrencyFieldErrors(formState, acceptedCurrencies),
    [formState, acceptedCurrencies]
  )
  const fieldWarnings = useMemo(
    () => buildCurrencyFieldWarnings(formState),
    [formState]
  )
  const hasFieldErrors = Object.values(fieldErrors).some(Boolean)

  const coinTypeLabel = useMemo(
    () =>
      formState.coinType.trim()
        ? getStructLabel(formState.coinType)
        : "Coin type",
    [formState.coinType]
  )

  const feedIdPreview = useMemo(() => {
    if (!formState.feedId.trim()) return "Enter feed id"
    try {
      return shortenId(ensureHexPrefix(formState.feedId.trim()), 10, 8)
    } catch {
      return "Invalid feed id"
    }
  }, [formState.feedId])

  const priceInfoPreview = useMemo(() => {
    if (!formState.priceInfoObjectId.trim()) return "Resolve from feed id"
    return shortenId(formState.priceInfoObjectId.trim())
  }, [formState.priceInfoObjectId])

  const registryPreview = useMemo(() => {
    if (formState.currencyObjectId.trim())
      return shortenId(formState.currencyObjectId.trim())
    if (!formState.coinType.trim()) return "Enter coin type"
    return "Resolve from registry"
  }, [formState.coinType, formState.currencyObjectId])

  const guardrailPreview = useMemo(
    () => ({
      maxPriceAgeSecsCap: formState.maxPriceAgeSecsCap.trim()
        ? formState.maxPriceAgeSecsCap.trim()
        : "Default",
      maxConfidenceRatioBpsCap: formState.maxConfidenceRatioBpsCap.trim()
        ? formState.maxConfidenceRatioBpsCap.trim()
        : "Default"
    }),
    [formState.maxConfidenceRatioBpsCap, formState.maxPriceAgeSecsCap]
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
    <K extends keyof CurrencyFormState>(
      key: K,
      value: CurrencyFormState[K]
    ) => {
      markFieldChange(key)
      setFormState((previous) => ({
        ...previous,
        [key]: value
      }))
    },
    [markFieldChange]
  )

  const shouldShowFieldError = useCallback(
    <K extends keyof CurrencyFormState>(
      key: K,
      error?: string
    ): error is string =>
      Boolean(error && shouldShowFieldFeedback(key, hasAttemptedSubmit)),
    [hasAttemptedSubmit, shouldShowFieldFeedback]
  )

  const shouldShowFieldWarning = useCallback(
    <K extends keyof CurrencyFormState>(
      key: K,
      warning?: string
    ): warning is string =>
      Boolean(warning && shouldShowFieldFeedback(key, hasAttemptedSubmit)),
    [hasAttemptedSubmit, shouldShowFieldFeedback]
  )

  const handleAddCurrency = useCallback(async () => {
    setHasAttemptedSubmit(true)

    if (!walletAddress || !shopId) {
      setTransactionState({
        status: "error",
        error: "Wallet and shop details are required to add a currency."
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
      const currencyInputs = parseCurrencyInputs(formState)
      const resolvedCurrencyObjectId =
        currencyInputs.currencyObjectId ??
        (await resolveCurrencyObjectId(
          { coinType: currencyInputs.coinType, fallbackRegistryScan: true },
          { suiClient }
        ))

      if (!resolvedCurrencyObjectId)
        throw new Error(
          `Could not resolve currency registry entry for ${currencyInputs.coinType}. Provide the currency registry id or register the coin first.`
        )
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
      const currencyShared = await getSuiSharedObject(
        { objectId: resolvedCurrencyObjectId, mutable: false },
        { suiClient }
      )

      // Resolve the PriceInfoObject from the feed id (the source of truth). A
      // manually entered price info object id is optional and only cross-checked
      // against the resolved one here.
      const pythClient = createPythClientForNetwork({
        suiClient,
        networkName: network,
        localnetPythStateId: localnetPythStateId || undefined
      })
      const resolvedPriceInfoObjectId = pythClient
        ? await resolvePythPriceInfoObjectId({
            pythClient,
            feedId: currencyInputs.feedIdHex
          })
        : undefined
      const providedPriceInfoObjectId = currencyInputs.priceInfoObjectId

      if (
        providedPriceInfoObjectId &&
        resolvedPriceInfoObjectId &&
        providedPriceInfoObjectId !== resolvedPriceInfoObjectId
      )
        throw new Error(
          `Provided price info object id ${providedPriceInfoObjectId} does not match the id resolved from feed ${currencyInputs.feedIdHex} (${resolvedPriceInfoObjectId}). Leave it blank to use the resolved object, or correct the id.`
        )

      const priceInfoObjectId =
        resolvedPriceInfoObjectId ?? providedPriceInfoObjectId

      if (!priceInfoObjectId)
        throw new Error(
          `Could not resolve a PriceInfoObject for feed ${currencyInputs.feedIdHex} on ${network}. Provide the price info object id explicitly or ensure the feed is registered with Pyth.`
        )

      const priceInfoShared = await getSuiSharedObject(
        { objectId: priceInfoObjectId, mutable: false },
        { suiClient }
      )

      const addCurrencyTransaction = buildAddAcceptedCurrencyTransaction({
        packageId: shopPackageId,
        shop: shopShared,
        ownerCapId: ownerCapabilityId,
        coinType: currencyInputs.coinType,
        currency: currencyShared,
        feedIdBytes: currencyInputs.feedIdBytes,
        priceInfoObject: priceInfoShared,
        maxPriceAgeSecsCap: currencyInputs.maxPriceAgeSecsCap,
        maxConfidenceRatioBpsCap: currencyInputs.maxConfidenceRatioBpsCap
      })
      addCurrencyTransaction.setSender(walletAddress)

      let digest = ""
      let transactionBlock: SuiTransactionBlockResponse

      if (isLocalnet) {
        failureStage = "execute"
        const result = await localnetExecutor(addCurrencyTransaction, {
          chain: expectedChain
        })
        digest = result.digest
        transactionBlock = result
      } else {
        failureStage = "execute"
        const result = await signAndExecuteTransaction.mutateAsync({
          transaction: addCurrencyTransaction,
          chain: expectedChain
        })

        failureStage = "fetch"
        digest = result.digest
        transactionBlock = await waitForTransactionBlock(suiClient, digest)
      }

      let acceptedCurrencySummary: AcceptedCurrencySummary | undefined
      let acceptedCurrencySummaryWarning: string | undefined
      try {
        acceptedCurrencySummary = await getAcceptedCurrencySummary(
          resolvedShopId,
          currencyInputs.coinType,
          suiClient
        )
      } catch (summaryError) {
        acceptedCurrencySummaryWarning = [
          "Currency was added, but the accepted-currency summary could not be refreshed.",
          formatErrorMessage(summaryError)
        ].join(" ")
        console.warn(
          "Failed to refresh accepted currency summary after currency-add transaction.",
          {
            shopId: resolvedShopId,
            coinType: currencyInputs.coinType,
            digest,
            summaryError: serializeForJson(summaryError)
          }
        )
      }

      setTransactionState({
        status: "success",
        warning: acceptedCurrencySummaryWarning,
        summary: {
          ...currencyInputs,
          currencyObjectId: resolvedCurrencyObjectId,
          priceInfoObjectId,
          digest,
          transactionBlock,
          tableEntryFieldId: acceptedCurrencySummary?.tableEntryFieldId
        }
      })

      onCurrencyCreated?.(acceptedCurrencySummary)
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
      // Map the shop's duplicate-registration aborts to clear messages. The coin
      // type collision aborts with `ECurrencyTypeExists` and a feed already bound
      // to another currency aborts with `EFeedIdentifierExists`. This is a safety
      // net for the race where another registration lands between load and submit
      // -- the field-level checks catch the common case.
      const isFeedConflict =
        /feed identifier exists|EFeedIdentifierExists/i.test(formattedError)
      const isCoinTypeConflict =
        /currency type exists|ECurrencyTypeExists/i.test(formattedError)
      const baseError = isFeedConflict
        ? "This Pyth feed is already used by another accepted currency in this shop. Each feed can back only one currency."
        : isCoinTypeConflict
          ? "This coin type is already registered in this shop."
          : formattedError
      const errorMessage = localnetSupportNote
        ? `${baseError} ${localnetSupportNote}`
        : baseError
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
    localnetPythStateId,
    network,
    onCurrencyCreated,
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
  const transactionWarning = isSuccessState
    ? transactionState.warning
    : undefined

  return {
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
    transactionWarning,
    isSuccessState,
    isErrorState,
    canSubmit,
    walletConnected,
    explorerUrl,
    handleAddCurrency,
    handleInputChange,
    markFieldBlur,
    shouldShowFieldError,
    shouldShowFieldWarning,
    resetForm
  }
}
