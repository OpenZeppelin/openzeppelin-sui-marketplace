"use client"

import {
  useCurrentAccount,
  useCurrentWallet,
  useSignAndExecuteTransaction,
  useSignTransaction,
  useSuiClient,
  useSuiClientContext
} from "@mysten/dapp-kit"
import type { IdentifierString } from "@mysten/wallet-standard"
import type {
  DiscountTemplateSummary,
  DiscountTicketDetails
} from "@sui-oracle-market/domain-core/models/discount"
import {
  findCreatedDiscountTicketId,
  parseDiscountTicketFromObject
} from "@sui-oracle-market/domain-core/models/discount"
import { buildClaimDiscountTicketTransaction } from "@sui-oracle-market/domain-core/ptb/discount-ticket"
import { SUI_CLOCK_ID } from "@sui-oracle-market/tooling-core/constants"
import {
  deriveRelevantPackageId,
  getSuiObject
} from "@sui-oracle-market/tooling-core/object"
import { getSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { ENetwork } from "@sui-oracle-market/tooling-core/types"
import { useCallback, useMemo, useState } from "react"
import { EXPLORER_URL_VARIABLE_NAME } from "../config/network"
import { getLocalnetClient, makeLocalnetExecutor } from "../helpers/localnet"
import { notification } from "../helpers/notification"
import { transactionUrl } from "../helpers/network"
import { extractCreatedObjects } from "../helpers/transactionFormat"
import { formatErrorMessage } from "../helpers/transactionErrors"
import { waitForTransactionBlock } from "../helpers/transactionWait"
import useNetworkConfig from "./useNetworkConfig"

type ClaimState =
  | { status: "idle" }
  | { status: "processing"; templateId: string }
  | { status: "error"; error: string }

type ClaimDiscountTicketAction = {
  claimState: ClaimState
  claimingTemplateId?: string
  isClaiming: boolean
  handleClaimDiscount: (template: DiscountTemplateSummary) => Promise<void>
}

export const useClaimDiscountTicketAction = ({
  shopId,
  onClaimed
}: {
  shopId?: string
  onClaimed?: (ticket?: DiscountTicketDetails) => void
}): ClaimDiscountTicketAction => {
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

  const [claimState, setClaimState] = useState<ClaimState>({
    status: "idle"
  })

  const walletAddress = currentAccount?.address
  const expectedChain = `sui:${network}` as IdentifierString
  const isSubmissionPending = isLocalnet
    ? signTransaction.isPending
    : signAndExecuteTransaction.isPending
  const isClaiming =
    claimState.status === "processing" || isSubmissionPending === true
  const claimingTemplateId =
    claimState.status === "processing" ? claimState.templateId : undefined

  const handleClaimDiscount = useCallback(
    async (template: DiscountTemplateSummary) => {
      if (isClaiming) return

      if (!walletAddress) {
        const error = "Connect a wallet before claiming a discount."
        setClaimState({ status: "error", error })
        notification.error(undefined, error)
        return
      }

      if (!shopId) {
        const error = "A shop id is required to claim this discount."
        setClaimState({ status: "error", error })
        notification.error(undefined, error)
        return
      }

      if (template.status !== "active") {
        const error = "This discount template is not active."
        setClaimState({ status: "error", error })
        notification.error(undefined, error)
        return
      }

      const accountChains = currentAccount?.chains ?? []
      const chainMismatch =
        accountChains.length > 0 && !accountChains.includes(expectedChain)

      if (!isLocalnet && chainMismatch) {
        const error = `Wallet chain mismatch. Switch your wallet to ${network}.`
        setClaimState({ status: "error", error })
        notification.error(undefined, error)
        return
      }

      if (!currentWallet) {
        const error = "No wallet connected. Connect a wallet to continue."
        setClaimState({ status: "error", error })
        notification.error(undefined, error)
        return
      }

      const toastId = notification.txLoading()
      setClaimState({
        status: "processing",
        templateId: template.discountTemplateId
      })

      try {
        const shopShared = await getSuiSharedObject(
          { objectId: shopId, mutable: true },
          { suiClient }
        )
        const discountTemplateShared = await getSuiSharedObject(
          { objectId: template.discountTemplateId, mutable: true },
          { suiClient }
        )
        const clockShared = await getSuiSharedObject(
          { objectId: SUI_CLOCK_ID, mutable: false },
          { suiClient }
        )
        const shopPackageId = deriveRelevantPackageId(shopShared.object.type)

        const claimTransaction = buildClaimDiscountTicketTransaction({
          packageId: shopPackageId,
          shopShared,
          discountTemplateShared,
          sharedClockObject: clockShared
        })
        claimTransaction.setSender(walletAddress)

        let transactionBlock

        if (isLocalnet) {
          transactionBlock = await localnetExecutor(claimTransaction, {
            chain: expectedChain
          })
        } else {
          const result = await signAndExecuteTransaction.mutateAsync({
            transaction: claimTransaction,
            chain: expectedChain
          })

          transactionBlock = await waitForTransactionBlock(
            suiClient,
            result.digest
          )
        }

        const createdTicketId = findCreatedDiscountTicketId(
          extractCreatedObjects(transactionBlock)
        )

        let claimedTicket: DiscountTicketDetails | undefined

        if (createdTicketId) {
          try {
            const { object } = await getSuiObject(
              { objectId: createdTicketId, options: { showContent: true } },
              { suiClient }
            )
            claimedTicket = parseDiscountTicketFromObject(object)
          } catch (ticketError) {
            console.warn("Unable to hydrate claimed ticket", ticketError)
          }
        }

        if (explorerUrl) {
          notification.txSuccess(
            transactionUrl(explorerUrl, transactionBlock.digest),
            toastId
          )
        } else {
          notification.success("Transaction submitted", toastId)
        }

        setClaimState({ status: "idle" })
        onClaimed?.(claimedTicket)
      } catch (error) {
        const formattedError = formatErrorMessage(error)
        const errorObject = error instanceof Error ? error : undefined
        setClaimState({ status: "error", error: formattedError })
        notification.txError(errorObject, formattedError, toastId)
      }
    },
    [
      currentAccount,
      currentWallet,
      explorerUrl,
      expectedChain,
      isClaiming,
      isLocalnet,
      localnetExecutor,
      network,
      onClaimed,
      shopId,
      signAndExecuteTransaction,
      suiClient,
      walletAddress
    ]
  )

  return {
    claimState,
    claimingTemplateId,
    isClaiming,
    handleClaimDiscount
  }
}
