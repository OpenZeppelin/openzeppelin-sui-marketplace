/**
 * Builds and executes a buy PTB for a listing, optionally claiming or redeeming a discount.
 * Payments are Coin<T> objects (no approvals); if paying with SUI you need a separate SUI coin for gas.
 * The PTB can update Pyth and then call buy_item/claim_and_buy_item_with_discount in one atomic flow.
 * Oracle freshness and confidence guardrails are enforced on-chain using PriceInfoObject + Clock.
 */
import { normalizeSuiAddress, normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import {
  buildBuyTransaction,
  estimateRequiredAmount,
  resolveDiscountContext,
  resolveDiscountedPriceUsdCents,
  resolvePaymentCoinObjectId
} from "@sui-oracle-market/domain-core/flows/buy"
import {
  normalizeCoinType,
  requireAcceptedCurrencyByCoinType
} from "@sui-oracle-market/domain-core/models/currency"
import {
  buildDiscountTemplateLookup,
  getDiscountTemplateSummary,
  type DiscountContext
} from "@sui-oracle-market/domain-core/models/discount"
import { getItemListingSummary } from "@sui-oracle-market/domain-core/models/item-listing"
import type { PriceUpdatePolicy } from "@sui-oracle-market/domain-core/models/pyth"
import { findCreatedShopItemIds } from "@sui-oracle-market/domain-core/models/shop-item"
import { planSuiPaymentSplitTransaction } from "@sui-oracle-market/tooling-core/coin"
import {
  DEFAULT_TX_GAS_BUDGET,
  NORMALIZED_SUI_COIN_TYPE,
  SUI_CLOCK_ID
} from "@sui-oracle-market/tooling-core/constants"
import type { ObjectArtifact } from "@sui-oracle-market/tooling-core/object"
import {
  deriveRelevantPackageId,
  normalizeIdOrThrow
} from "@sui-oracle-market/tooling-core/object"
import {
  parseOptionalU16,
  parseOptionalU64
} from "@sui-oracle-market/tooling-core/utils/utility"
import { emitJsonOutput } from "@sui-oracle-market/tooling-node/json"
import {
  logKeyValueBlue,
  logKeyValueGreen,
  logKeyValueYellow
} from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { resolveShopIdOrLatest } from "../../utils/shop-context.ts"

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
  devInspect?: boolean
  dryRun?: boolean
  json?: boolean
}

