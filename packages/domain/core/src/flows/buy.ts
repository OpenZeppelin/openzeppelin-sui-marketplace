import type { SuiClient } from "@mysten/sui/client"
import type { Transaction } from "@mysten/sui/transactions"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import {
  SuiPriceServiceConnection,
  SuiPythClient
} from "@pythnetwork/pyth-sui-js"

import { SUI_CLOCK_ID } from "@sui-oracle-market/tooling-core/constants"
import {
  getSuiObject,
  normalizeIdOrThrow
} from "@sui-oracle-market/tooling-core/object"
import { getSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { newTransaction } from "@sui-oracle-market/tooling-core/transactions"
import { requireValue } from "@sui-oracle-market/tooling-core/utils/utility"
import { normalizeCoinType } from "../models/currency.ts"
import type { DiscountTicketDetails } from "../models/discount.ts"
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
  hermesUrlOverride,
  onWarning
}: {
  transaction: Transaction
  suiClient: SuiClient
  networkName: string
  feedIdHex: string
  hermesUrlOverride?: string
  onWarning?: (message: string) => void
}) => {
  const config = getPythPullOracleConfig(networkName)
  if (!config) {
    onWarning?.(
      `Skipping Pyth pull update: no config for network ${networkName}.`
    )
    return
  }

  const hermesUrl = hermesUrlOverride ?? config.hermesUrl

  const connection = new SuiPriceServiceConnection(hermesUrl)

  const updateData = await connection.getPriceFeedsUpdateData([feedIdHex])

  const pythClient = new SuiPythClient(
    suiClient,
    config.pythStateId,
    config.wormholeStateId
  )

  await pythClient.updatePriceFeeds(transaction, updateData, [feedIdHex])
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

  const coins = await suiClient.getCoins({
    owner: signerAddress,
    coinType,
    limit: 50
  })

  const richest = coins.data.reduce<{
    coinObjectId: string
    balance: bigint
  } | null>((current, coin) => {
    const balance = BigInt(coin.balance)
    if (!current) return { coinObjectId: coin.coinObjectId, balance }
    return balance > current.balance
      ? { coinObjectId: coin.coinObjectId, balance }
      : current
  }, null)

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

  if (!skipPriceUpdate) {
    await maybeUpdatePythPriceFeed({
      transaction,
      suiClient,
      networkName,
      feedIdHex: pythFeedIdHex,
      hermesUrlOverride,
      onWarning
    })
  }

  const shopArgument = transaction.sharedObjectRef(shopShared.sharedRef)
  const listingArgument = transaction.sharedObjectRef(
    itemListingShared.sharedRef
  )
  const acceptedCurrencyArgument = transaction.sharedObjectRef(
    acceptedCurrencyShared.sharedRef
  )
  const pythPriceInfoArgument = transaction.sharedObjectRef(
    pythPriceInfoShared.sharedRef
  )

  const clockShared = await getSuiSharedObject(
    {
      objectId: SUI_CLOCK_ID,
      mutable: false
    },
    toolingCoreContext
  )

  const clockArgument = transaction.sharedObjectRef(clockShared.sharedRef)
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
