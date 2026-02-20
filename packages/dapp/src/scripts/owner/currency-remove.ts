/**
 * Unregisters an accepted coin type from the shop.
 * Requires the ShopOwnerCap capability.
 */
import yargs from "yargs"

import { requireAcceptedCurrencyByCoinType } from "@sui-oracle-market/domain-core/models/currency"
import { buildRemoveAcceptedCurrencyTransaction } from "@sui-oracle-market/domain-core/ptb/currency"
import { normalizeOptionalCoinType } from "@sui-oracle-market/tooling-core/coin"
import { emitJsonOutput } from "@sui-oracle-market/tooling-node/json"
import { logKeyValueGreen } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { resolveOwnerShopIdentifiers } from "../../utils/shop-context.ts"

type NormalizedInputs = {
  packageId: string
  shopId: string
  ownerCapId: string
  coinType: string
}

runSuiScript(
  async (tooling, cliArguments) => {
    const inputs = await normalizeInputs(
      cliArguments,
      tooling.network.networkName
    )

    const acceptedCurrency = await requireAcceptedCurrencyByCoinType({
      coinType: inputs.coinType,
      shopId: inputs.shopId,
      suiClient: tooling.suiClient
    })

    const shop = await tooling.getMutableSharedObject({
      objectId: inputs.shopId
    })

    const removeCurrencyTransaction = buildRemoveAcceptedCurrencyTransaction({
      packageId: inputs.packageId,
      shop,
      ownerCapId: inputs.ownerCapId,
      coinType: inputs.coinType
    })

    const { execution, summary } = await tooling.executeTransactionWithSummary({
      transaction: removeCurrencyTransaction,
      signer: tooling.loadedEd25519KeyPair,
      summaryLabel: "remove-accepted-currency",
      devInspect: cliArguments.devInspect,
      dryRun: cliArguments.dryRun
    })

    if (!execution) return

    const digest = execution.transactionResult.digest
    if (
      emitJsonOutput(
        {
          removedCoinType: inputs.coinType,
          tableEntryFieldId: acceptedCurrency.tableEntryFieldId,
          digest,
          transactionSummary: summary
        },
        cliArguments.json
      )
    )
      return

    logKeyValueGreen("coin type")(inputs.coinType)
    logKeyValueGreen("table entry field id")(acceptedCurrency.tableEntryFieldId)
    if (digest) logKeyValueGreen("digest")(digest)
  },
  yargs()
    .option("coinType", {
      alias: ["coin-type", "type"],
      type: "string",
      demandOption: true,
      description: "Fully qualified Move coin type to deregister."
    })
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
  },
  networkName: string
): Promise<NormalizedInputs> => {
  const { packageId, shopId, ownerCapId } = await resolveOwnerShopIdentifiers({
    networkName,
    shopPackageId: cliArguments.shopPackageId,
    shopId: cliArguments.shopId,
    ownerCapId: cliArguments.ownerCapId
  })

  const normalizedCoinType = normalizeOptionalCoinType(cliArguments.coinType)
  if (!normalizedCoinType) throw new Error("coinType is required.")

  return {
    packageId,
    shopId,
    ownerCapId,
    coinType: normalizedCoinType
  }
}
