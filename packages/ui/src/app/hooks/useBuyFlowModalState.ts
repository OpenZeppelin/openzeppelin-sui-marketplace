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
import type { Transaction } from "@mysten/sui/transactions"
import { normalizeSuiAddress } from "@mysten/sui/utils"
import type { IdentifierString } from "@mysten/wallet-standard"
import type { EstimateRequiredAmountPriceUpdateMode } from "@sui-oracle-market/domain-core/flows/buy"
import {
  buildBuyTransaction,
  estimateRequiredAmount,
  resolveDiscountedPriceUsdCents,
  resolvePaymentCoinObjectId
} from "@sui-oracle-market/domain-core/flows/buy"
import {
  normalizeCoinType,
  type AcceptedCurrencySummary
} from "@sui-oracle-market/domain-core/models/currency"
import type {
  DiscountContext,
  DiscountOption,
  DiscountTemplateSummary,
  DiscountTicketDetails
} from "@sui-oracle-market/domain-core/models/discount"
import {
  buildDiscountOptions,
  pickDefaultDiscountOptionId
} from "@sui-oracle-market/domain-core/models/discount"
import type { ItemListingSummary } from "@sui-oracle-market/domain-core/models/item-listing"
import type { PriceUpdatePolicy } from "@sui-oracle-market/domain-core/models/pyth"
import type { ShopItemReceiptSummary } from "@sui-oracle-market/domain-core/models/shop-item"
import {
  findCreatedShopItemIds,
  parseShopItemReceiptFromObject
} from "@sui-oracle-market/domain-core/models/shop-item"
import { planSuiPaymentSplitTransaction } from "@sui-oracle-market/tooling-core/coin"
import {
  DEFAULT_TX_GAS_BUDGET,
  SUI_CLOCK_ID
} from "@sui-oracle-market/tooling-core/constants"
import {
  deriveRelevantPackageId,
  getSuiObject,
  normalizeIdOrThrow
} from "@sui-oracle-market/tooling-core/object"
import { getSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { ENetwork } from "@sui-oracle-market/tooling-core/types"
import { requireValue } from "@sui-oracle-market/tooling-core/utils/utility"
import { useCallback, useEffect, useMemo, useState } from "react"
import { EXPLORER_URL_VARIABLE_NAME } from "../config/network"
import { parseBalance } from "../helpers/balance"
import { buildDiscountTemplateLookup } from "../helpers/discountTemplates"
import { formatCoinBalance, getStructLabel } from "../helpers/format"
import { validateOptionalSuiAddress } from "../helpers/inputValidation"
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

type CurrencyBalance = AcceptedCurrencySummary & {
  balance: bigint
}

type BuyFieldErrors = {
  currency?: string
  mintTo?: string
  refundTo?: string
}

const SUI_COIN_TYPE = normalizeCoinType("0x2::sui::SUI")

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
  paymentCoinObjectId?: string
  selectedCurrency: CurrencyBalance
  discountSelection: DiscountContext
  mintTo: string
  refundTo: string
}

export type PurchaseSuccessPayload = {
  receipts: ShopItemReceiptSummary[]
  receiptIds: string[]
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

type OracleQuoteState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; amount: bigint }
  | { status: "error"; error: string }

