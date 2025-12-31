/**
 * Executes a purchase transaction for an ItemListing, optionally claiming and redeeming a discount in one PTB.
 * Sui payments use coin objects, so you pass specific Coin objects instead of approving an allowance.
 * If you come from EVM, this bundles multiple calls into a programmable transaction block and consumes shared objects
 * (Shop, Listing, PriceInfo) explicitly while minting a receipt object to the buyer.
 * Oracle freshness checks rely on shared Pyth price objects and the Sui Clock.
 */
import { normalizeSuiAddress, normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import {
  buildBuyTransaction,
  resolveDiscountContext,
  resolvePaymentCoinObjectId
} from "@sui-oracle-market/domain-core/flows/buy"
import type { DiscountContext } from "@sui-oracle-market/domain-core/models/discount"
import {
  getAcceptedCurrencySummary,
  normalizeCoinType,
  requireAcceptedCurrencyByCoinType
} from "@sui-oracle-market/domain-core/models/currency"
import { getItemListingSummary } from "@sui-oracle-market/domain-core/models/item-listing"
import { findCreatedShopItemIds } from "@sui-oracle-market/domain-core/models/shop-item"
import type { PriceUpdatePolicy } from "@sui-oracle-market/domain-core/models/pyth"
import type { ObjectArtifact } from "@sui-oracle-market/tooling-core/object"
import {
  deriveRelevantPackageId,
  normalizeIdOrThrow
} from "@sui-oracle-market/tooling-core/object"
import { parseOptionalU64 } from "@sui-oracle-market/tooling-core/utils/utility"
import {
  logKeyValueBlue,
  logKeyValueGreen,
  logKeyValueYellow
} from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { resolveLatestArtifactShopId } from "@sui-oracle-market/domain-node/shop"

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
  priceUpdatePolicy?: string
  hermesUrl?: string
}

runSuiScript(
  async (tooling, cliArguments: BuyArguments) => {
    const inputs = await normalizeInputs(
      cliArguments,
      tooling.suiConfig.network.networkName
    )

    const mintTo = inputs.mintTo ?? tooling.loadedEd25519KeyPair.toSuiAddress()
    const refundTo =
      inputs.refundTo ?? tooling.loadedEd25519KeyPair.toSuiAddress()

    const shopShared = await tooling.getSuiSharedObject({
      objectId: inputs.shopId,
      mutable: false
    })
    const itemListingShared = await tooling.getSuiSharedObject({
      objectId: inputs.itemListingId,
      mutable: true
    })

    const shopPackageId = deriveRelevantPackageId(shopShared.object.type)

    const acceptedCurrencyMatch = await requireAcceptedCurrencyByCoinType({
      coinType: inputs.coinType,
      shopId: inputs.shopId,
      suiClient: tooling.suiClient
    })

    const acceptedCurrencySummary = await getAcceptedCurrencySummary(
      inputs.shopId,
      acceptedCurrencyMatch.acceptedCurrencyId,
      tooling.suiClient
    )

    const pythPriceInfoObjectId = normalizeIdOrThrow(
      acceptedCurrencySummary.pythObjectId,
      `AcceptedCurrency ${acceptedCurrencySummary.acceptedCurrencyId} is missing a pyth_object_id.`
    )

    const acceptedCurrencyShared = await tooling.getSuiSharedObject({
      objectId: acceptedCurrencySummary.acceptedCurrencyId,
      mutable: false
    })
    const pythPriceInfoShared = await tooling.getSuiSharedObject({
      objectId: pythPriceInfoObjectId,
      mutable: false
    })

    const listingSummary = await getItemListingSummary(
      inputs.shopId,
      inputs.itemListingId,
      tooling.suiClient
    )

    const paymentCoinObjectId = await resolvePaymentCoinObjectId({
      providedCoinObjectId: inputs.paymentCoinObjectId,
      coinType: inputs.coinType,
      signerAddress: tooling.loadedEd25519KeyPair.toSuiAddress(),
      suiClient: tooling.suiClient
    })

    const discountContext = await resolveDiscountContext({
      claimDiscount: inputs.claimDiscount,
      discountTicketId: inputs.discountTicketId,
      discountTemplateId: inputs.discountTemplateId,
      suiClient: tooling.suiClient
    })

    logBuyContext({
      networkName: tooling.network.networkName,
      rpcUrl: tooling.network.url,
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
        priceUpdatePolicy: inputs.priceUpdatePolicy,
        hermesUrlOverride: inputs.hermesUrl,
        pythConfigOverride: tooling.suiConfig.network.pyth,
        networkName: tooling.suiConfig.network.networkName,
        signerAddress: tooling.loadedEd25519KeyPair.toSuiAddress(),
        onWarning: (message) => logKeyValueYellow("Oracle")(message)
      },
      tooling.suiClient
    )

    const {
      transactionResult,
      objectArtifacts: { created }
    } = await tooling.signAndExecute({
      transaction: buyTransaction,
      signer: tooling.loadedEd25519KeyPair
    })

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
    .option("priceUpdatePolicy", {
      alias: ["price-update-policy"],
      type: "string",
      choices: ["auto", "required", "skip"],
      description:
        "How to handle oracle price updates. auto: update when config exists. required: always update or fail. skip: never update."
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
) => {
  const shopId = await resolveLatestArtifactShopId(
    cliArguments.shopId,
    networkName
  )

  const coinType = normalizeCoinType(cliArguments.coinType)

  if (cliArguments.claimDiscount && cliArguments.discountTicketId)
    throw new Error(
      "Use either --claim-discount or --discount-ticket-id, not both."
    )

  const defaultPriceUpdatePolicy: PriceUpdatePolicy =
    networkName === "localnet" ||
    networkName === "testnet" ||
    networkName === "mainnet"
      ? "required"
      : "auto"
  const resolvedPriceUpdatePolicy = resolvePriceUpdatePolicyInput(
    cliArguments.priceUpdatePolicy
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
    priceUpdatePolicy: resolvedPriceUpdatePolicy ?? defaultPriceUpdatePolicy,
    hermesUrl: cliArguments.hermesUrl?.trim() || undefined
  }
}

const resolvePriceUpdatePolicyInput = (
  value?: string
): PriceUpdatePolicy | undefined => {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase()
  if (
    normalized === "auto" ||
    normalized === "required" ||
    normalized === "skip"
  )
    return normalized
  throw new Error("priceUpdatePolicy must be one of: auto, required, skip.")
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

  const receipts = findCreatedShopItemIds(createdObjects)
  if (receipts.length > 0)
    receipts.forEach((receiptId, index) =>
      logKeyValueGreen(`receipt-${index + 1}`)(receiptId)
    )
  else
    logKeyValueYellow("receipt")(
      "No ShopItem receipts detected in created objects; check transaction outputs."
    )

  if (digest) logKeyValueGreen("digest")(digest)
}
