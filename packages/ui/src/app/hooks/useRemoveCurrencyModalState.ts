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
import type { AcceptedCurrencySummary } from "@sui-oracle-market/domain-core/models/currency"
import { buildRemoveAcceptedCurrencyTransaction } from "@sui-oracle-market/domain-core/ptb/currency"
import { deriveRelevantPackageId } from "@sui-oracle-market/tooling-core/object"
import { getSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { ENetwork } from "@sui-oracle-market/tooling-core/types"
import { useCallback, useEffect, useMemo, useState } from "react"
import { EXPLORER_URL_VARIABLE_NAME } from "../config/network"
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
import useNetworkConfig from "./useNetworkConfig"

export type RemoveCurrencyTransactionSummary = {
  currency: AcceptedCurrencySummary
  digest: string
  transactionBlock: SuiTransactionBlockResponse
}

type TransactionState =
  | { status: "idle" }
  | { status: "processing" }
  | { status: "success"; summary: RemoveCurrencyTransactionSummary }
  | { status: "error"; error: string; details?: string }

type RemoveCurrencyModalState = {
  transactionState: TransactionState
  transactionSummary?: RemoveCurrencyTransactionSummary
  isSuccessState: boolean
  isErrorState: boolean
  canSubmit: boolean
  explorerUrl?: string
  handleRemoveCurrency: () => Promise<void>
  resetState: () => void
}

export const useRemoveCurrencyModalState = ({
  open,
  shopId,
  currency,
  onCurrencyRemoved
}: {
  open: boolean
  shopId?: string
  currency?: AcceptedCurrencySummary | null
  onCurrencyRemoved?: (currencyId?: string) => void
}): RemoveCurrencyModalState => {
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

  const [transactionState, setTransactionState] = useState<TransactionState>({
    status: "idle"
  })

  const walletAddress = currentAccount?.address
  const isSubmissionPending = isLocalnet
    ? signTransaction.isPending
    : signAndExecuteTransaction.isPending

  const canSubmit =
    Boolean(walletAddress && shopId && currency?.acceptedCurrencyId) &&
    transactionState.status !== "processing" &&
    isSubmissionPending !== true

  const resetState = useCallback(() => {
    setTransactionState({ status: "idle" })
  }, [])

  useEffect(() => {
    if (!open) return
    resetState()
  }, [open, currency?.acceptedCurrencyId, resetState])

  const handleRemoveCurrency = useCallback(async () => {
    if (!walletAddress || !shopId || !currency) {
      setTransactionState({
        status: "error",
        error: "Wallet, shop, and currency details are required to remove."
      })
      return
    }

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
      const shopShared = await getSuiSharedObject(
        { objectId: shopId, mutable: true },
        { suiClient }
      )
      const shopPackageId = deriveRelevantPackageId(shopShared.object.type)
      const ownerCapabilityId = await resolveOwnerCapabilityId({
        shopId: shopShared.object.objectId,
        shopPackageId,
        ownerAddress: walletAddress,
        suiClient
      })
      const currencyShared = await getSuiSharedObject(
        { objectId: currency.acceptedCurrencyId, mutable: false },
        { suiClient }
      )

      const removeCurrencyTransaction = buildRemoveAcceptedCurrencyTransaction({
        packageId: shopPackageId,
        shop: shopShared,
        ownerCapId: ownerCapabilityId,
        acceptedCurrency: currencyShared
      })
      removeCurrencyTransaction.setSender(walletAddress)

      let digest = ""
      let transactionBlock: SuiTransactionBlockResponse

      if (isLocalnet) {
        failureStage = "execute"
        const result = await localnetExecutor(removeCurrencyTransaction, {
          chain: expectedChain
        })
        digest = result.digest
        transactionBlock = result
      } else {
        failureStage = "execute"
        const result = await signAndExecuteTransaction.mutateAsync({
          transaction: removeCurrencyTransaction,
          chain: expectedChain
        })

        failureStage = "fetch"
        digest = result.digest
        transactionBlock = await waitForTransactionBlock(suiClient, digest)
      }

      setTransactionState({
        status: "success",
        summary: {
          currency,
          digest,
          transactionBlock
        }
      })

      onCurrencyRemoved?.(currency.acceptedCurrencyId)
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
    currency,
    isLocalnet,
    localnetExecutor,
    network,
    onCurrencyRemoved,
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
    transactionState,
    transactionSummary,
    isSuccessState,
    isErrorState,
    canSubmit,
    explorerUrl,
    handleRemoveCurrency,
    resetState
  }
}