type BuyFlowModalState = {
  explorerUrl?: string
  walletAddress?: string
  walletConnected: boolean
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
  oracleQuote: OracleQuoteState
  hasSufficientBalance: boolean
  oracleShortfall?: bigint
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
  onPurchaseSuccess,
  shopId,
  listing,
  acceptedCurrencies,
  discountTemplates,
  discountTickets
}: {
  open: boolean
  onClose: () => void
  onPurchaseSuccess?: (payload: PurchaseSuccessPayload) => void
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
  const priceUpdatePolicy: PriceUpdatePolicy =
    network === ENetwork.LOCALNET ||
    network === ENetwork.TESTNET ||
    network === ENetwork.MAINNET
      ? "required"
      : "auto"
  const quotePriceUpdateMode: EstimateRequiredAmountPriceUpdateMode =
    network === ENetwork.LOCALNET ? "localnet-mock" : "none"

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
  const [oracleQuote, setOracleQuote] = useState<OracleQuoteState>({
    status: "idle"
  })
  const [lastWalletContext, setLastWalletContext] =
    useState<Record<string, unknown>>()

  const hydrateShopItemReceipts = useCallback(
    async (receiptIds: string[]): Promise<ShopItemReceiptSummary[]> => {
      if (receiptIds.length === 0) return []

      const receipts = await Promise.all(
        receiptIds.map(async (receiptId) => {
          try {
            const { object } = await getSuiObject(
              { objectId: receiptId, options: { showContent: true } },
              { suiClient }
            )
            return parseShopItemReceiptFromObject(object)
          } catch (error) {
            console.warn(
              `Unable to hydrate ShopItem receipt ${receiptId}`,
              error
            )
            return undefined
          }
        })
      )

      return receipts.filter((receipt): receipt is ShopItemReceiptSummary =>
        Boolean(receipt)
      )
    },
    [suiClient]
  )

  const walletAddress = currentAccount?.address
  const walletConnected = Boolean(walletAddress)

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

  const { hasSufficientBalance, oracleShortfall } = useMemo(() => {
    if (oracleQuote.status !== "success" || !selectedCurrency)
      return { hasSufficientBalance: true, oracleShortfall: undefined }

    if (selectedCurrency.balance >= oracleQuote.amount)
      return { hasSufficientBalance: true, oracleShortfall: undefined }

    return {
      hasSufficientBalance: false,
      oracleShortfall: oracleQuote.amount - selectedCurrency.balance
    }
  }, [oracleQuote, selectedCurrency])

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
      !hasFieldErrors &&
      hasSufficientBalance
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
    setOracleQuote({ status: "idle" })
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
    if (!open) {
      setOracleQuote({ status: "idle" })
      return
    }

    if (
      !walletAddress ||
      !shopId ||
      !listing ||
      !selectedCurrency ||
      !selectedDiscount
    ) {
      setOracleQuote({ status: "idle" })
      return
    }

    const discountedPriceUsdCents = resolveDiscountedPriceUsdCents({
      basePriceUsdCents: listing.basePriceUsdCents,
      discountSelection: selectedDiscount.selection,
      discountTemplateLookup
    })

    if (discountedPriceUsdCents === undefined) {
      setOracleQuote({
        status: "error",
        error: "Missing listing price to quote."
      })
      return
    }

    let isActive = true
    setOracleQuote({ status: "loading" })

    const loadQuote = async () => {
      try {
        const shopShared = await getSuiSharedObject(
          { objectId: shopId, mutable: false },
          { suiClient }
        )
        const acceptedCurrencyShared = await getSuiSharedObject(
          {
            objectId: selectedCurrency.acceptedCurrencyId,
            mutable: false
          },
          { suiClient }
        )
        const pythObjectId = normalizeIdOrThrow(
          selectedCurrency.pythObjectId,
          `AcceptedCurrency ${selectedCurrency.acceptedCurrencyId} is missing a pyth_object_id.`
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
          suiClient,
          priceUpdateMode: quotePriceUpdateMode
        })

        if (!isActive) return

        if (requiredAmount === undefined) {
          setOracleQuote({
            status: "error",
            error: "Oracle quote unavailable for the selected currency."
          })
          return
        }

        setOracleQuote({ status: "success", amount: requiredAmount })
      } catch (error) {
        if (!isActive) return
        setOracleQuote({
          status: "error",
          error: formatErrorMessage(error)
        })
      }
    }

    loadQuote()

    return () => {
      isActive = false
    }
  }, [
    discountTemplateLookup,
    listing,
    open,
    quotePriceUpdateMode,
    selectedCurrency,
    selectedDiscount,
    shopId,
    suiClient,
    walletAddress
  ])

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

    let debugContext: Record<string, unknown> | undefined

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
      let paymentCoinMinimumBalance: bigint | undefined = undefined

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
            suiClient,
            priceUpdateMode: quotePriceUpdateMode
          })

          if (requiredAmount !== undefined) {
            paymentCoinMinimumBalance = requiredAmount
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

      const isSuiPayment =
        normalizeCoinType(currencySnapshot.coinType) === SUI_COIN_TYPE
      const gasBudget = BigInt(DEFAULT_TX_GAS_BUDGET)
      if (isSuiPayment && paymentCoinMinimumBalance === undefined) {
        setTransactionState({
          status: "error",
          error:
            "Unable to estimate the SUI payment amount for gas-split checkout. Try again or switch to a non-SUI payment."
        })
        return
      }

      const executeTransaction = async (transaction: Transaction) => {
        let digest = ""
        let transactionBlock: SuiTransactionBlockResponse

        if (isLocalnet) {
          // Localnet signs in-wallet but executes via the app RPC to avoid wallet network mismatches.
          failureStage = "execute"
          const result = await localnetExecutor(transaction, {
            chain: expectedChain
          })
          digest = result.digest
          transactionBlock = result
        } else {
          failureStage = "execute"
          const result = await signAndExecuteTransaction.mutateAsync({
            transaction,
            chain: expectedChain
          })

          failureStage = "fetch"
          digest = result.digest
          transactionBlock = await waitForTransactionBlock(suiClient, digest)
        }

        return { digest, transactionBlock }
      }

      let paymentCoinObjectId: string

      if (isSuiPayment) {
        const paymentMinimum = requireValue(
          paymentCoinMinimumBalance,
          "Missing payment amount."
        )
        const splitPlan = await planSuiPaymentSplitTransaction(
          {
            owner: walletAddress,
            paymentMinimum,
            gasBudget,
            splitGasBudget: DEFAULT_TX_GAS_BUDGET,
            forceSplit: isLocalnet
          },
          { suiClient }
        )

        debugContext = {
          ...(debugContext ?? {}),
          suiPaymentSplitPlan: {
            needsSplit: splitPlan.needsSplit,
            coinCount: splitPlan.coinCount,
            totalBalance: splitPlan.totalBalance.toString(),
            paymentCoinObjectId: splitPlan.paymentCoinObjectId
          }
        }

        if (splitPlan.needsSplit && splitPlan.transaction) {
          failureStage = "execute"
          await executeTransaction(splitPlan.transaction)
        }
        paymentCoinObjectId = splitPlan.paymentCoinObjectId
      } else {
        paymentCoinObjectId = await resolvePaymentCoinObjectId({
          providedCoinObjectId: undefined,
          coinType: currencySnapshot.coinType,
          signerAddress: walletAddress,
          suiClient,
          minimumBalance: paymentCoinMinimumBalance
        })
      }

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
          gasBudget: DEFAULT_TX_GAS_BUDGET,
          discountContext: discountSelection,
          priceUpdatePolicy,
          hermesUrlOverride: undefined,
          networkName: network,
          signerAddress: walletAddress,
          onWarning: (message) => setOracleWarning(message)
        },
        suiClient
      )

      buyTransaction.setGasBudget(DEFAULT_TX_GAS_BUDGET)

      const preSignGasData = (
        buyTransaction as { getData?: () => { gasData?: unknown } }
      ).getData?.()?.gasData
      if (preSignGasData) {
        debugContext = {
          ...(debugContext ?? {}),
          preSignGasData: serializeForJson(preSignGasData)
        }
      }

      failureStage = "execute"
      const { digest, transactionBlock } =
        await executeTransaction(buyTransaction)

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

      const receiptIds = findCreatedShopItemIds(
        extractCreatedObjects(transactionBlock)
      )
      const hydratedReceipts = await hydrateShopItemReceipts(receiptIds)

      onPurchaseSuccess?.({
        receiptIds,
        receipts: hydratedReceipts
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
          walletContext: lastWalletContext ?? walletContext,
          debugContext
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
    discountTemplateLookup,
    hasFieldErrors,
    isLocalnet,
    lastWalletContext,
    listing,
    localnetExecutor,
    mintTo,
    hydrateShopItemReceipts,
    onPurchaseSuccess,
    priceUpdatePolicy,
    quotePriceUpdateMode,
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
    walletConnected,
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
    oracleQuote,
    hasSufficientBalance,
    oracleShortfall,
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
