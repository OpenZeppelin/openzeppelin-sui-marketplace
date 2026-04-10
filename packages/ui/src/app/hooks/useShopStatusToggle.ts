"use client"

import {
  useCurrentAccount,
  useCurrentWallet,
  useSignAndExecuteTransaction,
  useSignTransaction,
  useSuiClient,
  useSuiClientContext
} from "@mysten/dapp-kit"
import { normalizeSuiAddress } from "@mysten/sui/utils"
import type { IdentifierString } from "@mysten/wallet-standard"
import { getShopOverview } from "@sui-oracle-market/domain-core/models/shop"
import { buildToggleShopTransaction } from "@sui-oracle-market/domain-core/ptb/shop"
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
import { notification } from "../helpers/notification"
import { resolveOwnerCapabilityId } from "../helpers/ownerCapabilities"
import { transactionUrl } from "../helpers/network"
import { waitForTransactionBlock } from "../helpers/transactionWait"
import {
  formatErrorMessage,
  safeJsonStringify,
  serializeForJson
} from "../helpers/transactionErrors"
import useNetworkConfig from "./useNetworkConfig"

export const useShopStatusToggle = ({
  shopId,
  selectedShopOwnerAddress
}: {
  shopId?: string
  selectedShopOwnerAddress?: string
}) => {
  const currentAccount = useCurrentAccount()
  const { currentWallet } = useCurrentWallet()
  const suiClient = useSuiClient()
  const { network } = useSuiClientContext()
  const signAndExecuteTransaction = useSignAndExecuteTransaction()
  const signTransaction = useSignTransaction()
  const { useNetworkVariable } = useNetworkConfig()
  const explorerUrl = useNetworkVariable(EXPLORER_URL_VARIABLE_NAME)
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

  const [shopActive, setShopActive] = useState<boolean | undefined>(undefined)
  const [shopOwnerAddress, setShopOwnerAddress] = useState<string | undefined>(
    undefined
  )
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)

  const walletAddress = currentAccount?.address

  const normalizedOwnerAddress = shopOwnerAddress
    ? normalizeSuiAddress(shopOwnerAddress)
    : selectedShopOwnerAddress
      ? normalizeSuiAddress(selectedShopOwnerAddress)
      : undefined
  const normalizedWalletAddress = walletAddress
    ? normalizeSuiAddress(walletAddress)
    : undefined

  const isShopOwner = Boolean(
    normalizedOwnerAddress &&
    normalizedWalletAddress &&
    normalizedOwnerAddress === normalizedWalletAddress
  )

  const refreshShopOverview = useCallback(async () => {
    if (!shopId) {
      setShopActive(undefined)
      setShopOwnerAddress(undefined)
      return
    }

    setIsRefreshing(true)
    try {
      const overview = await getShopOverview(shopId, suiClient)
      setShopActive(overview.active)
      setShopOwnerAddress(overview.ownerAddress)
    } catch {
      setShopActive(undefined)
      setShopOwnerAddress(undefined)
    } finally {
      setIsRefreshing(false)
    }
  }, [shopId, suiClient])

  useEffect(() => {
    void refreshShopOverview()
  }, [refreshShopOverview])

  const toggleShopStatus = useCallback(async () => {
    if (!walletAddress || !shopId || !currentWallet) {
      notification.error(
        undefined,
        "Connect your wallet to toggle shop status."
      )
      return
    }
    if (!isShopOwner || shopActive === undefined) {
      notification.error(
        undefined,
        "Only the shop owner can toggle this shop status."
      )
      return
    }

    const loadingNotificationId = notification.txLoading()

    const expectedChain = `sui:${network}` as IdentifierString
    const accountChains = currentAccount?.chains ?? []
    const localnetSupported = walletSupportsChain(
      currentWallet ?? currentAccount ?? undefined,
      expectedChain
    )
    const chainMismatch =
      accountChains.length > 0 && !accountChains.includes(expectedChain)

    if (!isLocalnet && chainMismatch) {
      notification.txError(
        undefined,
        `Wallet chain mismatch. Switch your wallet to ${network}.`,
        loadingNotificationId
      )
      return
    }

    setIsProcessing(true)
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

      const nextActive = !shopActive
      const transaction = buildToggleShopTransaction({
        packageId: shopPackageId,
        shop: shopShared,
        ownerCapId: ownerCapabilityId,
        active: nextActive
      })
      transaction.setSender(walletAddress)

      let digest: string

      if (isLocalnet) {
        const result = await localnetExecutor(transaction, {
          chain: expectedChain
        })
        digest = result.digest
      } else {
        const result = await signAndExecuteTransaction.mutateAsync({
          transaction,
          chain: expectedChain
        })
        digest = result.digest
        await waitForTransactionBlock(suiClient, result.digest)
      }

      const txLabel = `Shop ${nextActive ? "enabled" : "disabled"} on chain.`
      if (explorerUrl) {
        notification.txSuccess(
          transactionUrl(explorerUrl, digest),
          loadingNotificationId
        )
      } else {
        notification.success(txLabel, loadingNotificationId)
      }

      setShopActive(nextActive)
      await refreshShopOverview()
    } catch (error) {
      const localnetSupportNote =
        isLocalnet && !localnetSupported
          ? "Wallet may not support sui:localnet signing."
          : ""
      const formattedError = formatErrorMessage(error)
      const userMessage = localnetSupportNote
        ? `${formattedError} ${localnetSupportNote}`
        : formattedError
      console.error(
        "Toggle shop transaction failed",
        safeJsonStringify(
          {
            error: serializeForJson(error),
            shopId,
            ownerAddress: walletAddress,
            network,
            expectedChain
          },
          2
        )
      )
      notification.txError(undefined, userMessage, loadingNotificationId)
    } finally {
      setIsProcessing(false)
    }
  }, [
    explorerUrl,
    currentAccount,
    currentWallet,
    isLocalnet,
    isShopOwner,
    localnetExecutor,
    network,
    refreshShopOverview,
    shopActive,
    shopId,
    signAndExecuteTransaction,
    suiClient,
    walletAddress
  ])

  return {
    shopActive,
    shopOwnerAddress,
    isShopOwner,
    isRefreshing,
    isProcessing,
    canToggleShop: Boolean(
      shopId && walletAddress && isShopOwner && shopActive !== undefined
    ),
    toggleShopStatus,
    refreshShopOverview
  }
}
