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
import type { DiscountTemplateSummary } from "@sui-oracle-market/domain-core/models/discount"
import { getDiscountTemplateSummary } from "@sui-oracle-market/domain-core/models/discount"
import { buildToggleDiscountTemplateTransaction } from "@sui-oracle-market/domain-core/ptb/discount-template"
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
import useNetworkConfig from "./useNetworkConfig"

export type RemoveDiscountTransactionSummary = {
  template: DiscountTemplateSummary
  digest: string
  transactionBlock: SuiTransactionBlockResponse
}

type TransactionState =
  | { status: "idle" }
  | { status: "processing" }
  | { status: "success"; summary: RemoveDiscountTransactionSummary }
  | { status: "error"; error: string; details?: string }

type RemoveDiscountModalState = {
  transactionState: TransactionState
  transactionSummary?: RemoveDiscountTransactionSummary
  isSuccessState: boolean
  isErrorState: boolean
  canSubmit: boolean
  explorerUrl?: string
  handleDisableDiscount: () => Promise<void>
  resetState: () => void
}

const buildDisabledTemplateSnapshot = (
  template: DiscountTemplateSummary
): DiscountTemplateSummary => ({
  ...template,
  activeFlag: false,
  status: "disabled"
})

export const useRemoveDiscountModalState = ({
  open,
  shopId,
  template,
  onDiscountUpdated
}: {
  open: boolean
  shopId?: string
  template?: DiscountTemplateSummary | null
  onDiscountUpdated?: (template?: DiscountTemplateSummary) => void
}): RemoveDiscountModalState => {
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
    Boolean(
      walletAddress &&
      shopId &&
      template?.discountTemplateId &&
      template?.activeFlag
    ) &&
    transactionState.status !== "processing" &&
    isSubmissionPending !== true

  const resetState = useCallback(() => {
    setTransactionState({ status: "idle" })
  }, [])

  useEffect(() => {
    if (!open) return
    resetState()
  }, [open, template?.discountTemplateId, resetState])

  const handleDisableDiscount = useCallback(async () => {
    if (!walletAddress || !shopId || !template) {
      setTransactionState({
        status: "error",
        error: "Wallet, shop, and discount details are required to remove."
      })
      return
    }
    if (!template.activeFlag) {
      setTransactionState({
        status: "error",
        error: "This discount template is already disabled."
      })
      return
    }

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
      const shopShared = await getSuiSharedObject(
        { objectId: shopId, mutable: false },
        { suiClient }
      )
      const shopPackageId = deriveRelevantPackageId(shopShared.object.type)
      const ownerCapabilityId = await resolveOwnerCapabilityId({
        shopId: shopShared.object.objectId,
        shopPackageId,
        ownerAddress: walletAddress,
        suiClient
      })
      const discountShared = await getSuiSharedObject(
        { objectId: template.discountTemplateId, mutable: true },
        { suiClient }
      )

      const disableDiscountTransaction = buildToggleDiscountTemplateTransaction(
        {
          packageId: shopPackageId,
          shop: shopShared,
          discountTemplate: discountShared,
          active: false,
          ownerCapId: ownerCapabilityId
        }
      )
      disableDiscountTransaction.setSender(walletAddress)

      let digest = ""
      let transactionBlock: SuiTransactionBlockResponse

      if (isLocalnet) {
        failureStage = "execute"
        const result = await localnetExecutor(disableDiscountTransaction, {
          chain: expectedChain
        })
        digest = result.digest
        transactionBlock = result
      } else {
        failureStage = "execute"
        const result = await signAndExecuteTransaction.mutateAsync({
          transaction: disableDiscountTransaction,
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

      const disabledTemplate = buildDisabledTemplateSnapshot(template)
      setTransactionState({
        status: "success",
        summary: {
          template: disabledTemplate,
          digest,
          transactionBlock
        }
      })

      onDiscountUpdated?.(disabledTemplate)

      void getDiscountTemplateSummary(
        shopShared.object.objectId,
        template.discountTemplateId,
        suiClient
      )
        .then((summary) => onDiscountUpdated?.(summary))
        .catch(() => {})
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
    isLocalnet,
    localnetExecutor,
    network,
    onDiscountUpdated,
    shopId,
    signAndExecuteTransaction,
    suiClient,
    template,
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
    handleDisableDiscount,
    resetState
  }
}
