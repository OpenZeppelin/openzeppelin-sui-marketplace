import { SuiClient } from "@mysten/sui/client"
import yargs from "yargs"

import {
  type AcceptedCurrencyMatch,
  normalizeOptionalCoinType,
  requireAcceptedCurrencyByCoinType
} from "../../models/currency.ts"
import { resolveLatestShopIdentifiers } from "../../models/shop.ts"
import { loadKeypair } from "../../tooling/keypair.ts"
import { logKeyValueGreen } from "../../tooling/log.ts"
import { normalizeOptionalId } from "../../tooling/object.ts"
import { runSuiScript } from "../../tooling/process.ts"
import { getSuiSharedObject } from "../../tooling/shared-object.ts"
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
    const acceptedCurrencyShared = await getSuiSharedObject(
      { objectId: acceptedCurrency.acceptedCurrencyId, mutable: false },
      suiClient
    )
    const signer = await loadKeypair(network.account)

    const removeCurrencyTransaction = buildRemoveCurrencyTransaction({
      packageId: inputs.packageId,
      shop,
      ownerCapId: inputs.ownerCapId,
      acceptedCurrency: acceptedCurrencyShared
    })

    const { transactionResult } = await executeRemovalTransaction({
      transaction: removeCurrencyTransaction,
      signer,
      suiClient,
      networkName: network.networkName
    })

    logKeyValueGreen("deleted")(acceptedCurrency.acceptedCurrencyId)
    if (transactionResult.digest)
      logKeyValueGreen("digest")(transactionResult.digest)
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
  acceptedCurrency
}: {
  packageId: string
  shop: Awaited<ReturnType<typeof getSuiSharedObject>>
  ownerCapId: string
  acceptedCurrency: Awaited<ReturnType<typeof getSuiSharedObject>>
}) => {
  const transaction = newTransaction()
  const shopArgument = transaction.sharedObjectRef(shop.sharedRef)
  const acceptedCurrencyArgument = transaction.sharedObjectRef(
    acceptedCurrency.sharedRef
  )

  transaction.moveCall({
    target: `${packageId}::shop::remove_accepted_currency`,
    arguments: [
      shopArgument,
      acceptedCurrencyArgument,
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
