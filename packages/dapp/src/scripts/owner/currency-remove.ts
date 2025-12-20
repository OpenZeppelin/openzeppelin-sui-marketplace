import yargs from "yargs"

import {
  type AcceptedCurrencyMatch,
  normalizeOptionalCoinType,
  requireAcceptedCurrencyByCoinType
} from "@sui-oracle-market/domain-core/models/currency"
import { buildRemoveAcceptedCurrencyTransaction } from "@sui-oracle-market/domain-core/ptb/currency"
import { resolveLatestShopIdentifiers } from "@sui-oracle-market/domain-node/shop-identifiers"
import { normalizeOptionalId } from "@sui-oracle-market/tooling-core/object"
import { getSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { createSuiClient } from "@sui-oracle-market/tooling-node/describe-object"
import { loadKeypair } from "@sui-oracle-market/tooling-node/keypair"
import { logKeyValueGreen } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { signAndExecute } from "@sui-oracle-market/tooling-node/transactions"

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
    const suiClient = createSuiClient(network.url)
    const inputs = await normalizeInputs(cliArguments, network.networkName)

    const acceptedCurrency = await resolveAcceptedCurrency(inputs, suiClient)

    const shop = await getSuiSharedObject(
      { objectId: inputs.shopId, mutable: true },
      suiClient
    )
    const acceptedCurrencyShared = await getSuiSharedObject(
      { objectId: acceptedCurrency.acceptedCurrencyId, mutable: false },
      suiClient
    )
    const signer = await loadKeypair(network.account)

    const removeCurrencyTransaction = buildRemoveAcceptedCurrencyTransaction({
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

const executeRemovalTransaction = async ({
  transaction,
  signer,
  suiClient,
  networkName
}: {
  transaction: ReturnType<typeof buildRemoveAcceptedCurrencyTransaction>
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