runSuiScript(
  async (tooling, cliArguments: BuyArguments) => {
    const inputs = await normalizeInputs(
      cliArguments,
      tooling.suiConfig.network.networkName
    )

    const signerAddress = tooling.loadedEd25519KeyPair.toSuiAddress()
    const mintTo = inputs.mintTo ?? signerAddress
    const refundTo = inputs.refundTo ?? signerAddress

    const shopShared = await tooling.getImmutableSharedObject({
      objectId: inputs.shopId
    })
    const itemListingShared = await tooling.getMutableSharedObject({
      objectId: inputs.itemListingId
    })

    const shopPackageId = deriveRelevantPackageId(shopShared.object.type)

    const acceptedCurrencySummary = await requireAcceptedCurrencyByCoinType({
      coinType: inputs.coinType,
      shopId: inputs.shopId,
      suiClient: tooling.suiClient
    })

    const pythPriceInfoObjectId = normalizeIdOrThrow(
      acceptedCurrencySummary.pythObjectId,
      `Accepted currency ${acceptedCurrencySummary.coinType} is missing a pyth_object_id.`
    )
    const pythPriceInfoShared = await tooling.getImmutableSharedObject({
      objectId: pythPriceInfoObjectId
    })

    const listingSummary = await getItemListingSummary(
      inputs.shopId,
      inputs.itemListingId,
      tooling.suiClient
    )

    const discountContext = await resolveDiscountContext({
      claimDiscount: inputs.claimDiscount,
      discountTicketId: inputs.discountTicketId,
      discountTemplateId: inputs.discountTemplateId,
      suiClient: tooling.suiClient
    })

    const isSuiPayment = inputs.coinType === NORMALIZED_SUI_COIN_TYPE
    const quotePriceUpdateMode =
      tooling.network.networkName === "localnet"
        ? "localnet-mock"
        : inputs.skipPriceUpdate
          ? "none"
          : "pyth-update"
    let paymentCoinMinimumBalance: bigint | undefined = undefined
    let paymentCoinObjectId: string | undefined = undefined

    if (isSuiPayment) {
      const discountedPriceUsdCents =
        await resolveDiscountedPriceUsdCentsForPurchase({
          shopId: inputs.shopId,
          listingSummary,
          discountContext,
          suiClient: tooling.suiClient
        })

      if (discountedPriceUsdCents === undefined) {
        throw new Error("Missing listing price; unable to quote SUI payment.")
      }

      const clockShared = await tooling.getImmutableSharedObject({
        objectId: SUI_CLOCK_ID
      })

      paymentCoinMinimumBalance = await estimateRequiredAmount({
        shopPackageId,
        shopShared,
        coinType: inputs.coinType,
        pythPriceInfoShared,
        pythFeedIdHex: acceptedCurrencySummary.feedIdHex,
        networkName: tooling.network.networkName,
        priceUsdCents: discountedPriceUsdCents,
        maxPriceAgeSecs: inputs.maxPriceAgeSecs,
        maxConfidenceRatioBps: inputs.maxConfidenceRatioBps,
        clockShared,
        signerAddress,
        suiClient: tooling.suiClient,
        priceUpdateMode: quotePriceUpdateMode,
        hermesUrlOverride: inputs.hermesUrl,
        pythConfigOverride: tooling.suiConfig.network.pyth
      })

      if (paymentCoinMinimumBalance === undefined) {
        throw new Error("Oracle quote unavailable for SUI payment.")
      }

      const splitPlan = await planSuiPaymentSplitTransaction(
        {
          owner: signerAddress,
          paymentMinimum: paymentCoinMinimumBalance,
          gasBudget: BigInt(DEFAULT_TX_GAS_BUDGET),
          splitGasBudget: DEFAULT_TX_GAS_BUDGET,
          paymentCoinObjectId: inputs.paymentCoinObjectId
        },
        { suiClient: tooling.suiClient }
      )

      if (splitPlan.needsSplit && splitPlan.transaction) {
        if (!cliArguments.json) {
          logKeyValueYellow("SUI-split")(
            "Creating payment and gas coins for SUI checkout."
          )
        }

        const splitExecution = await tooling.executeTransactionWithSummary({
          transaction: splitPlan.transaction,
          signer: tooling.loadedEd25519KeyPair,
          summaryLabel: "sui-split",
          devInspect: cliArguments.devInspect,
          dryRun: cliArguments.dryRun
        })

        if (cliArguments.dryRun || !splitExecution.execution) return
      }

      paymentCoinObjectId = splitPlan.paymentCoinObjectId
    }

    if (!paymentCoinObjectId) {
      paymentCoinObjectId = await resolvePaymentCoinObjectId({
        providedCoinObjectId: inputs.paymentCoinObjectId,
        coinType: inputs.coinType,
        signerAddress,
        suiClient: tooling.suiClient,
        minimumBalance: paymentCoinMinimumBalance
      })
    }

    if (!cliArguments.json) {
      logBuyContext({
        networkName: tooling.network.networkName,
        rpcUrl: tooling.network.url,
        packageId: shopPackageId,
        shopId: inputs.shopId,
        listingId: inputs.itemListingId,
        listingName: listingSummary.name,
        itemType: listingSummary.itemType,
        coinType: inputs.coinType,
        acceptedCurrencyTableEntryFieldId:
          acceptedCurrencySummary.tableEntryFieldId,
        pythObjectId: pythPriceInfoObjectId,
        paymentCoinObjectId,
        discountContext
      })
    }

    const buyTransaction = await buildBuyTransaction(
      {
        shopPackageId,
        shopShared,
        itemListingShared,
        pythPriceInfoShared,
        pythFeedIdHex: acceptedCurrencySummary.feedIdHex,
        paymentCoinObjectId,
        coinType: inputs.coinType,
        itemType: listingSummary.itemType,
        mintTo,
        refundTo,
        maxPriceAgeSecs: inputs.maxPriceAgeSecs,
        maxConfidenceRatioBps: inputs.maxConfidenceRatioBps,
        gasBudget: DEFAULT_TX_GAS_BUDGET,
        discountContext,
        skipPriceUpdate: inputs.skipPriceUpdate,
        priceUpdatePolicy: inputs.priceUpdatePolicy,
        hermesUrlOverride: inputs.hermesUrl,
        pythConfigOverride: tooling.suiConfig.network.pyth,
        networkName: tooling.suiConfig.network.networkName,
        signerAddress,
        onWarning: cliArguments.json
          ? undefined
          : (message) => logKeyValueYellow("Oracle")(message)
      },
      tooling.suiClient
    )

    buyTransaction.setGasBudget(DEFAULT_TX_GAS_BUDGET)

    const { execution, summary } = await tooling.executeTransactionWithSummary({
      transaction: buyTransaction,
      signer: tooling.loadedEd25519KeyPair,
      summaryLabel: "buy",
      devInspect: cliArguments.devInspect,
      dryRun: cliArguments.dryRun
    })

    if (!execution) return

    const {
      transactionResult,
      objectArtifacts: { created }
    } = execution

    const createdItemIds = findCreatedShopItemIds(created)
    if (
      emitJsonOutput(
        {
          digest: transactionResult.digest,
          mintTo,
          refundTo,
          createdItemIds,
          transactionSummary: summary
        },
        cliArguments.json
      )
    )
      return

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
        "Shared Shop object ID; defaults to the latest Shop artifact when available."
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
    .option("devInspect", {
      alias: ["dev-inspect", "debug"],
      type: "boolean",
      default: false,
      description: "Run a dev-inspect and log VM error details."
    })
    .option("dryRun", {
      alias: ["dry-run"],
      type: "boolean",
      default: false,
      description: "Run dev-inspect and exit without executing the transaction."
    })
    .option("json", {
      type: "boolean",
      default: false,
      description: "Output results as JSON."
    })
    .strict()
)

const resolveDiscountedPriceUsdCentsForPurchase = async ({
  shopId,
  listingSummary,
  discountContext,
  suiClient
}: {
  shopId: string
  listingSummary: Awaited<ReturnType<typeof getItemListingSummary>>
  discountContext: DiscountContext
  suiClient: Parameters<typeof getItemListingSummary>[2]
}): Promise<bigint | undefined> => {
  if (!listingSummary.basePriceUsdCents) return undefined

  const templateSummary =
    discountContext.mode === "none"
      ? undefined
      : await getDiscountTemplateSummary(
          shopId,
          discountContext.discountTemplateId,
          suiClient
        )
  const discountTemplateLookup = templateSummary
    ? buildDiscountTemplateLookup([templateSummary])
    : {}

  return resolveDiscountedPriceUsdCents({
    basePriceUsdCents: listingSummary.basePriceUsdCents,
    discountSelection: discountContext,
    discountTemplateLookup
  })
}

const normalizeInputs = async (
  cliArguments: BuyArguments,
  networkName: string
) => {
  const shopId = await resolveShopIdOrLatest(cliArguments.shopId, networkName)

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
    maxConfidenceRatioBps: parseOptionalU16(
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
  acceptedCurrencyTableEntryFieldId,
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
  acceptedCurrencyTableEntryFieldId: string
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
  logKeyValueBlue("Accepted-currency-entry")(acceptedCurrencyTableEntryFieldId)
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
