/**
 * Claims a DiscountTicket from a DiscountTemplate by executing a PTB.
 * Claiming mints an owned object; ownership proves eligibility for redemption later.
 * The shared Clock is passed so time windows are enforced on-chain.
 */
import yargs from "yargs"

import { findCreatedDiscountTicketId } from "@sui-oracle-market/domain-core/models/discount"
import { buildClaimDiscountTicketTransaction } from "@sui-oracle-market/domain-core/ptb/discount-ticket"
import {
  deriveRelevantPackageId,
  normalizeIdOrThrow
} from "@sui-oracle-market/tooling-core/object"
import { SUI_CLOCK_ID } from "@sui-oracle-market/tooling-node/constants"
import { emitJsonOutput } from "@sui-oracle-market/tooling-node/json"
import {
  logKeyValueBlue,
  logKeyValueGreen,
  logKeyValueYellow
} from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { resolveShopIdOrLatest } from "../../utils/shop-context.ts"

type ClaimDiscountTicketArguments = {
  discountTemplateId: string
  shopId?: string
  devInspect?: boolean
  dryRun?: boolean
  json?: boolean
}

runSuiScript(
  async (tooling, cliArguments) => {
    const { shopId, discountTemplateId } = await resolveInputs(
      cliArguments,
      tooling.network.networkName
    )

    const shopShared = await tooling.getMutableSharedObject({
      objectId: shopId
    })
    const discountTemplateShared = await tooling.getMutableSharedObject({
      objectId: discountTemplateId
    })

    const shopPackageId = deriveRelevantPackageId(shopShared.object.type)

    if (!cliArguments.json) {
      logClaimContext({
        discountTemplateId,
        packageId: shopPackageId,
        shopId,
        rpcUrl: tooling.network.url,
        networkName: tooling.network.networkName
      })
    }

    const claimDiscountTicketTransaction = buildClaimDiscountTicketTransaction({
      packageId: shopPackageId,
      shopShared,
      discountTemplateShared,
      sharedClockObject: await tooling.getImmutableSharedObject({
        objectId: SUI_CLOCK_ID
      })
    })

    const { execution, summary } = await tooling.executeTransactionWithSummary({
      transaction: claimDiscountTicketTransaction,
      signer: tooling.loadedEd25519KeyPair,
      summaryLabel: "claim-discount-ticket",
      devInspect: cliArguments.devInspect,
      dryRun: cliArguments.dryRun
    })

    if (!execution) return

    const {
      transactionResult,
      objectArtifacts: { created }
    } = execution

    const claimedTicketId = findCreatedDiscountTicketId(created)
    if (
      emitJsonOutput(
        {
          discountTemplateId,
          claimedTicketId,
          digest: transactionResult.digest,
          transactionSummary: summary
        },
        cliArguments.json
      )
    )
      return

    logClaimResult({
      discountTemplateId,
      claimedTicketId,
      digest: transactionResult.digest
    })
  },
  yargs()
    .option("shopId", {
      alias: "shop-id",
      type: "string",
      description:
        "Shared Shop object ID; defaults to the latest Shop artifact when available."
    })
    .option("discountTemplateId", {
      alias: ["discount-template-id", "template-id"],
      type: "string",
      description:
        "DiscountTemplate object ID to claim a single-use ticket from.",
      demandOption: true
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

const resolveInputs = async (
  cliArguments: ClaimDiscountTicketArguments,
  networkName: string
): Promise<Required<ClaimDiscountTicketArguments>> => {
  return {
    shopId: await resolveShopIdOrLatest(cliArguments.shopId, networkName),
    discountTemplateId: normalizeIdOrThrow(
      cliArguments.discountTemplateId,
      "A discount template id is required; provide --discount-template-id."
    ),
    devInspect: cliArguments.devInspect ?? false,
    dryRun: cliArguments.dryRun ?? false,
    json: cliArguments.json ?? false
  }
}

const logClaimContext = ({
  discountTemplateId,
  packageId,
  shopId,
  rpcUrl,
  networkName
}: {
  discountTemplateId: string
  packageId: string
  shopId?: string
  rpcUrl: string
  networkName: string
}) => {
  logKeyValueBlue("Network")(networkName)
  logKeyValueBlue("RPC")(rpcUrl)
  logKeyValueBlue("Package")(packageId)
  logKeyValueBlue("Template")(discountTemplateId)
  if (shopId) logKeyValueBlue("Shop")(shopId)
  console.log("")
}

const logClaimResult = ({
  discountTemplateId,
  claimedTicketId,
  digest
}: {
  discountTemplateId: string
  claimedTicketId?: string
  digest?: string
}) => {
  logKeyValueGreen("template")(discountTemplateId)
  if (claimedTicketId) logKeyValueGreen("ticket")(claimedTicketId)
  else
    logKeyValueYellow("ticket")(
      "No DiscountTicket object detected; check transaction outputs."
    )
  if (digest) logKeyValueGreen("digest")(digest)
}
