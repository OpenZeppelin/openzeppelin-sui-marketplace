/**
 * Registers an AcceptedCurrency for the Shop and binds it to a Pyth feed.
 * Stores coin metadata from the registry and guardrail caps on the currency object.
 * Requires the ShopOwnerCap capability and a valid PriceInfoObject.
 */
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import {
  findAcceptedCurrencyByCoinType,
  normalizeCoinType,
  requireAcceptedCurrencyByCoinType,
  type AcceptedCurrencySummary
} from "@sui-oracle-market/domain-core/models/currency"
import { buildAddAcceptedCurrencyTransaction } from "@sui-oracle-market/domain-core/ptb/currency"
import {
  assertBytesLength,
  hexToBytes
} from "@sui-oracle-market/tooling-core/hex"
import {
  parseOptionalPositiveU16,
  parseOptionalPositiveU64
} from "@sui-oracle-market/tooling-core/utils/utility"
import {
  DEFAULT_TX_GAS_BUDGET,
  SUI_COIN_REGISTRY_ID
} from "@sui-oracle-market/tooling-node/constants"
import type { Tooling } from "@sui-oracle-market/tooling-node/factory"
import { emitJsonOutput } from "@sui-oracle-market/tooling-node/json"
import { logKeyValueGreen } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { logAcceptedCurrencySummary } from "../../utils/log-summaries.ts"
import { resolveOwnerShopIdentifiers } from "../../utils/shop-context.ts"

