import { bcs } from "@mysten/sui/bcs"
import type { SuiClient, SuiObjectData, SuiObjectRef } from "@mysten/sui/client"
import type { Transaction } from "@mysten/sui/transactions"
import { fromB64, normalizeSuiObjectId } from "@mysten/sui/utils"
import {
  SuiPriceServiceConnection,
  SuiPythClient
} from "@pythnetwork/pyth-sui-js"

import {
  DEFAULT_TX_GAS_BUDGET,
  NORMALIZED_SUI_COIN_TYPE,
  SUI_COIN_TYPE,
  SUI_CLOCK_ID
} from "@sui-oracle-market/tooling-core/constants"
import {
  deriveRelevantPackageId,
  getSuiObject,
  normalizeIdOrThrow,
  unwrapMoveObjectFields
} from "@sui-oracle-market/tooling-core/object"
import { getSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { newTransaction } from "@sui-oracle-market/tooling-core/transactions"
import {
  extractFieldValueByKeys,
  normalizeBigIntFromMoveValue,
  parseI64FromMoveValue,
  unwrapMoveFields
} from "@sui-oracle-market/tooling-core/utils/move-values"
import {
  parseBalance,
  requireValue
} from "@sui-oracle-market/tooling-core/utils/utility"
import { normalizeCoinType } from "../models/currency.ts"
import type {
  DiscountContext,
  DiscountTemplateSummary
} from "../models/discount.ts"
import { parseDiscountTicketFromObject } from "../models/discount.ts"
import { normalizeListingId } from "../models/item-listing.ts"
import type { PriceUpdatePolicy, PythPullOracleConfig } from "../models/pyth.ts"
import { resolvePythPullOracleConfig } from "../models/pyth.ts"

const isSuiCoinType = (coinType: string) =>
  normalizeCoinType(coinType) === NORMALIZED_SUI_COIN_TYPE

const getObjectRef = async (objectId: string, suiClient: SuiClient) => {
  const response = await suiClient.getObject({
    id: normalizeSuiObjectId(objectId),
    options: { showContent: false, showOwner: false, showType: false }
  })

  if (!response.data)
    throw new Error(`Unable to fetch object ref for ${objectId}.`)

  return {
    objectId: normalizeSuiObjectId(response.data.objectId),
    version: response.data.version,
    digest: response.data.digest
  }
}

const normalizeObjectRef = (objectRef: SuiObjectRef): SuiObjectRef => ({
  ...objectRef,
  objectId: normalizeSuiObjectId(objectRef.objectId)
})

const parseMockPriceInfoUpdateFields = (
  priceInfoObject: SuiObjectData
):
  | {
      priceMagnitude: bigint
      priceIsNegative: boolean
      conf: bigint
      expoMagnitude: bigint
      expoIsNegative: boolean
    }
  | undefined => {
  const topFields = unwrapMoveObjectFields(priceInfoObject)
  const priceInfoFields = unwrapMoveFields(
    extractFieldValueByKeys(topFields, ["price_info", "priceInfo"])
  )
  const priceFeedFields = unwrapMoveFields(
    extractFieldValueByKeys(priceInfoFields, ["price_feed", "priceFeed"])
  )
  const priceFields = unwrapMoveFields(
    extractFieldValueByKeys(priceFeedFields, ["price"])
  )

  if (!priceFields) return undefined

  const priceI64 = parseI64FromMoveValue(priceFields.price)
  const expoI64 = parseI64FromMoveValue(priceFields.expo)
  const conf = normalizeBigIntFromMoveValue(priceFields.conf)

  if (!priceI64 || !expoI64 || conf === undefined) return undefined

  return {
    priceMagnitude: priceI64.magnitude,
    priceIsNegative: priceI64.negative,
    conf,
    expoMagnitude: expoI64.magnitude,
    expoIsNegative: expoI64.negative
  }
}

const BASIS_POINT_DENOMINATOR = 10_000n

/**
 * Resolves a discounted USD price (in cents) based on a discount selection.
 */
export const resolveDiscountedPriceUsdCents = ({
  basePriceUsdCents,
  discountSelection,
  discountTemplateLookup
}: {
  basePriceUsdCents?: string
  discountSelection: DiscountContext
  discountTemplateLookup: Record<string, DiscountTemplateSummary>
}): bigint | undefined => {
  if (!basePriceUsdCents) return undefined

  const basePrice = BigInt(basePriceUsdCents)
  if (discountSelection.mode === "none") return basePrice

  const template = discountTemplateLookup[discountSelection.discountTemplateId]
  if (!template) return basePrice

  const ruleKind = template.ruleKind
  const ruleValue = template.ruleValue ? BigInt(template.ruleValue) : undefined
  if (!ruleKind || ruleKind === "unknown" || ruleValue === undefined)
    return basePrice

  if (ruleKind === "fixed") {
    return ruleValue >= basePrice ? 0n : basePrice - ruleValue
  }

  if (ruleValue > BASIS_POINT_DENOMINATOR) return basePrice

  const numerator = basePrice * (BASIS_POINT_DENOMINATOR - ruleValue)
  return (numerator + BASIS_POINT_DENOMINATOR - 1n) / BASIS_POINT_DENOMINATOR
}

const parseU64ReturnValue = (
  returnValues?: Array<[string | number[] | Uint8Array, string]>
): bigint | undefined => {
  const firstReturn = returnValues?.[0]
  if (!firstReturn) return undefined

  const [bytes] = firstReturn
  if (!bytes) return undefined

  try {
    const normalizedBytes =
      typeof bytes === "string"
        ? fromB64(bytes)
        : bytes instanceof Uint8Array
          ? bytes
          : Uint8Array.from(bytes)
    const decoded = bcs.u64().parse(normalizedBytes)
    return typeof decoded === "bigint" ? decoded : BigInt(decoded)
  } catch {
    return undefined
  }
}

export type EstimateRequiredAmountPriceUpdateMode =
  | "none"
  | "localnet-mock"
  | "pyth-update"

/**
 * Estimates the required payment amount for a USD price using the oracle quote.
 */
export const estimateRequiredAmount = async ({
  shopPackageId,
  shopShared,
  coinType,
  pythPriceInfoShared,
  pythFeedIdHex,
  networkName,
  priceUsdCents,
  maxPriceAgeSecs,
  maxConfidenceRatioBps,
  clockShared,
  signerAddress,
  suiClient,
  priceUpdateMode = "none",
  hermesUrlOverride,
  pythConfigOverride,
  onPriceUpdateWarning
}: {
  shopPackageId: string
  shopShared: Awaited<ReturnType<typeof getSuiSharedObject>>
  coinType: string
  pythPriceInfoShared: Awaited<ReturnType<typeof getSuiSharedObject>>
  pythFeedIdHex?: string
  networkName?: string
  priceUsdCents: bigint
  maxPriceAgeSecs?: bigint
  maxConfidenceRatioBps?: number
  clockShared: Awaited<ReturnType<typeof getSuiSharedObject>>
  signerAddress: string
  suiClient: SuiClient
  priceUpdateMode?: EstimateRequiredAmountPriceUpdateMode
  hermesUrlOverride?: string
  pythConfigOverride?: PythPullOracleConfig
  onPriceUpdateWarning?: (message: string) => void
}): Promise<bigint | undefined> => {
  const quoteTransaction = newTransaction()
  quoteTransaction.setSender(signerAddress)

  const shopArgument = quoteTransaction.sharedObjectRef(shopShared.sharedRef)
  const pythPriceInfoSharedRef =
    priceUpdateMode === "localnet-mock" || priceUpdateMode === "pyth-update"
      ? { ...pythPriceInfoShared.sharedRef, mutable: true }
      : pythPriceInfoShared.sharedRef
  const pythPriceInfoArgument = quoteTransaction.sharedObjectRef(
    pythPriceInfoSharedRef
  )
  const clockArgument = quoteTransaction.sharedObjectRef(clockShared.sharedRef)

  let injectedPriceUpdate = false

  if (priceUpdateMode === "localnet-mock") {
    injectedPriceUpdate = maybeUpdateMockPriceFeed({
      transaction: quoteTransaction,
      priceInfoArgument: pythPriceInfoArgument,
      priceInfoObject: pythPriceInfoShared.object,
      clockArgument,
      onWarning: onPriceUpdateWarning
    })

    if (!injectedPriceUpdate)
      onPriceUpdateWarning?.(
        "Unable to refresh localnet mock price feed before quoting."
      )
  }

  if (priceUpdateMode === "pyth-update") {
    if (!pythFeedIdHex || !networkName) {
      onPriceUpdateWarning?.(
        "Missing Pyth feed ID or network name; unable to refresh price feed before quoting."
      )
    } else {
      injectedPriceUpdate = await maybeUpdatePythPriceFeed({
        transaction: quoteTransaction,
        suiClient,
        networkName,
        feedIdHex: pythFeedIdHex,
        hermesUrlOverride,
        pythConfigOverride
      })

      if (!injectedPriceUpdate)
        onPriceUpdateWarning?.(
          "Unable to refresh Pyth price feed before quoting."
        )
    }
  }

  quoteTransaction.moveCall({
    target: `${shopPackageId}::shop::quote_amount_for_price_info_object`,
    typeArguments: [coinType],
    arguments: [
      shopArgument,
      pythPriceInfoArgument,
      quoteTransaction.pure.u64(priceUsdCents),
      quoteTransaction.pure.option("u64", maxPriceAgeSecs ?? null),
      quoteTransaction.pure.option("u16", maxConfidenceRatioBps ?? null),
      clockArgument
    ]
  })

  const inspection = await suiClient.devInspectTransactionBlock({
    sender: signerAddress,
    transactionBlock: quoteTransaction
  })

  if (inspection.error) {
    const errorLabel =
      typeof inspection.error === "string"
        ? inspection.error
        : JSON.stringify(inspection.error)
    throw new Error(`Oracle quote failed: ${errorLabel}`)
  }

  const quoteResult = inspection.results?.[inspection.results.length - 1]
  return parseU64ReturnValue(quoteResult?.returnValues)
}

const maybeSetDedicatedGasForSuiPayments = async ({
  transaction,
  signerAddress,
  paymentCoinObjectId,
  dedicatedGasPaymentRef,
  gasBudget,
  suiClient
}: {
  transaction: Transaction
  signerAddress: string
  paymentCoinObjectId: string
  dedicatedGasPaymentRef?: SuiObjectRef
  gasBudget?: number
  suiClient: SuiClient
}) => {
  const normalizedPaymentCoinObjectId =
    normalizeSuiObjectId(paymentCoinObjectId)

  if (dedicatedGasPaymentRef) {
    const normalizedGasPaymentRef = normalizeObjectRef(dedicatedGasPaymentRef)
    if (normalizedGasPaymentRef.objectId === normalizedPaymentCoinObjectId)
      throw new Error(
        "SUI payment coin cannot also be used as gas. Provide a different gas coin."
      )

    transaction.setGasOwner(signerAddress)
    transaction.setGasPayment([normalizedGasPaymentRef])
    return
  }

  // When paying with SUI, one coin must cover gas and a different coin must be the payment input.
  const coins = await suiClient.getCoins({
    owner: signerAddress,
    coinType: SUI_COIN_TYPE,
    limit: 50
  })

  const minimumGasBalance = BigInt(gasBudget ?? DEFAULT_TX_GAS_BUDGET)
  const gasCandidate = coins.data
    .map((coin) => ({
      coinObjectId: normalizeSuiObjectId(coin.coinObjectId),
      balance: parseBalance(coin.balance)
    }))
    .filter(
      (coin) =>
        coin.coinObjectId !== normalizedPaymentCoinObjectId &&
        coin.balance >= minimumGasBalance
    )
    .reduce<{
      coinObjectId: string
      balance: bigint
    } | null>((current, coin) => {
      if (!current) return coin
      return coin.balance < current.balance ? coin : current
    }, null)

  if (!gasCandidate)
    throw new Error(
      `Paying with SUI requires a non-payment SUI coin with at least ${minimumGasBalance}. Split a gas coin or fund a larger balance, then retry.`
    )

  const gasRef = await getObjectRef(gasCandidate.coinObjectId, suiClient)
  transaction.setGasOwner(signerAddress)
  transaction.setGasPayment([gasRef])
}

const maybeUpdatePythPriceFeed = async ({
  transaction,
  suiClient,
  networkName,
  feedIdHex,
  hermesUrlOverride,
  pythConfigOverride
}: {
  transaction: Transaction
  suiClient: SuiClient
  networkName: string
  feedIdHex: string
  hermesUrlOverride?: string
  pythConfigOverride?: PythPullOracleConfig
}): Promise<boolean> => {
  const config = resolvePythPullOracleConfig(networkName, pythConfigOverride)
  if (!config) return false

  const hermesUrl = hermesUrlOverride ?? config.hermesUrl

  const connection = new SuiPriceServiceConnection(hermesUrl)

  const updateData = await connection.getPriceFeedsUpdateData([feedIdHex])
  // pyth-sui-js expects Buffer-style readUint* helpers; add shims for browser Uint8Array.
  const normalizedUpdateData = updateData.map((message) => {
    const messageWithReads = message as Uint8Array & {
      readUint8?: (offset: number) => number
      readUint16BE?: (offset: number) => number
    }

    if (
      typeof messageWithReads.readUint8 === "function" &&
      typeof messageWithReads.readUint16BE === "function"
    ) {
      return message
    }

    const dataView = new DataView(
      message.buffer,
      message.byteOffset,
      message.byteLength
    )

    messageWithReads.readUint8 = (offset: number) => dataView.getUint8(offset)
    messageWithReads.readUint16BE = (offset: number) =>
      dataView.getUint16(offset, false)

    return message
  })

  const pythClient = new SuiPythClient(
    suiClient,
    config.pythStateId,
    config.wormholeStateId
  )

  await pythClient.updatePriceFeeds(transaction, normalizedUpdateData, [
    feedIdHex
  ])

  return true
}

const resolvePriceUpdatePolicy = ({
  skipPriceUpdate,
  priceUpdatePolicy
}: {
  skipPriceUpdate?: boolean
  priceUpdatePolicy?: PriceUpdatePolicy
}): PriceUpdatePolicy =>
  skipPriceUpdate ? "skip" : (priceUpdatePolicy ?? "auto")

const maybeUpdateMockPriceFeed = ({
  transaction,
  priceInfoArgument,
  priceInfoObject,
  clockArgument,
  onWarning
}: {
  transaction: Transaction
  priceInfoArgument: ReturnType<Transaction["sharedObjectRef"]>
  priceInfoObject: SuiObjectData
  clockArgument: ReturnType<Transaction["sharedObjectRef"]>
  onWarning?: (message: string) => void
}): boolean => {
  const updateFields = parseMockPriceInfoUpdateFields(priceInfoObject)
  if (!updateFields) {
    onWarning?.(
      "Skipping localnet mock update: unable to parse PriceInfoObject fields."
    )
    return false
  }

  const pythPackageId = deriveRelevantPackageId(priceInfoObject.type)

  transaction.moveCall({
    target: `${pythPackageId}::price_info::update_price_feed`,
    arguments: [
      priceInfoArgument,
      transaction.pure.u64(updateFields.priceMagnitude),
      transaction.pure.bool(updateFields.priceIsNegative),
      transaction.pure.u64(updateFields.conf),
      transaction.pure.u64(updateFields.expoMagnitude),
      transaction.pure.bool(updateFields.expoIsNegative),
      clockArgument
    ]
  })

  return true
}

export const resolveDiscountContext = async ({
  claimDiscount,
  discountTicketId,
  discountTemplateId,
  suiClient
}: {
  claimDiscount: boolean
  discountTicketId?: string
  discountTemplateId?: string
  suiClient: SuiClient
}): Promise<DiscountContext> => {
  if (claimDiscount) {
    const templateId = requireValue(
      discountTemplateId,
      "--discount-template-id is required when using --claim-discount."
    )

    return {
      mode: "claim",
      discountTemplateId: templateId
    }
  }

  if (!discountTicketId) return { mode: "none" }

  const { object: ticketObject } = await getSuiObject(
    {
      objectId: discountTicketId,
      options: { showContent: true, showType: true }
    },
    { suiClient }
  )

  const ticketDetails = parseDiscountTicketFromObject(ticketObject)

  const resolvedTemplateId = normalizeIdOrThrow(
    discountTemplateId ?? ticketDetails.discountTemplateId,
    "Unable to resolve DiscountTemplate ID from the ticket; provide --discount-template-id."
  )

  return {
    mode: "ticket",
    discountTicketId,
    discountTemplateId: resolvedTemplateId,
    ticketDetails
  }
}

export const resolvePaymentCoinObjectId = async ({
  providedCoinObjectId,
  coinType,
  signerAddress,
  suiClient,
  minimumBalance
}: {
  providedCoinObjectId?: string
  coinType: string
  signerAddress: string
  suiClient: SuiClient
  minimumBalance?: bigint
}): Promise<string> => {
  if (providedCoinObjectId) return providedCoinObjectId

  type CoinCandidate = { coinObjectId: string; balance: bigint }

  let cursor: string | undefined = undefined
  let richest: CoinCandidate | undefined
  let smallestSufficient: CoinCandidate | undefined

  do {
    const page = await suiClient.getCoins({
      owner: signerAddress,
      coinType,
      limit: 50,
      cursor
    })

    page.data.forEach((coin) => {
      const balance = BigInt(coin.balance)
      const coinObjectId = normalizeSuiObjectId(coin.coinObjectId)

      if (!richest || balance > richest.balance) {
        richest = { coinObjectId, balance }
      }

      if (minimumBalance !== undefined && balance >= minimumBalance) {
        if (!smallestSufficient || balance < smallestSufficient.balance) {
          smallestSufficient = { coinObjectId, balance }
        }
      }
    })

    cursor = page.hasNextPage ? (page.nextCursor ?? undefined) : undefined
  } while (cursor)

  const selectedCoin = requireValue<CoinCandidate>(
    smallestSufficient ?? richest,
    `No coin objects of type ${coinType} found for ${signerAddress}. Provide --payment-coin-object-id or mint/fund the account.`
  )

  if (minimumBalance !== undefined && !smallestSufficient)
    throw new Error(
      `No single coin object of type ${coinType} has at least ${minimumBalance}. Merge coins or split from a larger balance, then retry.`
    )

  return normalizeSuiObjectId(selectedCoin.coinObjectId)
}

export const buildBuyTransaction = async (
  {
    shopPackageId,
    shopShared,
    itemListingId,
    pythPriceInfoShared,
    pythFeedIdHex,
    paymentCoinObjectId,
    dedicatedGasPaymentRef,
    coinType,
    itemType,
    mintTo,
    refundTo,
    maxPriceAgeSecs,
    maxConfidenceRatioBps,
    gasBudget,
    discountContext,
    skipPriceUpdate,
    priceUpdatePolicy,
    hermesUrlOverride,
    pythConfigOverride,
    networkName,
    signerAddress,
    onWarning
  }: {
    shopPackageId: string
    shopShared: Awaited<ReturnType<typeof getSuiSharedObject>>
    itemListingId: string
    pythPriceInfoShared: Awaited<ReturnType<typeof getSuiSharedObject>>
    pythFeedIdHex: string
    paymentCoinObjectId: string
    dedicatedGasPaymentRef?: SuiObjectRef
    coinType: string
    itemType: string
    mintTo: string
    refundTo: string
    maxPriceAgeSecs?: bigint
    maxConfidenceRatioBps?: number
    gasBudget?: number
    discountContext: DiscountContext
    skipPriceUpdate?: boolean
    priceUpdatePolicy?: PriceUpdatePolicy
    hermesUrlOverride?: string
    pythConfigOverride?: PythPullOracleConfig
    networkName: string
    signerAddress: string
    onWarning?: (message: string) => void
  },
  suiClient: SuiClient
) => {
  const toolingCoreContext = { suiClient }
  const transaction = newTransaction()
  transaction.setSender(signerAddress)

  if (isSuiCoinType(coinType)) {
    await maybeSetDedicatedGasForSuiPayments({
      transaction,
      signerAddress,
      paymentCoinObjectId,
      dedicatedGasPaymentRef,
      gasBudget,
      suiClient
    })
  }

  const shopArgument = transaction.sharedObjectRef(shopShared.sharedRef)
  const listingId = BigInt(normalizeListingId(itemListingId))

  const clockShared = await getSuiSharedObject(
    {
      objectId: SUI_CLOCK_ID,
      mutable: false
    },
    toolingCoreContext
  )

  const clockArgument = transaction.sharedObjectRef(clockShared.sharedRef)
  const resolvedPriceUpdatePolicy = resolvePriceUpdatePolicy({
    skipPriceUpdate,
    priceUpdatePolicy
  })
  const pythConfig = resolvePythPullOracleConfig(
    networkName,
    pythConfigOverride
  )
  const usesMockUpdate =
    resolvedPriceUpdatePolicy !== "skip" &&
    networkName === "localnet" &&
    !pythConfig
  const shouldUseMutablePriceInfo =
    resolvedPriceUpdatePolicy !== "skip" &&
    (usesMockUpdate || Boolean(pythConfig))
  const pythPriceInfoSharedRef = shouldUseMutablePriceInfo
    ? { ...pythPriceInfoShared.sharedRef, mutable: true }
    : pythPriceInfoShared.sharedRef
  const pythPriceInfoArgument = transaction.sharedObjectRef(
    pythPriceInfoSharedRef
  )

  if (resolvedPriceUpdatePolicy === "skip") {
    onWarning?.(
      "Skipping price update; ensure the provided PriceInfoObject is fresh."
    )
  } else {
    const didPullUpdate = await maybeUpdatePythPriceFeed({
      transaction,
      suiClient,
      networkName,
      feedIdHex: pythFeedIdHex,
      hermesUrlOverride,
      pythConfigOverride
    })

    if (!didPullUpdate) {
      if (usesMockUpdate) {
        const didMockUpdate = maybeUpdateMockPriceFeed({
          transaction,
          priceInfoArgument: pythPriceInfoArgument,
          priceInfoObject: pythPriceInfoShared.object,
          clockArgument,
          onWarning
        })
        if (!didMockUpdate)
          throw new Error(
            "Failed to update localnet mock price feed; pass --price-update-policy skip (or --skip-price-update) to proceed with existing price info."
          )
      } else {
        const message = `No Pyth pull oracle config for network ${networkName}.`
        if (resolvedPriceUpdatePolicy === "required") {
          throw new Error(
            `${message} Configure Pyth endpoints or pass --price-update-policy skip (or --skip-price-update) to proceed with existing price info.`
          )
        }

        onWarning?.(`${message} Proceeding without updating price info.`)
      }
    }
  }

  const paymentArgument = transaction.object(paymentCoinObjectId)
  const typeArguments = [itemType, coinType]

  if (discountContext.mode === "claim") {
    const discountTemplateShared = await getSuiSharedObject(
      { objectId: discountContext.discountTemplateId, mutable: true },
      toolingCoreContext
    )

    transaction.moveCall({
      target: `${shopPackageId}::shop::claim_and_buy_item_with_discount`,
      typeArguments,
      arguments: [
        shopArgument,
        transaction.pure.u64(listingId),
        transaction.sharedObjectRef(discountTemplateShared.sharedRef),
        pythPriceInfoArgument,
        paymentArgument,
        transaction.pure.address(mintTo),
        transaction.pure.address(refundTo),
        transaction.pure.option("u64", maxPriceAgeSecs ?? null),
        transaction.pure.option("u16", maxConfidenceRatioBps ?? null),
        clockArgument
      ]
    })

    return transaction
  }

  if (discountContext.mode === "ticket") {
    const discountTemplateShared = await getSuiSharedObject(
      { objectId: discountContext.discountTemplateId, mutable: true },
      toolingCoreContext
    )

    transaction.moveCall({
      target: `${shopPackageId}::shop::buy_item_with_discount`,
      typeArguments,
      arguments: [
        shopArgument,
        transaction.pure.u64(listingId),
        transaction.sharedObjectRef(discountTemplateShared.sharedRef),
        transaction.object(discountContext.discountTicketId),
        pythPriceInfoArgument,
        paymentArgument,
        transaction.pure.address(mintTo),
        transaction.pure.address(refundTo),
        transaction.pure.option("u64", maxPriceAgeSecs ?? null),
        transaction.pure.option("u16", maxConfidenceRatioBps ?? null),
        clockArgument
      ]
    })

    return transaction
  }

  transaction.moveCall({
    target: `${shopPackageId}::shop::buy_item`,
    typeArguments,
    arguments: [
      shopArgument,
      transaction.pure.u64(listingId),
      pythPriceInfoArgument,
      paymentArgument,
      transaction.pure.address(mintTo),
      transaction.pure.address(refundTo),
      transaction.pure.option("u64", maxPriceAgeSecs ?? null),
      transaction.pure.option("u16", maxConfidenceRatioBps ?? null),
      clockArgument
    ]
  })

  return transaction
}
