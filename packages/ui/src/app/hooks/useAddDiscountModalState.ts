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
import {
  defaultStartTimestampSeconds,
  deriveTemplateStatus,
  DISCOUNT_TEMPLATE_TYPE_FRAGMENT,
  getDiscountTemplateSummary,
  parseDiscountRuleKind,
  parseDiscountRuleValue,
  validateDiscountSchedule,
  type DiscountRuleKindLabel,
  type DiscountTemplateSummary,
  type NormalizedRuleKind
} from "@sui-oracle-market/domain-core/models/discount"
import { buildCreateDiscountTemplateTransaction } from "@sui-oracle-market/domain-core/ptb/discount-template"
import {
  deriveRelevantPackageId,
  normalizeOptionalId
} from "@sui-oracle-market/tooling-core/object"
import { getSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { ENetwork } from "@sui-oracle-market/tooling-core/types"
import {
  parseNonNegativeU64,
  parseOptionalU64
} from "@sui-oracle-market/tooling-core/utils/utility"
import { useCallback, useEffect, useMemo, useState } from "react"
import { EXPLORER_URL_VARIABLE_NAME } from "../config/network"
import { formatDiscountRulePreview } from "../helpers/discountPreview"
import {
  resolveValidationMessage,
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
import { extractCreatedObjects } from "../helpers/transactionFormat"
import { waitForTransactionBlock } from "../helpers/transactionWait"
import { useIdleFieldValidation } from "./useIdleFieldValidation"
import useNetworkConfig from "./useNetworkConfig"

type DiscountFormState = {
  ruleKind: DiscountRuleKindLabel
  ruleValue: string
  startsAt: string
  expiresAt: string
  maxRedemptions: string
  appliesToListingId: string
}

type DiscountInputs = {
  ruleKind: NormalizedRuleKind
  ruleValue: bigint
  startsAt: bigint
  expiresAt?: bigint
  maxRedemptions?: bigint
  appliesToListingId?: string
}

export type DiscountTransactionSummary = DiscountInputs & {
  digest: string
  transactionBlock: SuiTransactionBlockResponse
  discountTemplateId?: string
}

type TransactionState =
  | { status: "idle" }
  | { status: "processing" }
  | { status: "success"; summary: DiscountTransactionSummary }
  | { status: "error"; error: string; details?: string }

const emptyFormState = (): DiscountFormState => ({
  ruleKind: "fixed",
  ruleValue: "",
  startsAt: defaultStartTimestampSeconds().toString(),
  expiresAt: "",
  maxRedemptions: "",
  appliesToListingId: ""
})

type DiscountFieldErrors = Partial<Record<keyof DiscountFormState, string>>

const buildDiscountFieldErrors = (
  formState: DiscountFormState
): DiscountFieldErrors => {
  const errors: DiscountFieldErrors = {}
  const ruleValue = formState.ruleValue.trim()
  const startsAt = formState.startsAt.trim()
  const expiresAt = formState.expiresAt.trim()
  const maxRedemptions = formState.maxRedemptions.trim()

  let normalizedRuleKind: NormalizedRuleKind | undefined
  try {
    normalizedRuleKind = parseDiscountRuleKind(formState.ruleKind)
  } catch (error) {
    errors.ruleKind = resolveValidationMessage(
      error,
      "Select a valid rule type."
    )
  }

  if (!ruleValue) {
    errors.ruleValue = "Rule value is required."
  } else if (normalizedRuleKind !== undefined) {
    try {
      parseDiscountRuleValue(normalizedRuleKind, ruleValue)
    } catch (error) {
      errors.ruleValue = resolveValidationMessage(
        error,
        "Enter a valid discount value."
      )
    }
  }

  if (!startsAt) {
    errors.startsAt = "Start time is required."
  } else {
    try {
      parseNonNegativeU64(startsAt, "Start time")
    } catch (error) {
      errors.startsAt = resolveValidationMessage(
        error,
        "Start time must be a valid u64."
      )
    }
  }

  if (expiresAt) {
    try {
      parseNonNegativeU64(expiresAt, "Expiry")
    } catch (error) {
      errors.expiresAt = resolveValidationMessage(
        error,
        "Expiry must be a valid u64."
      )
    }
  }

  if (!errors.startsAt && !errors.expiresAt) {
    try {
      const normalizedStartsAt = parseNonNegativeU64(startsAt, "Start time")
      const normalizedExpiresAt = expiresAt
        ? parseNonNegativeU64(expiresAt, "Expiry")
        : undefined
      validateDiscountSchedule(normalizedStartsAt, normalizedExpiresAt)
    } catch (error) {
      errors.expiresAt = resolveValidationMessage(
        error,
        "Expiry must be after the start time."
      )
    }
  }

  if (maxRedemptions) {
    try {
      parseOptionalU64(maxRedemptions, "Max redemptions")
    } catch (error) {
      errors.maxRedemptions = resolveValidationMessage(
        error,
        "Max redemptions must be a valid u64."
      )
    }
  }

  const listingError = validateOptionalSuiObjectId(
    formState.appliesToListingId,
    "Listing id"
  )
  if (listingError) errors.appliesToListingId = listingError

  return errors
}

const parseDiscountInputs = (formState: DiscountFormState): DiscountInputs => {
  const ruleKind = parseDiscountRuleKind(formState.ruleKind)
  const ruleValue = parseDiscountRuleValue(ruleKind, formState.ruleValue)
  const startsAt = parseNonNegativeU64(formState.startsAt, "startsAt")
  const expiresAt = parseOptionalU64(
    formState.expiresAt.trim() || undefined,
    "expiresAt"
  )
  const maxRedemptions = parseOptionalU64(
    formState.maxRedemptions.trim() || undefined,
    "maxRedemptions"
  )

  validateDiscountSchedule(startsAt, expiresAt)

  return {
    ruleKind,
    ruleValue,
    startsAt,
    expiresAt,
    maxRedemptions,
    appliesToListingId: normalizeOptionalId(
      formState.appliesToListingId.trim() || undefined
    )
  }
}

type AddDiscountModalState = {
  formState: DiscountFormState
  fieldErrors: DiscountFieldErrors
  transactionState: TransactionState
  transactionSummary?: DiscountTransactionSummary
  isSuccessState: boolean
  isErrorState: boolean
  canSubmit: boolean
  walletConnected: boolean
  explorerUrl?: string
  handleAddDiscount: () => Promise<void>
  handleInputChange: <K extends keyof DiscountFormState>(
    key: K,
    value: DiscountFormState[K]
  ) => void
  markFieldBlur: (key: keyof DiscountFormState) => void
  shouldShowFieldError: <K extends keyof DiscountFormState>(
    key: K,
    error?: string
  ) => error is string
  resetForm: () => void
}

export const useAddDiscountModalState = ({
  open,
  shopId,
  onDiscountCreated
}: {
  open: boolean
  shopId?: string
  onDiscountCreated?: (template?: DiscountTemplateSummary) => void
}): AddDiscountModalState => {
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
    useState<DiscountFormState>(emptyFormState())
  const [transactionState, setTransactionState] = useState<TransactionState>({
    status: "idle"
  })
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const {
    markFieldChange,
    markFieldBlur,
    resetFieldState,
    shouldShowFieldFeedback
  } = useIdleFieldValidation<keyof DiscountFormState>({ idleDelayMs: 600 })

  const walletAddress = currentAccount?.address

  const fieldErrors = useMemo(
    () => buildDiscountFieldErrors(formState),
    [formState]
  )
  const hasFieldErrors = Object.values(fieldErrors).some(Boolean)

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
    <K extends keyof DiscountFormState>(
      key: K,
      value: DiscountFormState[K]
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
    <K extends keyof DiscountFormState>(
      key: K,
      error?: string
    ): error is string =>
      Boolean(error && shouldShowFieldFeedback(key, hasAttemptedSubmit)),
    [hasAttemptedSubmit, shouldShowFieldFeedback]
  )

  const handleAddDiscount = useCallback(async () => {
    setHasAttemptedSubmit(true)

    if (!walletAddress || !shopId) {
      setTransactionState({
        status: "error",
        error: "Wallet and shop details are required to create a discount."
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
      const discountInputs = parseDiscountInputs(formState)
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

      const createDiscountTransaction = buildCreateDiscountTemplateTransaction({
        packageId: shopPackageId,
        shop: shopShared,
        appliesToListingId: discountInputs.appliesToListingId,
        ruleKind: discountInputs.ruleKind,
        ruleValue: discountInputs.ruleValue,
        startsAt: discountInputs.startsAt,
        expiresAt: discountInputs.expiresAt,
        maxRedemptions: discountInputs.maxRedemptions,
        ownerCapId: ownerCapabilityId
      })
      createDiscountTransaction.setSender(walletAddress)

      let digest = ""
      let transactionBlock: SuiTransactionBlockResponse

      if (isLocalnet) {
        failureStage = "execute"
        const result = await localnetExecutor(createDiscountTransaction, {
          chain: expectedChain
        })
        digest = result.digest
        transactionBlock = result
      } else {
        failureStage = "execute"
        const result = await signAndExecuteTransaction.mutateAsync({
          transaction: createDiscountTransaction,
          chain: expectedChain
        })

        failureStage = "fetch"
        digest = result.digest
        transactionBlock = await waitForTransactionBlock(suiClient, digest)
      }

      const discountTemplateId = extractCreatedObjects(transactionBlock).find(
        (change) => change.objectType.endsWith(DISCOUNT_TEMPLATE_TYPE_FRAGMENT)
      )?.objectId

      const optimisticTemplate = discountTemplateId
        ? {
            discountTemplateId,
            markerObjectId: discountTemplateId,
            shopId: resolvedShopId,
            appliesToListingId: discountInputs.appliesToListingId,
            ruleDescription: formatDiscountRulePreview({
              ruleKind: discountInputs.ruleKind,
              ruleValue: discountInputs.ruleValue
            }),
            startsAt: discountInputs.startsAt.toString(),
            expiresAt: discountInputs.expiresAt?.toString(),
            maxRedemptions: discountInputs.maxRedemptions?.toString(),
            claimsIssued: "0",
            redemptions: "0",
            activeFlag: true,
            status: deriveTemplateStatus({
              activeFlag: true,
              startsAt: discountInputs.startsAt,
              expiresAt: discountInputs.expiresAt,
              maxRedemptions: discountInputs.maxRedemptions,
              redemptions: 0n
            })
          }
        : undefined

      setTransactionState({
        status: "success",
        summary: {
          ...discountInputs,
          digest,
          transactionBlock,
          discountTemplateId
        }
      })

      onDiscountCreated?.(optimisticTemplate)

      if (discountTemplateId) {
        void getDiscountTemplateSummary(
          resolvedShopId,
          discountTemplateId,
          suiClient
        )
          .then((summary) => onDiscountCreated?.(summary))
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
          localnetSupportNote
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
    onDiscountCreated,
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
    transactionState,
    transactionSummary,
    isSuccessState,
    isErrorState,
    canSubmit,
    walletConnected,
    explorerUrl,
    handleAddDiscount,
    handleInputChange,
    markFieldBlur,
    shouldShowFieldError,
    resetForm
  }
}
