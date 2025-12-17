import { SuiClient } from "@mysten/sui/client"
import yargs from "yargs"

import { getLatestObjectFromArtifact } from "../../tooling/artifacts.ts"
import { SUI_CLOCK_ID } from "../../tooling/constants.ts"
import { loadKeypair } from "../../tooling/keypair.ts"
import {
  logKeyValueBlue,
  logKeyValueGreen,
  logKeyValueYellow
} from "../../tooling/log.ts"
import type { ObjectArtifact } from "../../tooling/object.ts"
import { normalizeIdOrThrow } from "../../tooling/object.ts"
import { runSuiScript } from "../../tooling/process.ts"
import { getSuiSharedObject } from "../../tooling/shared-object.ts"
import { newTransaction, signAndExecute } from "../../tooling/transactions.ts"

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
    const suiClient = new SuiClient({ url: network.url })
    const signer = await loadKeypair(network.account)

    const shopShared = await getSuiSharedObject(
      { objectId: shopId, mutable: true },
      suiClient
    )
    const discountTemplateShared = await getSuiSharedObject(
      { objectId: discountTemplateId, mutable: true },
      suiClient
    )

    const packageId = await resolvePackageId(network.networkName)

    logClaimContext({
      discountTemplateId,
      packageId,
      shopAddress: shopId,
      rpcUrl: network.url,
      networkName: currentNetwork
    })

    const claimDiscountTicketTransaction = buildClaimDiscountTicketTransaction({
      packageId,
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

const buildClaimDiscountTicketTransaction = ({
  packageId,
  shopShared,
  discountTemplateShared,
  sharedClockObject
}: {
  packageId: string
  shopShared: Awaited<ReturnType<typeof getSuiSharedObject>>
  discountTemplateShared: Awaited<ReturnType<typeof getSuiSharedObject>>
  sharedClockObject: Awaited<ReturnType<typeof getSuiSharedObject>>
}) => {
  const transaction = newTransaction()
  const shopArgument = transaction.sharedObjectRef(shopShared.sharedRef)
  const templateArgument = transaction.sharedObjectRef(
    discountTemplateShared.sharedRef
  )
  const clockArgument = transaction.sharedObjectRef(sharedClockObject.sharedRef)

  transaction.moveCall({
    target: `${packageId}::shop::claim_discount_ticket`,
    arguments: [shopArgument, templateArgument, clockArgument]
  })

  return transaction
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
const resolvePackageId = async (networkName: string): Promise<string> => {
  const shopArtifact = await getLatestObjectFromArtifact(
    "shop::Shop",
    networkName
  )
  return normalizeIdOrThrow(
    shopArtifact?.packageId,
    "A shop package id is required; publish the package first or provide --shop-id."
  )
}
