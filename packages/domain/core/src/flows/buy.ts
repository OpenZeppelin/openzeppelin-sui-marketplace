import type { SuiClient, SuiObjectData } from "@mysten/sui/client"
import { bcs } from "@mysten/sui/bcs"
import type { Transaction } from "@mysten/sui/transactions"
import { fromB64, normalizeSuiObjectId } from "@mysten/sui/utils"
import {
  SuiPriceServiceConnection,
  SuiPythClient
} from "@pythnetwork/pyth-sui-js"

import { SUI_CLOCK_ID } from "@sui-oracle-market/tooling-core/constants"
import {
  deriveRelevantPackageId,
  getSuiObject,
  normalizeIdOrThrow,
  unwrapMoveObjectFields
} from "@sui-oracle-market/tooling-core/object"
import { getSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { newTransaction } from "@sui-oracle-market/tooling-core/transactions"
import { requireValue } from "@sui-oracle-market/tooling-core/utils/utility"
import {
  extractFieldValueByKeys,
  normalizeBigIntFromMoveValue,
  parseI64FromMoveValue,
  unwrapMoveFields
} from "@sui-oracle-market/tooling-core/utils/move-values"
import { normalizeCoinType } from "../models/currency.ts"
import type {
  DiscountTemplateSummary,
  DiscountTicketDetails
} from "../models/discount.ts"
import { parseDiscountTicketFromObject } from "../models/discount.ts"
import { getPythPullOracleConfig } from "../models/pyth.ts"

export type DiscountContext =
  | { mode: "none" }
  | {
      mode: "ticket"
      discountTicketId: string
      discountTemplateId: string
      ticketDetails: DiscountTicketDetails
    }
  | { mode: "claim"; discountTemplateId: string }

const isSuiCoinType = (coinType: string) =>
  normalizeCoinType(coinType) === "0x2::sui::SUI"

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
  returnValues?: Array<[string, string]>
): bigint | undefined => {
  const firstReturn = returnValues?.[0]
  if (!firstReturn) return undefined

  const [bytes] = firstReturn
  if (!bytes) return undefined

  try {
    const decoded = bcs.u64().parse(fromB64(bytes))
    return typeof decoded === "bigint" ? decoded : BigInt(decoded)
  } catch {
    return undefined
  }
}

/**
 * Estimates the required payment amount for a USD price using the oracle quote.
 */
export const estimateRequiredAmount = async ({
  shopPackageId,
  shopShared,
  acceptedCurrencyShared,
  pythPriceInfoShared,
  priceUsdCents,
  maxPriceAgeSecs,
  maxConfidenceRatioBps,
  clockShared,
  signerAddress,
  suiClient
}: {
  shopPackageId: string
  shopShared: Awaited<ReturnType<typeof getSuiSharedObject>>
  acceptedCurrencyShared: Awaited<ReturnType<typeof getSuiSharedObject>>
  pythPriceInfoShared: Awaited<ReturnType<typeof getSuiSharedObject>>
  priceUsdCents: bigint
  maxPriceAgeSecs?: bigint
  maxConfidenceRatioBps?: bigint
  clockShared: Awaited<ReturnType<typeof getSuiSharedObject>>
  signerAddress: string
  suiClient: SuiClient
}): Promise<bigint | undefined> => {
  const quoteTransaction = newTransaction()
  quoteTransaction.setSender(signerAddress)

  quoteTransaction.moveCall({
    target: `${shopPackageId}::shop::quote_amount_for_price_info_object`,
    arguments: [
      quoteTransaction.sharedObjectRef(shopShared.sharedRef),
      quoteTransaction.sharedObjectRef(acceptedCurrencyShared.sharedRef),
      quoteTransaction.sharedObjectRef(pythPriceInfoShared.sharedRef),
      quoteTransaction.pure.u64(priceUsdCents),
      quoteTransaction.pure.option("u64", maxPriceAgeSecs ?? null),
      quoteTransaction.pure.option("u64", maxConfidenceRatioBps ?? null),
      quoteTransaction.sharedObjectRef(clockShared.sharedRef)
    ]
  })

  const inspection = await suiClient.devInspectTransactionBlock({
    sender: signerAddress,
    transactionBlock: quoteTransaction
  })

  return parseU64ReturnValue(inspection.results?.[0]?.returnValues)
}

