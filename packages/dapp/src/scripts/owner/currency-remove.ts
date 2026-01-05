/**
 * Removes an AcceptedCurrency entry from a Shop's registry.
 * On Sui, accepted currencies are objects referenced by the shared Shop via dynamic fields.
 * If you come from EVM, this is like deleting a mapping entry, but you are unlinking an object.
 * Requires the ShopOwnerCap capability to authorize the mutation.
 */
import type { SuiClient } from "@mysten/sui/client"
import yargs from "yargs"

import {
  type AcceptedCurrencyMatch,
  requireAcceptedCurrencyByCoinType
} from "@sui-oracle-market/domain-core/models/currency"
import { buildRemoveAcceptedCurrencyTransaction } from "@sui-oracle-market/domain-core/ptb/currency"
import { normalizeOptionalCoinType } from "@sui-oracle-market/tooling-core/coin"
import { normalizeOptionalId } from "@sui-oracle-market/tooling-core/object"
import { emitJsonOutput } from "@sui-oracle-market/tooling-node/json"
import { logKeyValueGreen } from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { resolveOwnerShopIdentifiers } from "../../utils/shop-context.ts"

type NormalizedInputs = {
  packageId: string
  shopId: string
  ownerCapId: string
  acceptedCurrencyId?: string
  coinType?: string
}

runSuiScript(
  async (tooling, cliArguments) => {
    const inputs = await normalizeInputs(
      cliArguments,
      tooling.network.networkName
    )

    const acceptedCurrency = await resolveAcceptedCurrency(
      inputs,
      tooling.suiClient
    )

    const shop = await tooling.getMutableSharedObject({
      objectId: inputs.shopId
    })
    const acceptedCurrencyShared = await tooling.getImmutableSharedObject({
      objectId: acceptedCurrency.acceptedCurrencyId
    })

    const removeCurrencyTransaction = buildRemoveAcceptedCurrencyTransaction({
      packageId: inputs.packageId,
      shop,
      ownerCapId: inputs.ownerCapId,
      acceptedCurrency: acceptedCurrencyShared
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
          deleted: acceptedCurrency.acceptedCurrencyId,
          digest,
          transactionSummary: summary
        },
        cliArguments.json
      )
    )
      return

    logKeyValueGreen("deleted")(acceptedCurrency.acceptedCurrencyId)
    if (digest) logKeyValueGreen("digest")(digest)
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
  cliArguments: {
    shopPackageId?: string
    shopId?: string
    ownerCapId?: string
    acceptedCurrencyId?: string
    coinType?: string
  },
  networkName: string
): Promise<NormalizedInputs> => {
  const { packageId, shopId, ownerCapId } = await resolveOwnerShopIdentifiers({
    networkName,
    shopPackageId: cliArguments.shopPackageId,
    shopId: cliArguments.shopId,
    ownerCapId: cliArguments.ownerCapId
  })

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
