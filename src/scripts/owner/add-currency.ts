import { SuiClient } from "@mysten/sui/client"
import { deriveObjectID, normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { resolveShopIdentifiers } from "../../models/shop.ts"
import { SUI_COIN_REGISTRY_ID } from "../../tooling/constants.ts"
import { assertBytesLength, hexToBytes } from "../../tooling/hex.ts"
import { loadKeypair } from "../../tooling/keypair.ts"
import { logKeyValueGreen } from "../../tooling/log.ts"
import type { ObjectArtifact } from "../../tooling/object.ts"
import { getSuiSharedObject } from "../../tooling/object.ts"
import { runSuiScript } from "../../tooling/process.ts"
import { newTransaction, signAndExecute } from "../../tooling/transactions.ts"
import { parseOptionalU64 } from "../../utils/utility.ts"

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
  async ({ network }, cliArguments) => {
    const inputs = await normalizeInputs(cliArguments, network.networkName)
    const suiClient = new SuiClient({ url: network.url })
    const signer = await loadKeypair(network.account)

    const shopSharedObject = await getSuiSharedObject(
      { objectId: inputs.shopId, mutable: true },
      suiClient
    )
    const currencySharedObject = await getSuiSharedObject(
      { objectId: inputs.currencyId, mutable: false },
      suiClient
    )
    const priceInfoSharedObject = await getSuiSharedObject(
      { objectId: inputs.priceInfoObjectId, mutable: false },
      suiClient
    )

    const addCurrencyTransaction = buildAddCurrencyTransaction({
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
    } = await signAndExecute(
      {
        transaction: addCurrencyTransaction,
        signer,
        networkName: network.networkName
      },
      suiClient
    )

    logAcceptedCurrencyCreation({
      createdAcceptedCurrency: findAcceptedCurrency(created),
      coinType: inputs.coinType,
      feedId: cliArguments.feedId
    })
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
  networkName: string
): Promise<NormalizedInputs> => {
  const { packageId, shopId, ownerCapId } = await resolveShopIdentifiers(
    {
      packageId: cliArguments.shopPackageId,
      shopId: cliArguments.shopId,
      ownerCapId: cliArguments.ownerCapId
    },
    networkName
  )

  const coinType = cliArguments.coinType.trim()
  if (!coinType)
    throw new Error(
      "coinType must be a fully qualified Move type (e.g., 0x2::sui::SUI)."
    )

  const feedIdBytes = assertBytesLength(hexToBytes(cliArguments.feedId), 32)
  const priceInfoObjectId = normalizeSuiObjectId(cliArguments.priceInfoObjectId)
  const currencyId =
    cliArguments.currencyId ||
    deriveCurrencyObjectId(coinType, SUI_COIN_REGISTRY_ID)

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

const parseOptionalPositiveU64 = (
  rawValue: string | undefined,
  label: string
): bigint | undefined => {
  const parsedValue = parseOptionalU64(rawValue, label)
  if (parsedValue === undefined) return undefined
  if (parsedValue <= 0n)
    throw new Error(`${label} must be greater than zero when provided.`)
  return parsedValue
}

const deriveCurrencyObjectId = (coinType: string, registryId: string) =>
  normalizeSuiObjectId(
    deriveObjectID(
      registryId,
      `0x2::coin_registry::CurrencyKey<${coinType}>`,
      new Uint8Array()
    )
  )

const buildAddCurrencyTransaction = ({
  packageId,
  coinType,
  shop,
  currency,
  feedIdBytes,
  pythObjectId,
  priceInfoObject,
  ownerCapId,
  maxPriceAgeSecsCap,
  maxConfidenceRatioBpsCap,
  maxPriceStatusLagSecsCap
}: {
  packageId: string
  coinType: string
  shop: Awaited<ReturnType<typeof getSuiSharedObject>>
  currency: Awaited<ReturnType<typeof getSuiSharedObject>>
  feedIdBytes: number[]
  pythObjectId: string
  priceInfoObject: Awaited<ReturnType<typeof getSuiSharedObject>>
  ownerCapId: string
  maxPriceAgeSecsCap?: bigint
  maxConfidenceRatioBpsCap?: bigint
  maxPriceStatusLagSecsCap?: bigint
}) => {
  const transaction = newTransaction()

  const shopArgument = transaction.sharedObjectRef(shop.sharedRef)
  const currencyArgument = transaction.sharedObjectRef(currency.sharedRef)
  const priceInfoArgument = transaction.sharedObjectRef(
    priceInfoObject.sharedRef
  )

  transaction.moveCall({
    target: `${packageId}::shop::add_accepted_currency`,
    typeArguments: [coinType],
    arguments: [
      shopArgument,
      currencyArgument,
      transaction.pure.vector("u8", feedIdBytes),
      transaction.pure.id(pythObjectId),
      priceInfoArgument,
      transaction.pure.option("u64", maxPriceAgeSecsCap ?? null),
      transaction.pure.option("u64", maxConfidenceRatioBpsCap ?? null),
      transaction.pure.option("u64", maxPriceStatusLagSecsCap ?? null),
      transaction.object(ownerCapId)
    ]
  })

  return transaction
}

const findAcceptedCurrency = (createdArtifacts?: ObjectArtifact[]) =>
  createdArtifacts?.find((artifact) =>
    artifact.objectType?.endsWith("::shop::AcceptedCurrency")
  )

const logAcceptedCurrencyCreation = ({
  createdAcceptedCurrency,
  coinType,
  feedId
}: {
  createdAcceptedCurrency?: ObjectArtifact
  coinType: string
  feedId: string
}) => {
  if (createdAcceptedCurrency?.objectId)
    logKeyValueGreen("accepted currency id")(createdAcceptedCurrency.objectId)
  logKeyValueGreen("coin type")(coinType)
  logKeyValueGreen("feed id")(feedId)
  if (createdAcceptedCurrency?.digest)
    logKeyValueGreen("digest")(createdAcceptedCurrency.digest)
}
