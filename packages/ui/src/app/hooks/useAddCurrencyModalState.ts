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
  normalizeCoinType,
  MAX_CONFIDENCE_RATIO_BPS_CAP,
  MAX_PRICE_AGE_SECS_CAP,
  MAX_PRICE_STATUS_LAG_SECS_CAP,
  parseAcceptedCurrencyGuardrailValue
} from "@sui-oracle-market/domain-core/models/currency"
import { buildAddAcceptedCurrencyTransaction } from "@sui-oracle-market/domain-core/ptb/currency"
import { resolveCurrencyObjectId } from "@sui-oracle-market/tooling-core/coin-registry"
import {
  assertBytesLength,
  ensureHexPrefix,
  hexToBytes
} from "@sui-oracle-market/tooling-core/hex"
import { deriveRelevantPackageId } from "@sui-oracle-market/tooling-core/object"
import { getSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { ENetwork } from "@sui-oracle-market/tooling-core/types"
import { parseOptionalPositiveU64 } from "@sui-oracle-market/tooling-core/utils/utility"
import { useCallback, useEffect, useMemo, useState } from "react"
import { EXPLORER_URL_VARIABLE_NAME } from "../config/network"
import { getStructLabel, shortenId } from "../helpers/format"
import {
  getLocalnetClient,
  makeLocalnetExecutor,
  walletSupportsChain
} from "../helpers/localnet"
import { resolveOwnerCapabilityId } from "../helpers/ownerCapabilities"
import {
  resolveCoinTypeInput,
  validateCoinType,
  validateOptionalSuiObjectId,
  validateRequiredHexBytes,
  validateRequiredSuiObjectId
} from "../helpers/inputValidation"
import {
  extractErrorDetails,
  formatErrorMessage,
  safeJsonStringify,
  serializeForJson
} from "../helpers/transactionErrors"
import { extractCreatedObjects } from "../helpers/transactionFormat"
import useNetworkConfig from "./useNetworkConfig"
import { useIdleFieldValidation } from "./useIdleFieldValidation"

type CurrencyFormState = {
  coinType: string
  feedId: string
  priceInfoObjectId: string
  currencyObjectId: string
  maxPriceAgeSecsCap: string
  maxConfidenceRatioBpsCap: string
  maxPriceStatusLagSecsCap: string
}

type CurrencyInputs = {
  coinType: string
  feedIdHex: string
  feedIdBytes: number[]
  priceInfoObjectId: string
  currencyObjectId?: string
  maxPriceAgeSecsCap?: bigint
  maxConfidenceRatioBpsCap?: bigint
  maxPriceStatusLagSecsCap?: bigint
}

export type CurrencyTransactionSummary = Omit<
  CurrencyInputs,
  "currencyObjectId"
> & {
  currencyObjectId: string
  digest: string
  transactionBlock: SuiTransactionBlockResponse
  acceptedCurrencyId?: string
}

type TransactionState =
  | { status: "idle" }
  | { status: "processing" }
  | { status: "success"; summary: CurrencyTransactionSummary }
  | { status: "error"; error: string; details?: string }

const emptyFormState = (): CurrencyFormState => ({
  coinType: "",
  feedId: "",
  priceInfoObjectId: "",
  currencyObjectId: "",
  maxPriceAgeSecsCap: "",
  maxConfidenceRatioBpsCap: "",
  maxPriceStatusLagSecsCap: ""
})

type CurrencyFieldErrors = Partial<Record<keyof CurrencyFormState, string>>
type CurrencyFieldWarnings = Partial<Record<keyof CurrencyFormState, string>>

const buildCurrencyFieldErrors = (
  formState: CurrencyFormState
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
  if (feedIdError) errors.feedId = feedIdError

  const priceInfoError = validateRequiredSuiObjectId(
    formState.priceInfoObjectId,
    "Price info object id"
  )
  if (priceInfoError) errors.priceInfoObjectId = priceInfoError

  const priceAgeResult = parseAcceptedCurrencyGuardrailValue(
    formState.maxPriceAgeSecsCap,
    "Max price age"
  )
  if (priceAgeResult.error) errors.maxPriceAgeSecsCap = priceAgeResult.error

  const confidenceResult = parseAcceptedCurrencyGuardrailValue(
    formState.maxConfidenceRatioBpsCap,
    "Max confidence"
  )
  if (confidenceResult.error)
    errors.maxConfidenceRatioBpsCap = confidenceResult.error

  const statusLagResult = parseAcceptedCurrencyGuardrailValue(
    formState.maxPriceStatusLagSecsCap,
    "Max status lag"
  )
  if (statusLagResult.error)
    errors.maxPriceStatusLagSecsCap = statusLagResult.error

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

  const confidenceResult = parseAcceptedCurrencyGuardrailValue(
    formState.maxConfidenceRatioBpsCap,
    "Max confidence"
  )
  if (
    confidenceResult.value !== undefined &&
    confidenceResult.value > MAX_CONFIDENCE_RATIO_BPS_CAP
  ) {
    warnings.maxConfidenceRatioBpsCap = `Will be clamped to ${MAX_CONFIDENCE_RATIO_BPS_CAP.toString()} bps.`
  }

  const statusLagResult = parseAcceptedCurrencyGuardrailValue(
    formState.maxPriceStatusLagSecsCap,
    "Max status lag"
  )
  if (
    statusLagResult.value !== undefined &&
    statusLagResult.value > MAX_PRICE_STATUS_LAG_SECS_CAP
  ) {
    warnings.maxPriceStatusLagSecsCap = `Will be clamped to ${MAX_PRICE_STATUS_LAG_SECS_CAP.toString()} seconds.`
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
  const priceInfoObjectId = normalizeSuiObjectId(
    formState.priceInfoObjectId.trim()
  )
  const currencyObjectId = trimToOptional(formState.currencyObjectId)

  return {
    coinType,
    feedIdHex,
    feedIdBytes,
    priceInfoObjectId,
    currencyObjectId: currencyObjectId
      ? normalizeSuiObjectId(currencyObjectId)
      : undefined,
    maxPriceAgeSecsCap: parseOptionalPositiveU64(
      trimToOptional(formState.maxPriceAgeSecsCap),
      "maxPriceAgeSecsCap"
    ),
    maxConfidenceRatioBpsCap: parseOptionalPositiveU64(
      trimToOptional(formState.maxConfidenceRatioBpsCap),
      "maxConfidenceRatioBpsCap"
    ),
    maxPriceStatusLagSecsCap: parseOptionalPositiveU64(
      trimToOptional(formState.maxPriceStatusLagSecsCap),
      "maxPriceStatusLagSecsCap"
    )
  }
}

type GuardrailPreview = {
  maxPriceAgeSecsCap: string
  maxConfidenceRatioBpsCap: string
  maxPriceStatusLagSecsCap: string
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
  isSuccessState: boolean
  isErrorState: boolean
  canSubmit: boolean
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
  onCurrencyCreated
}: {
  open: boolean
  shopId?: string
  onCurrencyCreated?: (currency?: AcceptedCurrencySummary) => void
}): AddCurrencyModalState => {
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
    () => buildCurrencyFieldErrors(formState),
    [formState]
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
    if (!formState.priceInfoObjectId.trim()) return "Enter price info object id"
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
        : "Default",
      maxPriceStatusLagSecsCap: formState.maxPriceStatusLagSecsCap.trim()
        ? formState.maxPriceStatusLagSecsCap.trim()
        : "Default"
    }),
    [
      formState.maxConfidenceRatioBpsCap,
      formState.maxPriceAgeSecsCap,
      formState.maxPriceStatusLagSecsCap
    ]
  )

  const isSubmissionPending = isLocalnet
    ? signTransaction.isPending
    : signAndExecuteTransaction.isPending

  const canSubmit =
    Boolean(walletAddress && shopId && !hasFieldErrors) &&
    transactionState.status !== "processing" &&
    isSubmissionPending !== true

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
      const priceInfoShared = await getSuiSharedObject(
        { objectId: currencyInputs.priceInfoObjectId, mutable: false },
        { suiClient }
      )

      const addCurrencyTransaction = buildAddAcceptedCurrencyTransaction({
        packageId: shopPackageId,
        shop: shopShared,
        ownerCapId: ownerCapabilityId,
        coinType: currencyInputs.coinType,
        currency: currencyShared,
        feedIdBytes: currencyInputs.feedIdBytes,
        pythObjectId: priceInfoShared.object.objectId,
        priceInfoObject: priceInfoShared,
        maxPriceAgeSecsCap: currencyInputs.maxPriceAgeSecsCap,
        maxConfidenceRatioBpsCap: currencyInputs.maxConfidenceRatioBpsCap,
        maxPriceStatusLagSecsCap: currencyInputs.maxPriceStatusLagSecsCap
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

      const acceptedCurrencyId = extractCreatedObjects(transactionBlock).find(
        (change) => change.objectType.includes("::shop::AcceptedCurrency")
      )?.objectId

      const optimisticCurrency = acceptedCurrencyId
        ? {
            acceptedCurrencyId,
            markerObjectId: acceptedCurrencyId,
            coinType: currencyInputs.coinType,
            symbol: undefined,
            decimals: undefined,
            feedIdHex: currencyInputs.feedIdHex,
            pythObjectId: currencyInputs.priceInfoObjectId,
            maxPriceAgeSecsCap: currencyInputs.maxPriceAgeSecsCap?.toString(),
            maxConfidenceRatioBpsCap:
              currencyInputs.maxConfidenceRatioBpsCap?.toString(),
            maxPriceStatusLagSecsCap:
              currencyInputs.maxPriceStatusLagSecsCap?.toString()
          }
        : undefined

      setTransactionState({
        status: "success",
        summary: {
          ...currencyInputs,
          currencyObjectId: resolvedCurrencyObjectId,
          digest,
          transactionBlock,
          acceptedCurrencyId
        }
      })

      onCurrencyCreated?.(optimisticCurrency)

      if (acceptedCurrencyId) {
        void getAcceptedCurrencySummary(
          resolvedShopId,
          acceptedCurrencyId,
          suiClient
        )
          .then((summary) => onCurrencyCreated?.(summary))
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
  }
}
