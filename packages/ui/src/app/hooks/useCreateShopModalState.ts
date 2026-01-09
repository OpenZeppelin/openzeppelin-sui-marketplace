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
import { buildCreateShopTransaction } from "@sui-oracle-market/domain-core/ptb/shop"
import { ENetwork } from "@sui-oracle-market/tooling-core/types"
import { useCallback, useEffect, useMemo, useState } from "react"
import { EXPLORER_URL_VARIABLE_NAME, LOCALNET_RPC_URL } from "../config/network"
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
import { extractCreatedObjects } from "../helpers/transactionFormat"
import { waitForTransactionBlock } from "../helpers/transactionWait"
import { useIdleFieldValidation } from "./useIdleFieldValidation"
import useNetworkConfig from "./useNetworkConfig"

type ShopFormState = {
  shopName: string
}

export type CreateShopTransactionSummary = {
  shopName: string
  digest: string
  transactionBlock: SuiTransactionBlockResponse
  shopId?: string
}

type TransactionState =
  | { status: "idle" }
  | { status: "processing" }
  | { status: "success"; summary: CreateShopTransactionSummary }
  | { status: "error"; error: string; details?: string }

const emptyFormState = (): ShopFormState => ({
  shopName: ""
})

type ShopFieldErrors = Partial<Record<keyof ShopFormState, string>>

const buildShopFieldErrors = (formState: ShopFormState): ShopFieldErrors => {
  const errors: ShopFieldErrors = {}
  const shopName = formState.shopName.trim()
  if (!shopName) errors.shopName = "Shop name is required."
  return errors
}

type CreateShopModalState = {
  formState: ShopFormState
  fieldErrors: ShopFieldErrors
  transactionState: TransactionState
  transactionSummary?: CreateShopTransactionSummary
  isSuccessState: boolean
  isErrorState: boolean
  canSubmit: boolean
  walletConnected: boolean
  explorerUrl?: string
  handleCreateShop: () => Promise<void>
  handleInputChange: <K extends keyof ShopFormState>(
    key: K,
    value: ShopFormState[K]
  ) => void
  markFieldBlur: (key: keyof ShopFormState) => void
  shouldShowFieldError: <K extends keyof ShopFormState>(
    key: K,
    error?: string
  ) => error is string
  resetForm: () => void
}

export const useCreateShopModalState = ({
  open,
  packageId,
  onShopCreated
}: {
  open: boolean
  packageId?: string
  onShopCreated?: (shopId: string) => void
}): CreateShopModalState => {
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
        signTransaction: (input) =>
          signTransaction.mutateAsync(
            currentAccount ? { ...input, account: currentAccount } : input
          )
      }),
    [currentAccount, localnetClient, signTransaction]
  )

  const [formState, setFormState] = useState<ShopFormState>(emptyFormState())
  const [transactionState, setTransactionState] = useState<TransactionState>({
    status: "idle"
  })
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const {
    markFieldChange,
    markFieldBlur,
    resetFieldState,
    shouldShowFieldFeedback
  } = useIdleFieldValidation<keyof ShopFormState>({ idleDelayMs: 600 })

  const walletAddress = currentAccount?.address

  const fieldErrors = useMemo(
    () => buildShopFieldErrors(formState),
    [formState]
  )
  const hasFieldErrors = Object.values(fieldErrors).some(Boolean)

  const isSubmissionPending = isLocalnet
    ? signTransaction.isPending
    : signAndExecuteTransaction.isPending

  const canSubmit =
    Boolean(walletAddress && packageId && !hasFieldErrors) &&
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
    <K extends keyof ShopFormState>(key: K, value: ShopFormState[K]) => {
      markFieldChange(key)
      setFormState((previous) => ({
        ...previous,
        [key]: value
      }))
    },
    [markFieldChange]
  )

  const shouldShowFieldError = useCallback(
    <K extends keyof ShopFormState>(key: K, error?: string): error is string =>
      Boolean(error && shouldShowFieldFeedback(key, hasAttemptedSubmit)),
    [hasAttemptedSubmit, shouldShowFieldFeedback]
  )

  const handleCreateShop = useCallback(async () => {
    setHasAttemptedSubmit(true)

    if (!walletAddress || !packageId) {
      setTransactionState({
        status: "error",
        error: "Wallet and package details are required to create a shop."
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

    const appOrigin =
      typeof window === "undefined" ? undefined : window.location.origin
    const shopName = formState.shopName.trim()
    const requestContext = {
      action: "create_shop",
      shopName,
      packageId,
      appNetwork: network,
      expectedChain,
      isLocalnet,
      appOrigin,
      localnetRpcUrl: isLocalnet ? LOCALNET_RPC_URL : undefined
    }

    setTransactionState({ status: "processing" })

    let failureStage: "prepare" | "execute" | "fetch" = "prepare"

    try {
      const createShopTransaction = buildCreateShopTransaction({
        packageId,
        shopName
      })
      createShopTransaction.setSender(walletAddress)

      let digest = ""
      let transactionBlock: SuiTransactionBlockResponse

      if (isLocalnet) {
        failureStage = "execute"
        const result = await localnetExecutor(createShopTransaction, {
          chain: expectedChain
        })
        digest = result.digest
        transactionBlock = result
      } else {
        failureStage = "execute"
        const result = await signAndExecuteTransaction.mutateAsync({
          transaction: createShopTransaction,
          chain: expectedChain
        })

        failureStage = "fetch"
        digest = result.digest
        transactionBlock = await waitForTransactionBlock(suiClient, digest)
      }

      const shopId = extractCreatedObjects(transactionBlock).find((change) =>
        change.objectType.endsWith("::shop::Shop")
      )?.objectId

      setTransactionState({
        status: "success",
        summary: {
          shopName,
          digest,
          transactionBlock,
          shopId
        }
      })

      if (shopId) {
        onShopCreated?.(shopId)
      }
    } catch (error) {
      const errorDetails = extractErrorDetails(error)
      const localnetSupportNote =
        isLocalnet && !localnetSupported && failureStage === "execute"
          ? "Wallet may not support sui:localnet signing."
          : undefined
      const errorPayload = {
        summary: errorDetails,
        raw: serializeForJson(error),
        failureStage,
        localnetSupportNote,
        walletContext,
        requestContext
      }
      const errorDetailsRaw = safeJsonStringify(errorPayload, 2)
      const formattedError = formatErrorMessage(error)
      const errorMessage = localnetSupportNote
        ? `${formattedError} ${localnetSupportNote}`
        : formattedError
      console.error("Create shop transaction failed", errorPayload)
      setTransactionState({
        status: "error",
        error: errorMessage,
        details: errorDetailsRaw
      })
    }
  }, [
    currentAccount,
    currentWallet,
    formState.shopName,
    hasFieldErrors,
    isLocalnet,
    localnetExecutor,
    network,
    onShopCreated,
    packageId,
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
    handleCreateShop,
    handleInputChange,
    markFieldBlur,
    shouldShowFieldError,
    resetForm
  }
}
