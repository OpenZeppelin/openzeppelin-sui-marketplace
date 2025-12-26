/**
 * Registers a new AcceptedCurrency on a Shop, wiring it to a Pyth feed and price info object.
 * Sui uses Move type tags to represent coin types, and pricing config is stored in a separate object.
 * If you come from EVM, this is like adding a token to a registry plus setting oracle parameters, but via objects.
 * Requires the ShopOwnerCap capability and references shared Pyth PriceInfo data for on-chain price checks.
 */
import type { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import {
  findAcceptedCurrencyByCoinType,
  getAcceptedCurrencySummary,
  normalizeCoinType,
  requireAcceptedCurrencyByCoinType,
  type AcceptedCurrencyMatch
} from "@sui-oracle-market/domain-core/models/currency"
import { buildAddAcceptedCurrencyTransaction } from "@sui-oracle-market/domain-core/ptb/currency"
import { resolveLatestShopIdentifiers } from "@sui-oracle-market/domain-node/shop-identifiers"
import { resolveCurrencyObjectId } from "@sui-oracle-market/tooling-core/coin-registry"
import {
  assertBytesLength,
  hexToBytes
} from "@sui-oracle-market/tooling-core/hex"
import type { ObjectArtifact } from "@sui-oracle-market/tooling-core/object"
import { parseOptionalPositiveU64 } from "@sui-oracle-market/tooling-core/utils/utility"
import { SUI_COIN_REGISTRY_ID } from "@sui-oracle-market/tooling-node/constants"
import { logKeyValueGreen } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { logAcceptedCurrencySummary } from "../../utils/log-summaries.ts"

type AddCurrencyArguments = {
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
}

type NormalizedInputs = {
  packageId: string
  shopId: string
  ownerCapId: string
  coinType: string
  currencyId: string
  feedIdBytes: number[]
  priceInfoObjectId: string
  maxPriceAgeSecsCap?: bigint
  maxConfidenceRatioBpsCap?: bigint
  maxPriceStatusLagSecsCap?: bigint
}

runSuiScript(
  async (tooling, cliArguments) => {
    const suiClient = tooling.suiClient
    const inputs = await normalizeInputs(
      cliArguments,
      tooling.network.networkName,
      suiClient
    )
    const existingAcceptedCurrency = await findAcceptedCurrencyByCoinType({
      coinType: inputs.coinType,
      shopId: inputs.shopId,
      suiClient
    })
    if (existingAcceptedCurrency) {
      logExistingAcceptedCurrency({
        coinType: inputs.coinType,
        existingAcceptedCurrency
      })
      return
    }

    const shopSharedObject = await tooling.getSuiSharedObject({
      objectId: inputs.shopId,
      mutable: true
    })
    const currencySharedObject = await tooling.getSuiSharedObject({
      objectId: inputs.currencyId,
      mutable: false
    })
    const priceInfoSharedObject = await tooling.getSuiSharedObject({
      objectId: inputs.priceInfoObjectId,
      mutable: false
    })

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
      maxPriceStatusLagSecsCap: inputs.maxPriceStatusLagSecsCap
    })

    const {
      objectArtifacts: { created }
    } = await tooling.signAndExecute({
      transaction: addCurrencyTransaction,
      signer: tooling.loadedEd25519KeyPair
    })

    const createdAcceptedCurrency = findAcceptedCurrency(created)
    const acceptedCurrencyId =
      createdAcceptedCurrency?.objectId ||
      (await requireAcceptedCurrencyId({
        shopId: inputs.shopId,
        coinType: inputs.coinType,
        suiClient
      }))

    const acceptedCurrencySummary = await getAcceptedCurrencySummary(
      inputs.shopId,
      acceptedCurrencyId,
      suiClient
    )

    logAcceptedCurrencySummary(acceptedCurrencySummary)
    logKeyValueGreen("feed id")(cliArguments.feedId)
    if (createdAcceptedCurrency?.digest)
      logKeyValueGreen("digest")(createdAcceptedCurrency.digest)
  },
  yargs()
    .option("shopPackageId", {
      alias: "shop-package-id",
      type: "string",
      description:
        "Package ID for the sui_oracle_market Move package. If omitted, the latest Shop artifact will be used.",
      demandOption: false
    })
    .option("shopId", {
      alias: "shop-id",
      type: "string",
      description:
        "Shared Shop object ID; defaults to the latest Shop artifact when available.",
      demandOption: false
    })
    .option("ownerCapId", {
      alias: ["owner-cap-id", "owner-cap"],
      type: "string",
      description:
        "ShopOwnerCap object ID authorizing the mutation; defaults to the latest artifact when available.",
      demandOption: false
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
    .strict()
)

const normalizeInputs = async (
  cliArguments: AddCurrencyArguments,
  networkName: string,
  suiClient: SuiClient
): Promise<NormalizedInputs> => {
  const { packageId, shopId, ownerCapId } = await resolveLatestShopIdentifiers(
    {
      packageId: cliArguments.shopPackageId,
      shopId: cliArguments.shopId,
      ownerCapId: cliArguments.ownerCapId
    },
    networkName
  )

  const coinType = normalizeCoinType(cliArguments.coinType)

  const feedIdBytes = assertBytesLength(hexToBytes(cliArguments.feedId), 32)
  const priceInfoObjectId = normalizeSuiObjectId(cliArguments.priceInfoObjectId)
  const currencyId =
    cliArguments.currencyId ||
    (await resolveCurrencyObjectId(
      {
        coinType,
        registryId: SUI_COIN_REGISTRY_ID,
        fallbackRegistryScan: true
      },
      { suiClient }
    ))

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
    maxConfidenceRatioBpsCap: parseOptionalPositiveU64(
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
  existingAcceptedCurrency: AcceptedCurrencyMatch
}) => {
  logKeyValueGreen("coin type")(coinType)
  logKeyValueGreen("status")(
    "already registered; skipping add_accepted_currency"
  )
  if (existingAcceptedCurrency.acceptedCurrencyId)
    logKeyValueGreen("accepted currency id")(
      existingAcceptedCurrency.acceptedCurrencyId
    )
  if (existingAcceptedCurrency.acceptedCurrencyFieldId)
    logKeyValueGreen("currency field id")(
      existingAcceptedCurrency.acceptedCurrencyFieldId
    )
  if (existingAcceptedCurrency.typeIndexFieldId)
    logKeyValueGreen("type index field id")(
      existingAcceptedCurrency.typeIndexFieldId
    )
}

const findAcceptedCurrency = (createdArtifacts?: ObjectArtifact[]) =>
  createdArtifacts?.find((artifact) =>
    artifact.objectType?.endsWith("::shop::AcceptedCurrency")
  )

const requireAcceptedCurrencyId = async ({
  shopId,
  coinType,
  suiClient
}: {
  shopId: string
  coinType: string
  suiClient: SuiClient
}): Promise<string> => {
  const match = await requireAcceptedCurrencyByCoinType({
    coinType,
    shopId,
    suiClient
  })
  return match.acceptedCurrencyId
}
