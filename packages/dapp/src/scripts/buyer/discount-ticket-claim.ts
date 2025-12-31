/**
 * Claims a DiscountTicket from a DiscountTemplate by submitting a transaction against the shared Shop.
 * On Sui, claiming a coupon mints a new owned object, which can later be redeemed or transferred.
 * If you come from EVM, think of this as minting a one-time NFT from shared contract state.
 * The Clock shared object is passed in because time-based rules are enforced on chain.
 */
import yargs from "yargs"

import { findCreatedDiscountTicketId } from "@sui-oracle-market/domain-core/models/discount"
import { buildClaimDiscountTicketTransaction } from "@sui-oracle-market/domain-core/ptb/discount-ticket"
import {
  deriveRelevantPackageId,
  normalizeIdOrThrow
} from "@sui-oracle-market/tooling-core/object"
import { SUI_CLOCK_ID } from "@sui-oracle-market/tooling-node/constants"
import {
  logKeyValueBlue,
  logKeyValueGreen,
  logKeyValueYellow
} from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { resolveLatestArtifactShopId } from "@sui-oracle-market/domain-node/shop"

type ClaimDiscountTicketArguments = {
  discountTemplateId: string
  shopId?: string
}

runSuiScript(
  async (tooling, cliArguments) => {
    const { shopId, discountTemplateId } = await resolveInputs(
      cliArguments,
      tooling.network.networkName
    )

    const shopShared = await tooling.getSuiSharedObject({
      objectId: shopId,
      mutable: true
    })
    const discountTemplateShared = await tooling.getSuiSharedObject({
      objectId: discountTemplateId,
      mutable: true
    })

    const shopPackageId = deriveRelevantPackageId(shopShared.object.type)

    logClaimContext({
      discountTemplateId,
      packageId: shopPackageId,
      shopAddress: shopId,
      rpcUrl: tooling.network.url,
      networkName: tooling.network.networkName
    })

    const claimDiscountTicketTransaction = buildClaimDiscountTicketTransaction({
      packageId: shopPackageId,
      shopShared,
      discountTemplateShared,
      sharedClockObject: await tooling.getSuiSharedObject({
        objectId: SUI_CLOCK_ID
      })
    })

    const {
      transactionResult,
      objectArtifacts: { created }
    } = await tooling.signAndExecute({
      transaction: claimDiscountTicketTransaction,
      signer: tooling.loadedEd25519KeyPair
    })

    logClaimResult({
      discountTemplateId,
      claimedTicketId: findCreatedDiscountTicketId(created),
      digest: transactionResult.digest
    })
  },
  yargs()
    .option("shopId", {
      alias: ["shop-id", "shop"],
      type: "string",
      description: "Parent shop object id of the template"
    })
    .option("discountTemplateId", {
      alias: ["discount-template-id", "template-id"],
      type: "string",
      description:
        "DiscountTemplate object ID to claim a single-use ticket from.",
      demandOption: true
    })
    .strict()
)

const resolveInputs = async (
  cliArguments: ClaimDiscountTicketArguments,
  networkName: string
): Promise<Required<ClaimDiscountTicketArguments>> => {
  return {
    shopId: await resolveLatestArtifactShopId(cliArguments.shopId, networkName),
    discountTemplateId: normalizeIdOrThrow(
      cliArguments.discountTemplateId,
      "A discount template id is required; provide --discount-template-id."
    )
  }
}

const logClaimContext = ({
  discountTemplateId,
  packageId,
  shopAddress,
  rpcUrl,
  networkName
}: {
  discountTemplateId: string
  packageId: string
  shopAddress?: string
  rpcUrl: string
  networkName: string
}) => {
  logKeyValueBlue("Network")(networkName)
  logKeyValueBlue("RPC")(rpcUrl)
  logKeyValueBlue("Package")(packageId)
  logKeyValueBlue("Template")(discountTemplateId)
  if (shopAddress) logKeyValueBlue("Shop")(shopAddress)
  console.log("")
}

const logClaimResult = ({
  discountTemplateId,
  claimedTicketId,
  digest
}: {
  discountTemplateId: string
  claimedTicketId?: string | null
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
