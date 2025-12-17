import { SuiClient } from "@mysten/sui/client"
import yargs from "yargs"

import {
  type AcceptedCurrencyMatch,
  normalizeOptionalCoinType,
  requireAcceptedCurrencyByCoinType
} from "../../models/currency.ts"
import { resolveLatestShopIdentifiers } from "../../models/shop.ts"
import { loadKeypair } from "../../tooling/keypair.ts"
import { logKeyValueGreen, logKeyValueYellow } from "../../tooling/log.ts"
import type { ObjectArtifact } from "../../tooling/object.ts"
import {
  getSuiSharedObject,
  normalizeOptionalId
} from "../../tooling/object.ts"
import { runSuiScript } from "../../tooling/process.ts"
import { newTransaction, signAndExecute } from "../../tooling/transactions.ts"

type RemoveCurrencyArguments = {
  shopPackageId?: string
  shopId?: string
  ownerCapId?: string
  acceptedCurrencyId?: string
  coinType?: string
}

type NormalizedInputs = {
  packageId: string
  shopId: string
  ownerCapId: string
  acceptedCurrencyId?: string
  coinType?: string
}

runSuiScript(
  async ({ network }, cliArguments) => {
    const suiClient = new SuiClient({ url: network.url })
    const inputs = await normalizeInputs(cliArguments, network.networkName)

    const acceptedCurrency = await resolveAcceptedCurrency(inputs, suiClient)
    const shop = await fetchMutableShop(inputs.shopId, suiClient)
    const signer = await loadKeypair(network.account)

    const removeCurrencyTransaction = buildRemoveCurrencyTransaction({
      packageId: inputs.packageId,
      shop,
      ownerCapId: inputs.ownerCapId,
      acceptedCurrencyId: acceptedCurrency.acceptedCurrencyId
    })

    const {
      objectArtifacts: { deleted },
      transactionResult
    } = await executeRemovalTransaction({
      transaction: removeCurrencyTransaction,
      signer,
      suiClient,
      networkName: network.networkName
    })

    logRemovalOutcome({
      coinType: acceptedCurrency.coinType,
      acceptedCurrencyId: acceptedCurrency.acceptedCurrencyId,
      typeIndexFieldId: acceptedCurrency.typeIndexFieldId,
      acceptedCurrencyFieldId: acceptedCurrency.acceptedCurrencyFieldId,
      deletionArtifacts: deleted,
      digest: transactionResult.digest
    })
  },
  yargs()
    .option("acceptedCurrencyId", {
      alias: ["accepted-currency-id", "currency-id"],
      type: "string",
      description:
        "AcceptedCurrency object ID to remove. If omitted, provide --coin-type to resolve it from dynamic fields."
    })
    .option("coinType", {
      alias: ["coin-type", "type"],
      type: "string",
      description:
        "Fully qualified Move coin type to deregister (e.g., 0x2::sui::SUI). Only required when --accepted-currency-id is not provided."
    })
    .option("shopPackageId", {
      alias: "shop-package-id",
      type: "string",
      description:
        "Package ID for the sui_oracle_market Move package; inferred from artifacts if omitted."
    })
    .option("shopId", {
      alias: "shop-id",
      type: "string",
      description:
        "Shared Shop object ID; defaults to the latest Shop artifact if available."
    })
    .option("ownerCapId", {
      alias: ["owner-cap-id", "owner-cap"],
      type: "string",
      description:
        "ShopOwnerCap object ID that authorizes removing currencies; defaults to the latest artifact when omitted."
    })
    .check((argv) => {
      if (!argv.acceptedCurrencyId && !argv.coinType)
        throw new Error(
          "Provide either --accepted-currency-id or --coin-type to remove a currency."
        )
      return true
    })
    .strict()
)

const normalizeInputs = async (
  cliArguments: RemoveCurrencyArguments,
  networkName: string
): Promise<NormalizedInputs> => {
  const { packageId, shopId, ownerCapId } = await resolveLatestShopIdentifiers(
    {
      packageId: cliArguments.shopPackageId,
      shopId: cliArguments.shopId,
      ownerCapId: cliArguments.ownerCapId
    },
    networkName
  )

  return {
    packageId,
    shopId,
    ownerCapId,
    acceptedCurrencyId: normalizeOptionalId(cliArguments.acceptedCurrencyId),
    coinType: normalizeOptionalCoinType(cliArguments.coinType)
  }
}

const resolveAcceptedCurrency = async (
  inputs: NormalizedInputs,
  suiClient: SuiClient
): Promise<AcceptedCurrencyMatch> => {
  if (inputs.acceptedCurrencyId)
    return {
      coinType: inputs.coinType,
      acceptedCurrencyId: inputs.acceptedCurrencyId
    }

  if (!inputs.coinType)
    throw new Error("coinType is required when acceptedCurrencyId is omitted.")

  return requireAcceptedCurrencyByCoinType({
    coinType: inputs.coinType,
    shopId: inputs.shopId,
    suiClient
  })
}

const fetchMutableShop = (shopId: string, suiClient: SuiClient) =>
  getSuiSharedObject({ objectId: shopId, mutable: true }, suiClient)

const buildRemoveCurrencyTransaction = ({
  packageId,
  shop,
  ownerCapId,
  acceptedCurrencyId
}: {
  packageId: string
  shop: Awaited<ReturnType<typeof getSuiSharedObject>>
  ownerCapId: string
  acceptedCurrencyId: string
}) => {
  const transaction = newTransaction()
  const shopArgument = transaction.sharedObjectRef(shop.sharedRef)

  transaction.moveCall({
    target: `${packageId}::shop::remove_accepted_currency`,
    arguments: [
      shopArgument,
      transaction.pure.id(acceptedCurrencyId),
      transaction.object(ownerCapId)
    ]
  })

  return transaction
}

const executeRemovalTransaction = async ({
  transaction,
  signer,
  suiClient,
  networkName
}: {
  transaction: ReturnType<typeof newTransaction>
  signer: Awaited<ReturnType<typeof loadKeypair>>
  suiClient: SuiClient
  networkName: string
}) =>
  signAndExecute(
    {
      transaction,
      signer,
      networkName
    },
    suiClient
  )

const logRemovalOutcome = ({
  coinType,
  acceptedCurrencyId,
  typeIndexFieldId,
  acceptedCurrencyFieldId,
  deletionArtifacts,
  digest
}: {
  coinType?: string
  acceptedCurrencyId: string
  typeIndexFieldId?: string
  acceptedCurrencyFieldId?: string
  deletionArtifacts?: ObjectArtifact[]
  digest?: string
}) => {
  logKeyValueGreen("accepted currency")(acceptedCurrencyId)
  if (coinType) logKeyValueGreen("coin type")(coinType)
  if (typeIndexFieldId) logKeyValueGreen("type index field")(typeIndexFieldId)
  if (acceptedCurrencyFieldId)
    logKeyValueGreen("currency field")(acceptedCurrencyFieldId)

  const deletedAcceptedCurrency = deletionArtifacts?.find(
    (artifact) => artifact.objectId === acceptedCurrencyId
  )

  if (deletedAcceptedCurrency?.deletedAt)
    logKeyValueGreen("deleted at")(deletedAcceptedCurrency.deletedAt)

  if (digest) logKeyValueGreen("digest")(digest)

  if (!deletedAcceptedCurrency && deletionArtifacts?.length === 0)
    logKeyValueYellow("warning")(
      "Removal succeeded but no deletion artifact was recorded; ensure artifacts are up to date."
    )
}
