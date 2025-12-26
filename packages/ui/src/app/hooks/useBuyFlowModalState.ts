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
import { normalizeSuiAddress } from "@mysten/sui/utils"
import {
  buildBuyTransaction,
  estimateRequiredAmount,
  resolveDiscountedPriceUsdCents,
  resolvePaymentCoinObjectId,
  type DiscountContext
} from "@sui-oracle-market/domain-core/flows/buy"
import type { AcceptedCurrencySummary } from "@sui-oracle-market/domain-core/models/currency"
import type {
  DiscountTemplateSummary,
  DiscountTicketDetails
} from "@sui-oracle-market/domain-core/models/discount"
import type { ItemListingSummary } from "@sui-oracle-market/domain-core/models/item-listing"
import { SUI_CLOCK_ID } from "@sui-oracle-market/tooling-core/constants"
import {
  deriveRelevantPackageId,
  normalizeIdOrThrow
} from "@sui-oracle-market/tooling-core/object"
import { getSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { ENetwork } from "@sui-oracle-market/tooling-core/types"
import { useCallback, useEffect, useMemo, useState } from "react"
import { EXPLORER_URL_VARIABLE_NAME } from "../config/network"
import { parseBalance } from "../helpers/balance"
import { buildDiscountTemplateLookup } from "../helpers/discountTemplates"
import { formatCoinBalance, getStructLabel, shortenId } from "../helpers/format"
import {
  getLocalnetClient,
  makeLocalnetExecutor,
  walletSupportsChain
} from "../helpers/localnet"
import { validateOptionalSuiAddress } from "../helpers/inputValidation"
import {
  extractErrorDetails,
  formatErrorMessage,
  safeJsonStringify,
  serializeForJson
} from "../helpers/transactionErrors"
import useNetworkConfig from "./useNetworkConfig"
import { useIdleFieldValidation } from "./useIdleFieldValidation"

type CurrencyBalance = AcceptedCurrencySummary & {
  balance: bigint
}

type DiscountOption = {
  id: string
  label: string
  description?: string
  status?: string
  disabled?: boolean
  selection: DiscountContext
}

type BuyFieldErrors = {
  currency?: string
  mintTo?: string
  refundTo?: string
}

const buildBuyFieldErrors = ({
  selectedCurrencyId,
  availableCurrencyCount,
  mintTo,
  refundTo
}: {
  selectedCurrencyId?: string
  availableCurrencyCount: number
  mintTo: string
  refundTo: string
}): BuyFieldErrors => {
  const errors: BuyFieldErrors = {}

  if (availableCurrencyCount > 0 && !selectedCurrencyId)
    errors.currency = "Select a payment currency."

  const mintToError = validateOptionalSuiAddress(mintTo, "Receipt recipient")
  if (mintToError) errors.mintTo = mintToError

  const refundToError = validateOptionalSuiAddress(refundTo, "Refund address")
  if (refundToError) errors.refundTo = refundToError

  return errors
}

export type TransactionSummary = {
  digest: string
  transactionBlock: SuiTransactionBlockResponse
  paymentCoinObjectId: string
  selectedCurrency: CurrencyBalance
  discountSelection: DiscountContext
  mintTo: string
  refundTo: string
}

type TransactionState =
  | { status: "idle" }
  | { status: "processing" }
  | { status: "success"; summary: TransactionSummary }
  | { status: "error"; error: string; details?: string }

type BalanceStatus =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success" }
  | { status: "error"; error: string }

const pickDefaultDiscountOptionId = (options: DiscountOption[]) => {
  const enabledOptions = options.filter((option) => !option.disabled)
  return enabledOptions[0]?.id ?? "none"
}

const buildDiscountOptions = ({
  listing,
  shopId,
  discountTemplates,
  discountTickets
}: {
  listing?: ItemListingSummary
  shopId?: string
  discountTemplates: DiscountTemplateSummary[]
  discountTickets: DiscountTicketDetails[]
}): DiscountOption[] => {
  if (!listing || !shopId) return []
  const templateLookup = buildDiscountTemplateLookup(discountTemplates)
  const spotlightTemplate = listing.spotlightTemplateId
    ? templateLookup[listing.spotlightTemplateId]
    : undefined

  const eligibleTickets = discountTickets.filter((ticket) => {
    if (ticket.shopAddress !== shopId) return false
    if (ticket.listingId && ticket.listingId !== listing.itemListingId)
      return false

    const template = templateLookup[ticket.discountTemplateId]
    if (
      template?.appliesToListingId &&
      template.appliesToListingId !== listing.itemListingId
    )
      return false

    return true
  })

  const ticketOptions = eligibleTickets.map((ticket) => {
    const template = templateLookup[ticket.discountTemplateId]
    const status = template?.status
    const isActive = status ? status === "active" : true

    return {
      id: `ticket:${ticket.discountTicketId}`,
      label: template?.ruleDescription || "Discount ticket",
      description: `Use ticket ${shortenId(ticket.discountTicketId)}${
        ticket.listingId ? " for this listing" : ""
      }.`,
      status,
      disabled: !isActive,
      selection: {
        mode: "ticket",
        discountTicketId: ticket.discountTicketId,
        discountTemplateId: ticket.discountTemplateId,
        ticketDetails: ticket
      }
    }
  })

  const claimOption =
    spotlightTemplate &&
    spotlightTemplate.status === "active" &&
    !eligibleTickets.some(
      (ticket) =>
        ticket.discountTemplateId === spotlightTemplate.discountTemplateId
    )
      ? [
          {
            id: "claim",
            label: spotlightTemplate.ruleDescription,
            description:
              "Claim a single-use ticket and redeem it in the same transaction.",
            status: spotlightTemplate.status,
            selection: {
              mode: "claim",
              discountTemplateId: spotlightTemplate.discountTemplateId
            }
          }
        ]
      : []

  return [
    {
      id: "none",
      label: "No discount",
      description: "Checkout without a discount ticket.",
      selection: { mode: "none" }
    },
    ...ticketOptions,
    ...claimOption
  ]
}

type BuyFlowModalState = {
  explorerUrl?: string
  walletAddress?: string
  balanceStatus: BalanceStatus
  availableCurrencies: CurrencyBalance[]
  discountOptions: DiscountOption[]
  hasDiscountOptions: boolean
  selectedCurrencyId?: string
  selectedDiscountId: string
  selectedCurrency?: CurrencyBalance
  selectedDiscount?: DiscountOption
  mintTo: string
  refundTo: string
  fieldErrors: BuyFieldErrors
  transactionState: TransactionState
  transactionSummary?: TransactionSummary
  isSuccessState: boolean
  isErrorState: boolean
  canSubmit: boolean
  oracleWarning?: string
  handlePurchase: () => Promise<void>
  resetTransactionState: () => void
  setSelectedCurrencyId: (value?: string) => void
  setSelectedDiscountId: (value: string) => void
  setMintTo: (value: string) => void
  setRefundTo: (value: string) => void
  markFieldChange: (key: keyof BuyFieldErrors) => void
  markFieldBlur: (key: keyof BuyFieldErrors) => void
  shouldShowFieldError: <K extends keyof BuyFieldErrors>(
    key: K,
    error?: string
  ) => error is string
}

export const useBuyFlowModalState = ({
  open,
  onClose,
  shopId,
  listing,
  acceptedCurrencies,
  discountTemplates,
  discountTickets
}: {
  open: boolean
  onClose: () => void
  shopId?: string
  listing?: ItemListingSummary
  acceptedCurrencies: AcceptedCurrencySummary[]
  discountTemplates: DiscountTemplateSummary[]
  discountTickets: DiscountTicketDetails[]
}): BuyFlowModalState => {
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

  const [balancesByType, setBalancesByType] = useState<Record<string, bigint>>(
    {}
  )
  const [balanceStatus, setBalanceStatus] = useState<BalanceStatus>({
    status: "idle"
  })
  const [selectedCurrencyId, setSelectedCurrencyId] = useState<string>()
  const [selectedDiscountId, setSelectedDiscountId] = useState("none")
  const [mintTo, setMintTo] = useState("")
  const [refundTo, setRefundTo] = useState("")
  const [transactionState, setTransactionState] = useState<TransactionState>({
    status: "idle"
  })
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const {
    markFieldChange,
    markFieldBlur,
    resetFieldState,
    shouldShowFieldFeedback
  } = useIdleFieldValidation<keyof BuyFieldErrors>({ idleDelayMs: 600 })
  const [oracleWarning, setOracleWarning] = useState<string>()
  const [lastWalletContext, setLastWalletContext] =
    useState<Record<string, unknown>>()

  const walletAddress = currentAccount?.address

  const currencyBalances = useMemo<CurrencyBalance[]>(
    () =>
      acceptedCurrencies.map((currency) => ({
        ...currency,
        balance: balancesByType[currency.coinType] ?? 0n
      })),
    [acceptedCurrencies, balancesByType]
  )

  const availableCurrencies = useMemo(
    () => currencyBalances.filter((currency) => currency.balance > 0n),
    [currencyBalances]
  )

  const discountTemplateLookup = useMemo(
    () => buildDiscountTemplateLookup(discountTemplates),
    [discountTemplates]
  )

  const discountOptions = useMemo(
    () =>
      buildDiscountOptions({
        listing,
        shopId,
        discountTemplates,
        discountTickets
      }),
    [listing, shopId, discountTemplates, discountTickets]
  )
  const hasDiscountOptions = discountOptions.some(
    (option) => option.id !== "none"
  )

  const selectedCurrency = useMemo(
    () =>
      availableCurrencies.find(
        (currency) => currency.acceptedCurrencyId === selectedCurrencyId
      ),
    [availableCurrencies, selectedCurrencyId]
  )

  const selectedDiscount = useMemo(
    () =>
      discountOptions.find((option) => option.id === selectedDiscountId) ??
      discountOptions[0],
    [discountOptions, selectedDiscountId]
  )

  const fieldErrors = useMemo(
    () =>
      buildBuyFieldErrors({
        selectedCurrencyId,
        availableCurrencyCount: availableCurrencies.length,
        mintTo,
        refundTo
      }),
    [availableCurrencies.length, mintTo, refundTo, selectedCurrencyId]
  )
  const hasFieldErrors = Object.values(fieldErrors).some(Boolean)

  const isSubmissionPending = isLocalnet
    ? signTransaction.isPending
    : signAndExecuteTransaction.isPending

  const canSubmit =
    Boolean(
      walletAddress &&
      shopId &&
      listing &&
      selectedCurrency &&
      selectedDiscount &&
      !hasFieldErrors
    ) &&
    transactionState.status !== "processing" &&
    isSubmissionPending !== true

  const isSuccessState = transactionState.status === "success"
  const isErrorState = transactionState.status === "error"
  const transactionSummary = isSuccessState
    ? transactionState.summary
    : undefined

  const resetTransactionState = useCallback(() => {
    setTransactionState({ status: "idle" })
    setOracleWarning(undefined)
  }, [])

  useEffect(() => {
    if (!open) return
    setTransactionState({ status: "idle" })
    setOracleWarning(undefined)
    setMintTo(walletAddress ?? "")
    setRefundTo(walletAddress ?? "")
    setHasAttemptedSubmit(false)
    resetFieldState()
  }, [open, listing?.itemListingId, walletAddress, resetFieldState])

  useEffect(() => {
    if (!open) {
      setBalancesByType({})
      setBalanceStatus({ status: "idle" })
      setSelectedCurrencyId(undefined)
      setSelectedDiscountId("none")
      return
    }

    if (!walletAddress || acceptedCurrencies.length === 0) return

    let isActive = true
    setBalanceStatus({ status: "loading" })

    const loadBalances = async () => {
      try {
        const balanceEntries = await Promise.all(
          acceptedCurrencies.map(async (currency) => {
            try {
              const balance = await suiClient.getBalance({
                owner: walletAddress,
                coinType: currency.coinType
              })
              return [
                currency.coinType,
                parseBalance(balance.totalBalance)
              ] as const
            } catch {
              return [currency.coinType, 0n] as const
            }
          })
        )

        if (!isActive) return
        setBalancesByType(Object.fromEntries(balanceEntries))
        setBalanceStatus({ status: "success" })
      } catch (error) {
        if (!isActive) return
        setBalanceStatus({
          status: "error",
          error: formatErrorMessage(error)
        })
      }
    }

    loadBalances()

    return () => {
      isActive = false
    }
  }, [open, walletAddress, acceptedCurrencies, suiClient])

  useEffect(() => {
    if (!open) return
    if (availableCurrencies.length === 0) {
      setSelectedCurrencyId(undefined)
      return
    }

    const isSelectedAvailable = availableCurrencies.some(
      (currency) => currency.acceptedCurrencyId === selectedCurrencyId
    )
    if (!isSelectedAvailable)
      setSelectedCurrencyId(availableCurrencies[0].acceptedCurrencyId)
  }, [availableCurrencies, open, selectedCurrencyId])

  useEffect(() => {
    if (!open) return
    if (discountOptions.length === 0) return

    const isSelectionValid = discountOptions.some(
      (option) => option.id === selectedDiscountId
    )
    if (!isSelectionValid)
      setSelectedDiscountId(pickDefaultDiscountOptionId(discountOptions))
  }, [discountOptions, open, selectedDiscountId])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [open, onClose])

  const shouldShowFieldError = useCallback(
    <K extends keyof BuyFieldErrors>(key: K, error?: string): error is string =>
      Boolean(error && shouldShowFieldFeedback(key, hasAttemptedSubmit)),
    [hasAttemptedSubmit, shouldShowFieldFeedback]
  )

  const handlePurchase = useCallback(async () => {
    setHasAttemptedSubmit(true)

    if (!walletAddress || !shopId || !listing)
      return setTransactionState({
        status: "error",
        error: "Wallet and listing details are required to purchase."
      })

    if (hasFieldErrors) return

    if (!selectedCurrency)
      return setTransactionState({
        status: "error",
        error: "Select a payment currency to continue."
      })

    if (!selectedDiscount)
      return setTransactionState({
        status: "error",
        error: "Select a discount option to continue."
      })

    const listingSnapshot = listing
    const currencySnapshot = selectedCurrency
    const discountSelection = selectedDiscount.selection

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

    setLastWalletContext(walletContext)

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
    setOracleWarning(undefined)

    let failureStage: "prepare" | "execute" | "fetch" = "prepare"

    try {
      const normalizedMintTo = normalizeSuiAddress(
        mintTo.trim() || walletAddress
      )
      const normalizedRefundTo = normalizeSuiAddress(
        refundTo.trim() || walletAddress
      )

      const shopShared = await getSuiSharedObject(
        { objectId: shopId, mutable: false },
        { suiClient }
      )
      const listingShared = await getSuiSharedObject(
        { objectId: listingSnapshot.itemListingId, mutable: true },
        { suiClient }
      )
      const acceptedCurrencyShared = await getSuiSharedObject(
        { objectId: currencySnapshot.acceptedCurrencyId, mutable: false },
        { suiClient }
      )
      const pythObjectId = normalizeIdOrThrow(
        currencySnapshot.pythObjectId,
        `AcceptedCurrency ${currencySnapshot.acceptedCurrencyId} is missing a pyth_object_id.`
      )
      const pythPriceInfoShared = await getSuiSharedObject(
        { objectId: pythObjectId, mutable: false },
        { suiClient }
      )

      const shopPackageId = deriveRelevantPackageId(shopShared.object.type)
      const clockShared = await getSuiSharedObject(
        { objectId: SUI_CLOCK_ID, mutable: false },
        { suiClient }
      )

      const discountedPriceUsdCents = resolveDiscountedPriceUsdCents({
        basePriceUsdCents: listingSnapshot.basePriceUsdCents,
        discountSelection,
        discountTemplateLookup
      })

      if (discountedPriceUsdCents !== undefined) {
        try {
          const requiredAmount = await estimateRequiredAmount({
            shopPackageId,
            shopShared,
            acceptedCurrencyShared,
            pythPriceInfoShared,
            priceUsdCents: discountedPriceUsdCents,
            maxPriceAgeSecs: undefined,
            maxConfidenceRatioBps: undefined,
            clockShared,
            signerAddress: walletAddress,
            suiClient
          })

          if (requiredAmount !== undefined) {
            const balance = selectedCurrency.balance
            if (balance < requiredAmount) {
              const shortfall = requiredAmount - balance
              const symbolLabel =
                selectedCurrency.symbol ??
                getStructLabel(selectedCurrency.coinType)
              const suffix = symbolLabel ? ` ${symbolLabel}` : ""
              const formatAmount = (value: bigint) =>
                formatCoinBalance({
                  balance: value,
                  decimals: selectedCurrency.decimals
                })

              setTransactionState({
                status: "error",
                error: `Insufficient ${symbolLabel || "balance"} to complete purchase. Balance: ${formatAmount(
                  balance
                )}${suffix}. Required: ${formatAmount(
                  requiredAmount
                )}${suffix}. Short by: ${formatAmount(shortfall)}${suffix}.`
              })
              return
            }
          }
        } catch {
          // Best-effort preflight; fall back to execution on inspection failure.
        }
      }

      const paymentCoinObjectId = await resolvePaymentCoinObjectId({
        providedCoinObjectId: undefined,
        coinType: currencySnapshot.coinType,
        signerAddress: walletAddress,
        suiClient
      })

      const buyTransaction = await buildBuyTransaction(
        {
          shopPackageId,
          shopShared,
          itemListingShared: listingShared,
          acceptedCurrencyShared,
          pythPriceInfoShared,
          pythFeedIdHex: currencySnapshot.feedIdHex,
          paymentCoinObjectId,
          coinType: currencySnapshot.coinType,
          itemType: listingSnapshot.itemType,
          mintTo: normalizedMintTo,
          refundTo: normalizedRefundTo,
          maxPriceAgeSecs: undefined,
          maxConfidenceRatioBps: undefined,
          discountContext: discountSelection,
          skipPriceUpdate: false,
          hermesUrlOverride: undefined,
          networkName: network,
          signerAddress: walletAddress,
          onWarning: (message) => setOracleWarning(message)
        },
        suiClient
      )

      let digest = ""
      let transactionBlock: SuiTransactionBlockResponse

      if (isLocalnet) {
        failureStage = "execute"
        const result = await localnetExecutor(buyTransaction, {
          chain: expectedChain
        })
        digest = result.digest
        transactionBlock = result
      } else {
        failureStage = "execute"
        const result = await signAndExecuteTransaction.mutateAsync({
          transaction: buyTransaction,
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

      setTransactionState({
        status: "success",
        summary: {
          digest,
          transactionBlock,
          paymentCoinObjectId,
          selectedCurrency: currencySnapshot,
          discountSelection,
          mintTo: normalizedMintTo,
          refundTo: normalizedRefundTo
        }
      })
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
          walletContext: lastWalletContext ?? walletContext
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
    acceptedCurrencies,
    currentAccount,
    currentWallet,
    discountTemplateLookup,
    discountOptions,
    discountTickets,
    hasFieldErrors,
    isLocalnet,
    lastWalletContext,
    listing,
    localnetExecutor,
    mintTo,
    network,
    refundTo,
    selectedCurrency,
    selectedDiscount,
    shopId,
    signAndExecuteTransaction,
    suiClient,
    walletAddress
  ])

  const setMintToValue = useCallback(
    (value: string) => {
      markFieldChange("mintTo")
      setMintTo(value)
    },
    [markFieldChange]
  )

  const setRefundToValue = useCallback(
    (value: string) => {
      markFieldChange("refundTo")
      setRefundTo(value)
    },
    [markFieldChange]
  )

  return {
    explorerUrl,
    walletAddress,
    balanceStatus,
    availableCurrencies,
    discountOptions,
    hasDiscountOptions,
    selectedCurrencyId,
    selectedDiscountId,
    selectedCurrency,
    selectedDiscount,
    mintTo,
    refundTo,
    fieldErrors,
    transactionState,
    transactionSummary,
    isSuccessState,
    isErrorState,
    canSubmit,
    oracleWarning,
    handlePurchase,
    resetTransactionState,
    setSelectedCurrencyId,
    setSelectedDiscountId,
    setMintTo: setMintToValue,
    setRefundTo: setRefundToValue,
    markFieldChange,
    markFieldBlur,
    shouldShowFieldError
  }
}
