import yargs from "yargs"

import { buildClaimDiscountTicketTransaction } from "@sui-oracle-market/domain-core/ptb/discount-ticket"
import type { ObjectArtifact } from "@sui-oracle-market/tooling-core/object"
import {
  deriveRelevantPackageId,
  normalizeIdOrThrow
} from "@sui-oracle-market/tooling-core/object"
import { getSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { getLatestObjectFromArtifact } from "@sui-oracle-market/tooling-node/artifacts"
import { SUI_CLOCK_ID } from "@sui-oracle-market/tooling-node/constants"
import { createSuiClient } from "@sui-oracle-market/tooling-node/describe-object"
import { loadKeypair } from "@sui-oracle-market/tooling-node/keypair"
import {
  logKeyValueBlue,
  logKeyValueGreen,
  logKeyValueYellow
} from "@sui-oracle-market/tooling-node/log"
import { runSuiScript } from "@sui-oracle-market/tooling-node/process"
import { signAndExecute } from "@sui-oracle-market/tooling-node/transactions"

type ClaimDiscountTicketArguments = {
  discountTemplateId: string
  shopId?: string
}

runSuiScript(
  async ({ network, currentNetwork }, cliArguments) => {
    const { shopId, discountTemplateId } = await resolveInputs(
      cliArguments,
      network.networkName
    )
    const suiClient = createSuiClient(network.url)
    const signer = await loadKeypair(network.account)

    const shopShared = await getSuiSharedObject(
      { objectId: shopId, mutable: true },
      suiClient
    )
    const discountTemplateShared = await getSuiSharedObject(
      { objectId: discountTemplateId, mutable: true },
      suiClient
    )

    const shopPackageId = deriveRelevantPackageId(shopShared.object.type)

    logClaimContext({
      discountTemplateId,
      packageId: shopPackageId,
      shopAddress: shopId,
      rpcUrl: network.url,
      networkName: currentNetwork
    })

    const claimDiscountTicketTransaction = buildClaimDiscountTicketTransaction({
      packageId: shopPackageId,
      shopShared,
      discountTemplateShared,
      sharedClockObject: await getSuiSharedObject(
        { objectId: SUI_CLOCK_ID },
        suiClient
      )
    })

    const {
      transactionResult,
      objectArtifacts: { created }
    } = await signAndExecute(
      {
        transaction: claimDiscountTicketTransaction,
        signer,
        networkName: network.networkName
      },
      suiClient
    )

    logClaimResult({
      discountTemplateId,
      claimedTicket: findDiscountTicket(created),
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
  const shopArtifact = await getLatestObjectFromArtifact(
    "shop::Shop",
    networkName
  )

  return {
    shopId: normalizeIdOrThrow(
      cliArguments.shopId ?? shopArtifact?.objectId,
      "A shop id is required; create a shop first or provide --shop-id."
    ),
    discountTemplateId: normalizeIdOrThrow(
      cliArguments.discountTemplateId,
      "A discount template id is required; provide --discount-template-id."
    )
  }
}

const findDiscountTicket = (
  createdObjects: ObjectArtifact[]
): ObjectArtifact | undefined =>
  createdObjects.find((created) =>
    created.objectType?.includes("::shop::DiscountTicket")
  )

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
  claimedTicket,
  digest
}: {
  discountTemplateId: string
  claimedTicket?: ObjectArtifact
  digest?: string
}) => {
  logKeyValueGreen("template")(discountTemplateId)
  if (claimedTicket) logKeyValueGreen("ticket")(claimedTicket.objectId)
  else
    logKeyValueYellow("ticket")(
      "No DiscountTicket object detected; check transaction outputs."
    )
  if (digest) logKeyValueGreen("digest")(digest)
}