const maybeSetDedicatedGasForSuiPayments = async ({
  transaction,
  signerAddress,
  paymentCoinObjectId,
  suiClient
}: {
  transaction: Transaction
  signerAddress: string
  paymentCoinObjectId: string
  suiClient: SuiClient
}) => {
  const coins = await suiClient.getCoins({
    owner: signerAddress,
    coinType: "0x2::sui::SUI",
    limit: 50
  })

  const gasCandidate = coins.data.find(
    (coin) => normalizeSuiObjectId(coin.coinObjectId) !== paymentCoinObjectId
  )

  if (!gasCandidate)
    throw new Error(
      "Paying with SUI requires at least two SUI coin objects (one for gas, one for payment). Create an extra coin object (e.g., by splitting coins) or provide --payment-coin-object-id for a non-gas coin."
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
  hermesUrlOverride
}: {
  transaction: Transaction
  suiClient: SuiClient
  networkName: string
  feedIdHex: string
  hermesUrlOverride?: string
}): Promise<boolean> => {
  const config = getPythPullOracleConfig(networkName)
  if (!config) return false

  const hermesUrl = hermesUrlOverride ?? config.hermesUrl

  const connection = new SuiPriceServiceConnection(hermesUrl)

  const updateData = await connection.getPriceFeedsUpdateData([feedIdHex])

  const pythClient = new SuiPythClient(
    suiClient,
    config.pythStateId,
    config.wormholeStateId
  )

  await pythClient.updatePriceFeeds(transaction, updateData, [feedIdHex])

  return true
}

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
  suiClient
}: {
  providedCoinObjectId?: string
  coinType: string
  signerAddress: string
  suiClient: SuiClient
}): Promise<string> => {
  if (providedCoinObjectId) return providedCoinObjectId

  let cursor: string | null | undefined = undefined
  let richest: { coinObjectId: string; balance: bigint } | null = null

  do {
    const page = await suiClient.getCoins({
      owner: signerAddress,
      coinType,
      limit: 50,
      cursor
    })

    richest = page.data.reduce<{
      coinObjectId: string
      balance: bigint
    } | null>((current, coin) => {
      const balance = BigInt(coin.balance)
      if (!current) return { coinObjectId: coin.coinObjectId, balance }
      return balance > current.balance
        ? { coinObjectId: coin.coinObjectId, balance }
        : current
    }, richest)

    cursor = page.hasNextPage ? page.nextCursor : undefined
  } while (cursor)

  if (!richest)
    throw new Error(
      `No coin objects of type ${coinType} found for ${signerAddress}. Provide --payment-coin-object-id or mint/fund the account.`
    )

  return normalizeSuiObjectId(richest.coinObjectId)
}

export const buildBuyTransaction = async (
  {
    shopPackageId,
    shopShared,
    itemListingShared,
    acceptedCurrencyShared,
    pythPriceInfoShared,
    pythFeedIdHex,
    paymentCoinObjectId,
    coinType,
    itemType,
    mintTo,
    refundTo,
    maxPriceAgeSecs,
    maxConfidenceRatioBps,
    discountContext,
    skipPriceUpdate,
    hermesUrlOverride,
    networkName,
    signerAddress,
    onWarning
  }: {
    shopPackageId: string
    shopShared: Awaited<ReturnType<typeof getSuiSharedObject>>
    itemListingShared: Awaited<ReturnType<typeof getSuiSharedObject>>
    acceptedCurrencyShared: Awaited<ReturnType<typeof getSuiSharedObject>>
    pythPriceInfoShared: Awaited<ReturnType<typeof getSuiSharedObject>>
    pythFeedIdHex: string
    paymentCoinObjectId: string
    coinType: string
    itemType: string
    mintTo: string
    refundTo: string
    maxPriceAgeSecs?: bigint
    maxConfidenceRatioBps?: bigint
    discountContext: DiscountContext
    skipPriceUpdate: boolean
    hermesUrlOverride?: string
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
      suiClient
    })
  }

  const shopArgument = transaction.sharedObjectRef(shopShared.sharedRef)
  const listingArgument = transaction.sharedObjectRef(
    itemListingShared.sharedRef
  )
  const acceptedCurrencyArgument = transaction.sharedObjectRef(
    acceptedCurrencyShared.sharedRef
  )

  const clockShared = await getSuiSharedObject(
    {
      objectId: SUI_CLOCK_ID,
      mutable: false
    },
    toolingCoreContext
  )

  const clockArgument = transaction.sharedObjectRef(clockShared.sharedRef)
  const usesMockUpdate = !skipPriceUpdate && networkName === "localnet"
  const pythPriceInfoSharedRef = usesMockUpdate
    ? { ...pythPriceInfoShared.sharedRef, mutable: true }
    : pythPriceInfoShared.sharedRef
  const pythPriceInfoArgument = transaction.sharedObjectRef(
    pythPriceInfoSharedRef
  )

  if (!skipPriceUpdate) {
    const didPullUpdate = await maybeUpdatePythPriceFeed({
      transaction,
      suiClient,
      networkName,
      feedIdHex: pythFeedIdHex,
      hermesUrlOverride
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
            "Failed to update localnet mock price feed; pass --skip-price-update to proceed with existing price info."
          )
      } else {
        throw new Error(
          `No Pyth pull oracle config for network ${networkName}; pass --skip-price-update to proceed with existing price info.`
        )
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
        listingArgument,
        acceptedCurrencyArgument,
        transaction.sharedObjectRef(discountTemplateShared.sharedRef),
        pythPriceInfoArgument,
        paymentArgument,
        transaction.pure.address(mintTo),
        transaction.pure.address(refundTo),
        transaction.pure.option("u64", maxPriceAgeSecs ?? null),
        transaction.pure.option("u64", maxConfidenceRatioBps ?? null),
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
        listingArgument,
        acceptedCurrencyArgument,
        transaction.sharedObjectRef(discountTemplateShared.sharedRef),
        transaction.object(discountContext.discountTicketId),
        pythPriceInfoArgument,
        paymentArgument,
        transaction.pure.address(mintTo),
        transaction.pure.address(refundTo),
        transaction.pure.option("u64", maxPriceAgeSecs ?? null),
        transaction.pure.option("u64", maxConfidenceRatioBps ?? null),
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
      listingArgument,
      acceptedCurrencyArgument,
      pythPriceInfoArgument,
      paymentArgument,
      transaction.pure.address(mintTo),
      transaction.pure.address(refundTo),
      transaction.pure.option("u64", maxPriceAgeSecs ?? null),
      transaction.pure.option("u64", maxConfidenceRatioBps ?? null),
      clockArgument
    ]
  })

  return transaction
}
