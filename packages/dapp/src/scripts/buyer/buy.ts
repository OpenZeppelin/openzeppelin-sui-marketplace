import { SuiClient } from "@mysten/sui/client"
import { type Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import type { Transaction } from "@mysten/sui/transactions"
import { normalizeSuiAddress, normalizeSuiObjectId } from "@mysten/sui/utils"
import {
  SuiPriceServiceConnection,
  SuiPythClient
} from "@pythnetwork/pyth-sui-js"
import yargs from "yargs"

import {
  getAcceptedCurrencySummary,
  normalizeCoinType,
  requireAcceptedCurrencyByCoinType
} from "../../models/currency.ts"
import {
  parseDiscountTicketFromObject,
  type DiscountTicketDetails
} from "../../models/discount.ts"
import { getItemListingSummary } from "../../models/item-listing.ts"
import { getPythPullOracleConfig } from "../../models/pyth.ts"
import { resolveLatestArtifactShopId } from "../../models/shop.ts"
import { loadKeypair } from "../../tooling/keypair.ts"
import {
  logKeyValueBlue,
  logKeyValueGreen,
  logKeyValueYellow
} from "../../tooling/log.ts"
import type { ObjectArtifact } from "../../tooling/object.ts"
import {
  deriveRelevantPackageId,
  getSuiObject,
  normalizeIdOrThrow
} from "../../tooling/object.ts"
import { runSuiScript } from "../../tooling/process.ts"
import { getSuiSharedObject } from "../../tooling/shared-object.ts"
import { newTransaction, signAndExecute } from "../../tooling/transactions.ts"
import { parseOptionalU64, requireValue } from "../../utils/utility.ts"

type BuyArguments = {
  shopId?: string
  itemListingId: string
  coinType: string
  paymentCoinObjectId?: string
  mintTo?: string
  refundTo?: string
  discountTicketId?: string
  discountTemplateId?: string
  claimDiscount?: boolean
  maxPriceAgeSecs?: string
  maxConfidenceRatioBps?: string
  skipPriceUpdate?: boolean
  hermesUrl?: string
}

type NormalizedBuyInputs = {
  shopId: string
  itemListingId: string
  coinType: string
  paymentCoinObjectId?: string
  mintTo?: string
  refundTo?: string
  discountTicketId?: string
  discountTemplateId?: string
  claimDiscount: boolean
  maxPriceAgeSecs?: bigint
  maxConfidenceRatioBps?: bigint
  skipPriceUpdate: boolean
  hermesUrl?: string
}

runSuiScript(
  async ({ network, currentNetwork }, cliArguments: BuyArguments) => {
    const inputs = await normalizeInputs(cliArguments, network.networkName)
    const suiClient = new SuiClient({ url: network.url })
    const signer = await loadKeypair(network.account)

    const signerAddress = signer.toSuiAddress()
    const mintTo = inputs.mintTo ?? signerAddress
    const refundTo = inputs.refundTo ?? signerAddress

    const shopShared = await getSuiSharedObject(
      { objectId: inputs.shopId, mutable: false },
      suiClient
    )
    const itemListingShared = await getSuiSharedObject(
      { objectId: inputs.itemListingId, mutable: true },
      suiClient
    )

    const shopPackageId = deriveRelevantPackageId(shopShared.object.type)

    const acceptedCurrencyMatch = await requireAcceptedCurrencyByCoinType({
      coinType: inputs.coinType,
      shopId: inputs.shopId,
      suiClient
    })

    const acceptedCurrencySummary = await getAcceptedCurrencySummary(
      inputs.shopId,
      acceptedCurrencyMatch.acceptedCurrencyId,
      suiClient
    )

    const pythPriceInfoObjectId = normalizeIdOrThrow(
      acceptedCurrencySummary.pythObjectId,
      `AcceptedCurrency ${acceptedCurrencySummary.acceptedCurrencyId} is missing a pyth_object_id.`
    )

    const acceptedCurrencyShared = await getSuiSharedObject(
      { objectId: acceptedCurrencySummary.acceptedCurrencyId, mutable: false },
      suiClient
    )
    const pythPriceInfoShared = await getSuiSharedObject(
      { objectId: pythPriceInfoObjectId, mutable: false },
      suiClient
    )

    const listingSummary = await getItemListingSummary(
      inputs.shopId,
      inputs.itemListingId,
      suiClient
    )

    const paymentCoinObjectId = await resolvePaymentCoinObjectId({
      providedCoinObjectId: inputs.paymentCoinObjectId,
      coinType: inputs.coinType,
      signer,
      suiClient
    })

    const discountContext = await resolveDiscountContext({
      claimDiscount: inputs.claimDiscount,
      discountTicketId: inputs.discountTicketId,
      discountTemplateId: inputs.discountTemplateId,
      suiClient
    })

    logBuyContext({
      networkName: currentNetwork,
      rpcUrl: network.url,
      packageId: shopPackageId,
      shopId: inputs.shopId,
      listingId: inputs.itemListingId,
      listingName: listingSummary.name,
      itemType: listingSummary.itemType,
      coinType: inputs.coinType,
      acceptedCurrencyId: acceptedCurrencySummary.acceptedCurrencyId,
      pythObjectId: pythPriceInfoObjectId,
      paymentCoinObjectId,
      discountContext
    })

    const buyTransaction = await buildBuyTransaction(
      {
        shopPackageId,
        shopShared,
        itemListingShared,
        acceptedCurrencyShared,
        pythPriceInfoShared,
        pythFeedIdHex: acceptedCurrencySummary.feedIdHex,
        paymentCoinObjectId,
        coinType: inputs.coinType,
        itemType: listingSummary.itemType,
        mintTo,
        refundTo,
        maxPriceAgeSecs: inputs.maxPriceAgeSecs,
        maxConfidenceRatioBps: inputs.maxConfidenceRatioBps,
        discountContext,
        skipPriceUpdate: inputs.skipPriceUpdate,
        hermesUrlOverride: inputs.hermesUrl,
        networkName: network.networkName,
        signerAddress,
        signer
      },
      suiClient
    )

    const {
      transactionResult,
      objectArtifacts: { created }
    } = await signAndExecute(
      {
        transaction: buyTransaction,
        signer,
        networkName: network.networkName
      },
      suiClient
    )

    logBuyResult({
      digest: transactionResult.digest,
      createdObjects: created,
      mintTo,
      refundTo
    })
  },
  yargs()
    .option("shopId", {
      alias: "shop-id",
      type: "string",
      description:
        "Shared Shop object ID; defaults to the latest Shop artifact when available.",
      demandOption: false
    })
    .option("itemListingId", {
      alias: ["item-listing-id", "listing-id"],
      type: "string",
      description: "ItemListing object ID to buy.",
      demandOption: true
    })
    .option("coinType", {
      alias: ["coin-type"],
      type: "string",
      description:
        "Coin type to pay with (must be registered as an AcceptedCurrency), e.g. 0x2::sui::SUI.",
      demandOption: true
    })
    .option("paymentCoinObjectId", {
      alias: ["payment-coin-object-id", "coin-object-id"],
      type: "string",
      description:
        "Optional specific Coin object ID to use as payment; otherwise the script will select a coin owned by the signer."
    })
    .option("mintTo", {
      alias: ["mint-to"],
      type: "string",
      description:
        "Address that receives the purchased ShopItem receipt (defaults to the signer address)."
    })
    .option("refundTo", {
      alias: ["refund-to"],
      type: "string",
      description:
        "Address that receives any refunded change (defaults to the signer address)."
    })
    .option("discountTicketId", {
      alias: ["discount-ticket-id", "ticket-id"],
      type: "string",
      description:
        "Optional DiscountTicket object ID to redeem during checkout (uses buy_item_with_discount)."
    })
    .option("discountTemplateId", {
      alias: ["discount-template-id", "template-id"],
      type: "string",
      description:
        "Optional DiscountTemplate object ID. Required when using --claim-discount."
    })
    .option("claimDiscount", {
      alias: ["claim-discount", "claim-and-buy"],
      type: "boolean",
      description:
        "If set, the checkout will claim + redeem a ticket atomically using claim_and_buy_item_with_discount (requires --discount-template-id).",
      default: false
    })
    .option("maxPriceAgeSecs", {
      alias: ["max-price-age-secs"],
      type: "string",
      description:
        "Optional tighter max age (seconds) for oracle freshness. Pass nothing to use the seller-set cap."
    })
    .option("maxConfidenceRatioBps", {
      alias: ["max-confidence-ratio-bps"],
      type: "string",
      description:
        "Optional tighter max confidence ratio in bps (e.g., 500 = 5%). Pass nothing to use the seller-set cap."
    })
    .option("skipPriceUpdate", {
      alias: ["skip-price-update"],
      type: "boolean",
      description:
        "Skip the Hermes + Pyth price update step (not recommended on testnet/mainnet).",
      default: false
    })
    .option("hermesUrl", {
      alias: ["hermes-url"],
      type: "string",
      description:
        "Optional Hermes endpoint override (defaults to hermes-beta on testnet and hermes on mainnet)."
    })
    .strict()
)

const normalizeInputs = async (
  cliArguments: BuyArguments,
  networkName: string
): Promise<NormalizedBuyInputs> => {
  const shopId = await resolveLatestArtifactShopId(
    cliArguments.shopId,
    networkName
  )

  const coinType = normalizeCoinType(cliArguments.coinType)

  if (cliArguments.claimDiscount && cliArguments.discountTicketId)
    throw new Error(
      "Use either --claim-discount or --discount-ticket-id, not both."
    )

  return {
    shopId,
    itemListingId: normalizeSuiObjectId(cliArguments.itemListingId),
    coinType,
    paymentCoinObjectId: cliArguments.paymentCoinObjectId
      ? normalizeSuiObjectId(cliArguments.paymentCoinObjectId)
      : undefined,
    mintTo: cliArguments.mintTo
      ? normalizeSuiAddress(cliArguments.mintTo)
      : undefined,
    refundTo: cliArguments.refundTo
      ? normalizeSuiAddress(cliArguments.refundTo)
      : undefined,
    discountTicketId: cliArguments.discountTicketId
      ? normalizeSuiObjectId(cliArguments.discountTicketId)
      : undefined,
    discountTemplateId: cliArguments.discountTemplateId
      ? normalizeSuiObjectId(cliArguments.discountTemplateId)
      : undefined,
    claimDiscount: Boolean(cliArguments.claimDiscount),
    maxPriceAgeSecs: parseOptionalU64(
      cliArguments.maxPriceAgeSecs,
      "maxPriceAgeSecs"
    ),
    maxConfidenceRatioBps: parseOptionalU64(
      cliArguments.maxConfidenceRatioBps,
      "maxConfidenceRatioBps"
    ),
    skipPriceUpdate: Boolean(cliArguments.skipPriceUpdate),
    hermesUrl: cliArguments.hermesUrl?.trim() || undefined
  }
}

type DiscountContext =
  | { mode: "none" }
  | {
      mode: "ticket"
      discountTicketId: string
      discountTemplateId: string
      ticketDetails: DiscountTicketDetails
    }
  | { mode: "claim"; discountTemplateId: string }

const resolveDiscountContext = async ({
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
    suiClient
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

const resolvePaymentCoinObjectId = async ({
  providedCoinObjectId,
  coinType,
  signer,
  suiClient
}: {
  providedCoinObjectId?: string
  coinType: string
  signer: Ed25519Keypair
  suiClient: SuiClient
}): Promise<string> => {
  if (providedCoinObjectId) return providedCoinObjectId

  const signerAddress = signer.toSuiAddress()
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

const isSuiCoinType = (coinType: string) =>
  normalizeCoinType(coinType) === "0x2::sui::SUI"

const fetchObjectRef = async (objectId: string, suiClient: SuiClient) => {
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

  const gasRef = await fetchObjectRef(gasCandidate.coinObjectId, suiClient)
  transaction.setGasOwner(signerAddress)
  transaction.setGasPayment([gasRef])
}

const buildBuyTransaction = async (
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
    signer
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
    signer: Ed25519Keypair
  },
  suiClient: SuiClient
) => {
  const transaction = newTransaction()
  transaction.setSender(signer.toSuiAddress())

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
      hermesUrlOverride
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
      objectId:
        "0x0000000000000000000000000000000000000000000000000000000000000006",
      mutable: false
    },
    suiClient
  )

  const clockArgument = transaction.sharedObjectRef(clockShared.sharedRef)
  const paymentArgument = transaction.object(paymentCoinObjectId)

  const typeArguments = [itemType, coinType]

  if (discountContext.mode === "claim") {
    const discountTemplateShared = await getSuiSharedObject(
      { objectId: discountContext.discountTemplateId, mutable: true },
      suiClient
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
      suiClient
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
}) => {
  const config = getPythPullOracleConfig(networkName)
  if (!config) {
    logKeyValueYellow("Oracle")(
      `Skipping Pyth pull update: no config for network ${networkName}. Use --skip-price-update to silence this warning.`
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

const logBuyContext = ({
  networkName,
  rpcUrl,
  packageId,
  shopId,
  listingId,
  listingName,
  itemType,
  coinType,
  acceptedCurrencyId,
  pythObjectId,
  paymentCoinObjectId,
  discountContext
}: {
  networkName: string
  rpcUrl: string
  packageId: string
  shopId: string
  listingId: string
  listingName?: string
  itemType: string
  coinType: string
  acceptedCurrencyId: string
  pythObjectId: string
  paymentCoinObjectId: string
  discountContext: DiscountContext
}) => {
  logKeyValueBlue("Network")(networkName)
  logKeyValueBlue("RPC")(rpcUrl)
  logKeyValueBlue("Package")(packageId)
  logKeyValueBlue("Shop")(shopId)
  logKeyValueBlue("Listing")(listingId)
  if (listingName) logKeyValueBlue("Listing-name")(listingName)
  logKeyValueBlue("Item-type")(itemType)
  logKeyValueBlue("Coin-type")(coinType)
  logKeyValueBlue("Accepted-currency")(acceptedCurrencyId)
  logKeyValueBlue("Pyth-price-info")(pythObjectId)
  logKeyValueBlue("Payment-coin")(paymentCoinObjectId)

  if (discountContext.mode === "claim")
    logKeyValueBlue("Discount")("claim + buy")
  else if (discountContext.mode === "ticket") {
    logKeyValueBlue("Discount")("redeem ticket")
    logKeyValueBlue("Ticket")(discountContext.discountTicketId)
    logKeyValueBlue("Template")(discountContext.discountTemplateId)
  } else logKeyValueBlue("Discount")("none")

  console.log("")
}

const findPurchasedShopItems = (created: ObjectArtifact[]) =>
  created.filter((object) => object.objectType.includes("::shop::ShopItem"))

const logBuyResult = ({
  digest,
  createdObjects,
  mintTo,
  refundTo
}: {
  digest?: string
  createdObjects: ObjectArtifact[]
  mintTo: string
  refundTo: string
}) => {
  logKeyValueGreen("mint-to")(mintTo)
  logKeyValueGreen("refund-to")(refundTo)

  const receipts = findPurchasedShopItems(createdObjects)
  if (receipts.length > 0)
    receipts.forEach((receipt, index) =>
      logKeyValueGreen(`receipt-${index + 1}`)(receipt.objectId)
    )
  else
    logKeyValueYellow("receipt")(
      "No ShopItem receipts detected in created objects; check transaction outputs."
    )

  if (digest) logKeyValueGreen("digest")(digest)
}