runSuiScript(
  async (tooling, cliArguments) => {
    const inputs = await normalizeInputs(
      cliArguments,
      tooling.network.networkName,
      tooling
    )
    const existingAcceptedCurrency = await findAcceptedCurrencyByCoinType({
      coinType: inputs.coinType,
      shopId: inputs.shopId,
      suiClient: tooling.suiClient
    })
    if (existingAcceptedCurrency) {
      if (
        emitJsonOutput(
          {
            status: "already-registered",
            coinType: inputs.coinType,
            acceptedCurrency: existingAcceptedCurrency
          },
          cliArguments.json
        )
      )
        return

      logExistingAcceptedCurrency({
        coinType: inputs.coinType,
        existingAcceptedCurrency
      })
      return
    }

    const shopSharedObject = await tooling.getMutableSharedObject({
      objectId: inputs.shopId
    })
    const currencySharedObject = await tooling.getImmutableSharedObject({
      objectId: inputs.currencyId
    })
    const priceInfoSharedObject = await tooling.getImmutableSharedObject({
      objectId: inputs.priceInfoObjectId
    })

    const gasBudget = tooling.network.gasBudget ?? DEFAULT_TX_GAS_BUDGET

    const addCurrencyTransaction = buildAddAcceptedCurrencyTransaction({
      packageId: inputs.packageId,
      coinType: inputs.coinType,
      shop: shopSharedObject,
      currency: currencySharedObject,
      feedIdBytes: inputs.feedIdBytes,
      pythObjectId: inputs.priceInfoObjectId,
      priceInfoObject: priceInfoSharedObject,
      ownerCapId: inputs.ownerCapId,
      maxPriceAgeSecsCap: inputs.maxPriceAgeSecsCap,
      maxConfidenceRatioBpsCap: inputs.maxConfidenceRatioBpsCap,
      maxPriceStatusLagSecsCap: inputs.maxPriceStatusLagSecsCap,
      gasBudget
    })

    const { execution, summary } = await tooling.executeTransactionWithSummary({
      transaction: addCurrencyTransaction,
      signer: tooling.loadedEd25519KeyPair,
      summaryLabel: "add-accepted-currency",
      devInspect: cliArguments.devInspect,
      dryRun: cliArguments.dryRun
    })

    if (!execution) return

    const acceptedCurrencySummary = await requireAcceptedCurrencyByCoinType({
      coinType: inputs.coinType,
      shopId: inputs.shopId,
      suiClient: tooling.suiClient
    })

    if (
      emitJsonOutput(
        {
          acceptedCurrency: acceptedCurrencySummary,
          feedId: cliArguments.feedId,
          digest: execution.transactionResult.digest,
          transactionSummary: summary
        },
        cliArguments.json
      )
    )
      return

    logAcceptedCurrencySummary(acceptedCurrencySummary)
    logKeyValueGreen("feed id")(cliArguments.feedId)
    logKeyValueGreen("digest")(execution.transactionResult.digest)
  },
  yargs()
    .option("shopPackageId", {
      alias: "shop-package-id",
      type: "string",
      description:
        "Package ID for the sui_oracle_market Move package; defaults to the latest artifact when omitted."
    })
    .option("shopId", {
      alias: "shop-id",
      type: "string",
      description:
        "Shared Shop object ID; defaults to the latest Shop artifact when available."
    })
    .option("ownerCapId", {
      alias: ["owner-cap-id", "owner-cap"],
      type: "string",
      description:
        "ShopOwnerCap object ID authorizing the mutation; defaults to the latest artifact when omitted."
    })
    .option("coinType", {
      alias: ["coin-type", "type"],
      type: "string",
      description:
        "Fully qualified Move coin type to accept (e.g., 0x2::sui::SUI or 0x...::module::Coin).",
      demandOption: true
    })
    .option("currencyId", {
      alias: ["currency-object-id", "currency"],
      type: "string",
      description:
        "Currency<T> object ID in the coin registry. Defaults to the derived CurrencyKey<T> under the shared registry."
    })
    .option("feedId", {
      alias: ["feed-id", "pyth-feed-id"],
      type: "string",
      description:
        "32-byte Pyth price feed identifier as a hex string (e.g., 0x0123...).",
      demandOption: true
    })
    .option("priceInfoObjectId", {
      alias: ["price-info-object-id", "pyth-object-id"],
      type: "string",
      description:
        "PriceInfoObject ID for the Pyth feed (shared object). This ID will also be passed as the pyth_object_id argument.",
      demandOption: true
    })
    .option("maxPriceAgeSecsCap", {
      alias: ["max-price-age-secs-cap", "max-price-age"],
      type: "string",
      description:
        "Optional seller guardrail for maximum price age in seconds. Leave empty to use the module default."
    })
    .option("maxConfidenceRatioBpsCap", {
      alias: ["max-confidence-ratio-bps-cap", "max-confidence-bps"],
      type: "string",
      description:
        "Optional guardrail for maximum confidence ratio (basis points). Leave empty to use the module default."
    })
    .option("maxPriceStatusLagSecsCap", {
      alias: ["max-price-status-lag-secs-cap", "max-status-lag"],
      type: "string",
      description:
        "Optional guardrail for maximum attestation lag in seconds. Leave empty to use the module default."
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

const normalizeInputs = async (
  cliArguments: {
    shopPackageId?: string
    shopId?: string
    ownerCapId?: string
    coinType: string
    feedId: string
    priceInfoObjectId: string
    currencyId?: string
    maxPriceAgeSecsCap?: string
    maxConfidenceRatioBpsCap?: string
    maxPriceStatusLagSecsCap?: string
    devInspect?: boolean
    dryRun?: boolean
    json?: boolean
  },
  networkName: string,
  tooling: Pick<Tooling, "resolveCurrencyObjectId">
) => {
  const { packageId, shopId, ownerCapId } = await resolveOwnerShopIdentifiers({
    networkName,
    shopPackageId: cliArguments.shopPackageId,
    shopId: cliArguments.shopId,
    ownerCapId: cliArguments.ownerCapId
  })

  const coinType = normalizeCoinType(cliArguments.coinType)

  const feedIdBytes = assertBytesLength(hexToBytes(cliArguments.feedId), 32)
  const priceInfoObjectId = normalizeSuiObjectId(cliArguments.priceInfoObjectId)
  const currencyId =
    cliArguments.currencyId ||
    (await tooling.resolveCurrencyObjectId({
      coinType,
      registryId: SUI_COIN_REGISTRY_ID,
      fallbackRegistryScan: true
    }))

  if (!currencyId)
    throw new Error(
      `Could not resolve currency registry entry for ${coinType}. Provide --currency-id or register the coin first.`
    )

  return {
    packageId,
    shopId,
    ownerCapId,
    coinType,
    currencyId: normalizeSuiObjectId(currencyId),
    feedIdBytes,
    priceInfoObjectId,
    maxPriceAgeSecsCap: parseOptionalPositiveU64(
      cliArguments.maxPriceAgeSecsCap,
      "maxPriceAgeSecsCap"
    ),
    maxConfidenceRatioBpsCap: parseOptionalPositiveU16(
      cliArguments.maxConfidenceRatioBpsCap,
      "maxConfidenceRatioBpsCap"
    ),
    maxPriceStatusLagSecsCap: parseOptionalPositiveU64(
      cliArguments.maxPriceStatusLagSecsCap,
      "maxPriceStatusLagSecsCap"
    )
  }
}

const logExistingAcceptedCurrency = ({
  coinType,
  existingAcceptedCurrency
}: {
  coinType: string
  existingAcceptedCurrency: AcceptedCurrencySummary
}) => {
  logKeyValueGreen("coin type")(coinType)
  logKeyValueGreen("status")(
    "already registered; skipping add_accepted_currency"
  )
  logKeyValueGreen("table entry field id")(
    existingAcceptedCurrency.tableEntryFieldId
  )
  logKeyValueGreen("feed id")(existingAcceptedCurrency.feedIdHex)
}
