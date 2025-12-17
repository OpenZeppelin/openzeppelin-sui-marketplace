import type { SuiObjectData } from "@mysten/sui/client"
import { SuiClient } from "@mysten/sui/client"
import yargs from "yargs"

import { SUI_CLOCK_ID } from "../../tooling/constants.ts"
import { loadKeypair } from "../../tooling/keypair.ts"
import {
  logKeyValueBlue,
  logKeyValueGreen,
  logKeyValueYellow
} from "../../tooling/log.ts"
import type { ObjectArtifact } from "../../tooling/object.ts"
import {
  deriveRelevantPackageId,
  normalizeIdOrThrow,
  normalizeOptionalIdFromValue,
  unwrapMoveObjectFields
} from "../../tooling/object.ts"
import { getSuiSharedObject } from "../../tooling/shared-object.ts"
import { runSuiScript } from "../../tooling/process.ts"
import { newTransaction, signAndExecute } from "../../tooling/transactions.ts"

type ClaimDiscountTicketArguments = {
  discountTemplateId: string
}

type NormalizedInputs = {
  discountTemplateId: string
}

runSuiScript(
  async ({ network, currentNetwork }, cliArguments) => {
    const inputs = normalizeInputs(cliArguments)
    const suiClient = new SuiClient({ url: network.url })
    const signer = await loadKeypair(network.account)

    const discountTemplate = await getSuiSharedObject(
      { objectId: inputs.discountTemplateId, mutable: true },
      suiClient
    )
    const packageId = resolvePackageId(discountTemplate.object.type)
    const discountTemplateMetadata = readDiscountTemplateMetadata(
      discountTemplate.object
    )
    const clockObject = await getSuiSharedObject(
      { objectId: SUI_CLOCK_ID },
      suiClient
    )

    logClaimContext({
      discountTemplateId: inputs.discountTemplateId,
      packageId,
      shopAddress: discountTemplateMetadata.shopAddress,
      appliesToListingId: discountTemplateMetadata.appliesToListingId,
      rpcUrl: network.url,
      networkName: currentNetwork
    })

    const claimDiscountTicketTransaction = buildClaimDiscountTicketTransaction({
      packageId,
      discountTemplate,
      clockObject
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
      discountTemplateId: inputs.discountTemplateId,
      claimedTicket: findDiscountTicket(created),
      digest: transactionResult.digest
    })
  },
  yargs()
    .option("discountTemplateId", {
      alias: ["discount-template-id", "template-id"],
      type: "string",
      description:
        "DiscountTemplate object ID to claim a single-use ticket from.",
      demandOption: true
    })
    .strict()
)

const normalizeInputs = (
  cliArguments: ClaimDiscountTicketArguments
): NormalizedInputs => ({
  discountTemplateId: normalizeIdOrThrow(
    cliArguments.discountTemplateId,
    "A discount template id is required; provide --discount-template-id."
  )
})

const resolvePackageId = (
  discountTemplateType?: SuiObjectData["type"]
): string => {
  if (!discountTemplateType)
    throw new Error("Discount template is missing a Move type.")

  if (!discountTemplateType.includes("::shop::DiscountTemplate"))
    throw new Error(
      `Object type ${discountTemplateType} is not a shop::DiscountTemplate.`
    )

  return deriveRelevantPackageId(discountTemplateType)
}

const readDiscountTemplateMetadata = (
  discountTemplateObject: SuiObjectData
) => {
  const fields = unwrapMoveObjectFields(discountTemplateObject)

  return {
    shopAddress: normalizeOptionalIdFromValue(fields.shop_address),
    appliesToListingId: normalizeOptionalIdFromValue(fields.applies_to_listing)
  }
}

const buildClaimDiscountTicketTransaction = ({
  packageId,
  discountTemplate,
  clockObject
}: {
  packageId: string
  discountTemplate: Awaited<ReturnType<typeof getSuiSharedObject>>
  clockObject: Awaited<ReturnType<typeof getSuiSharedObject>>
}) => {
  const transaction = newTransaction()
  const discountTemplateArgument = transaction.sharedObjectRef(
    discountTemplate.sharedRef
  )
  const clockArgument = transaction.sharedObjectRef(clockObject.sharedRef)

  transaction.moveCall({
    target: `${packageId}::shop::claim_discount_ticket`,
    arguments: [discountTemplateArgument, clockArgument]
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
  appliesToListingId,
  rpcUrl,
  networkName
}: {
  discountTemplateId: string
  packageId: string
  shopAddress?: string
  appliesToListingId?: string
  rpcUrl: string
  networkName: string
}) => {
  logKeyValueBlue("Network")(networkName)
  logKeyValueBlue("RPC")(rpcUrl)
  logKeyValueBlue("Package")(packageId)
  logKeyValueBlue("Template")(discountTemplateId)
  if (shopAddress) logKeyValueBlue("Shop")(shopAddress)
  if (appliesToListingId) logKeyValueBlue("Listing")(appliesToListingId)
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
