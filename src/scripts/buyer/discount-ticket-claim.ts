import type { SuiObjectData } from "@mysten/sui/client"
import { SuiClient } from "@mysten/sui/client"
import type { Transaction } from "@mysten/sui/transactions"
import yargs from "yargs"

import { getLatestObjectFromArtifact } from "../../tooling/artifacts.ts"
import { SUI_CLOCK_ID } from "../../tooling/constants.ts"
import { getSuiDynamicFieldObject } from "../../tooling/dynamic-fields.ts"
import { loadKeypair } from "../../tooling/keypair.ts"
import {
  logKeyValueBlue,
  logKeyValueGreen,
  logKeyValueYellow
} from "../../tooling/log.ts"
import type { ObjectArtifact } from "../../tooling/object.ts"
import {
  deriveRelevantPackageId,
  getSuiObject,
  normalizeIdOrThrow,
  normalizeOptionalIdFromValue,
  unwrapMoveObjectFields
} from "../../tooling/object.ts"
import { runSuiScript } from "../../tooling/process.ts"
import { getSuiSharedObject } from "../../tooling/shared-object.ts"
import { newTransaction, signAndExecute } from "../../tooling/transactions.ts"

type ClaimDiscountTicketArguments = {
  discountTemplateId: string
  shopId?: string
}

type DiscountTemplateReference = {
  discountTemplateId: string
  packageId: string
  shopAddress?: string
  appliesToListingId?: string
  buildArgument: (
    transaction: Transaction
  ) => Parameters<Transaction["moveCall"]>[0]["arguments"][number]
}

runSuiScript(
  async ({ network, currentNetwork }, cliArguments) => {
    const { shopId, discountTemplateId } = await resolveInputs(
      cliArguments,
      network.networkName
    )
    console.log("[debug] RPC URL", network.url)
    const suiClient = new SuiClient({ url: network.url })
    const signer = await loadKeypair(network.account)

    const discountTemplateReference = await resolveDiscountTemplateReference(
      {
        shopId,
        discountTemplateId
      },
      suiClient
    )

    logClaimContext({
      discountTemplateId: discountTemplateReference.discountTemplateId,
      packageId: discountTemplateReference.packageId,
      shopAddress: discountTemplateReference.shopAddress ?? shopId,
      appliesToListingId: discountTemplateReference.appliesToListingId,
      rpcUrl: network.url,
      networkName: currentNetwork
    })

    const claimDiscountTicketTransaction = buildClaimDiscountTicketTransaction({
      packageId: discountTemplateReference.packageId,
      discountTemplateArgument: discountTemplateReference.buildArgument,
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
      discountTemplateId: discountTemplateReference.discountTemplateId,
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
  discountTemplateArgument,
  sharedClockObject
}: {
  packageId: string
  discountTemplateArgument: (
    transaction: Transaction
  ) => Parameters<Transaction["moveCall"]>[0]["arguments"][number]
  sharedClockObject: Awaited<ReturnType<typeof getSuiSharedObject>>
}) => {
  const transaction = newTransaction()
  const templateArgument = discountTemplateArgument(transaction)
  const clockArgument = transaction.sharedObjectRef(sharedClockObject.sharedRef)

  transaction.moveCall({
    target: `${packageId}::shop::claim_discount_ticket`,
    arguments: [templateArgument, clockArgument]
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

const resolveDiscountTemplateReference = async (
  {
    shopId,
    discountTemplateId
  }: {
    shopId: string
    discountTemplateId: string
  },
  suiClient: SuiClient
): Promise<DiscountTemplateReference> => {
  const directObject = await loadObjectIfExists(discountTemplateId, suiClient)

  if (directObject) {
    if (isDiscountTemplateType(directObject.type))
      return buildDiscountTemplateReference(
        discountTemplateId,
        directObject,
        suiClient
      )

    if (isDynamicFieldType(directObject.type)) {
      const templateIdFromDirectField =
        extractDiscountTemplateIdFromDynamicField(directObject)

      if (templateIdFromDirectField) {
        const templateObject = await loadObjectIfExists(
          templateIdFromDirectField,
          suiClient
        )

        if (!templateObject)
          throw new Error(
            "DiscountTemplate value referenced in the dynamic field could not be fetched."
          )

        return buildDiscountTemplateReference(
          templateIdFromDirectField,
          templateObject,
          suiClient
        )
      }
    }
  }

  const discountTemplateField = await getSuiDynamicFieldObject(
    { childObjectId: discountTemplateId, parentObjectId: shopId },
    suiClient
  )

  const templateObjectIdFromField = extractDiscountTemplateIdFromDynamicField(
    discountTemplateField.object
  )

  if (!templateObjectIdFromField)
    throw new Error(
      "Could not extract DiscountTemplate id from the dynamic field value."
    )

  const templateObject = await loadObjectIfExists(
    templateObjectIdFromField,
    suiClient
  )

  if (!templateObject || !isDiscountTemplateType(templateObject.type))
    throw new Error(
      "Dynamic field resolved but the embedded DiscountTemplate object was not found."
    )

  return buildDiscountTemplateReference(
    templateObjectIdFromField,
    templateObject,
    suiClient
  )
}

const loadObjectIfExists = async (objectId: string, suiClient: SuiClient) => {
  try {
    const candidateObject = await getSuiObject({ objectId }, suiClient)
    return candidateObject.object
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Could Not find object")
    )
      return undefined

    throw error
  }
}

const buildDiscountTemplateReference = async (
  discountTemplateId: string,
  templateObject: SuiObjectData,
  suiClient: SuiClient
): Promise<DiscountTemplateReference> => {
  const templateMetadata = readDiscountTemplateMetadataSafe(templateObject)
  const packageId = deriveRelevantPackageId(templateObject.type)
  const sharedReference =
    templateObject.owner &&
    typeof templateObject.owner === "object" &&
    "Shared" in templateObject.owner
      ? await getSuiSharedObject(
          { objectId: discountTemplateId, mutable: true },
          suiClient
        )
      : undefined

  const buildArgument =
    sharedReference !== undefined
      ? (transaction: Transaction) =>
          transaction.sharedObjectRef(sharedReference.sharedRef)
      : (transaction: Transaction) => transaction.object(discountTemplateId)

  return {
    discountTemplateId,
    packageId,
    shopAddress: templateMetadata.shopAddress,
    appliesToListingId: templateMetadata.appliesToListingId,
    buildArgument
  }
}

const extractDiscountTemplateIdFromDynamicField = (
  dynamicFieldObject: SuiObjectData
): string | undefined => {
  const fields = unwrapMoveObjectFields(dynamicFieldObject)
  const valueField = (fields as Record<string, unknown>).value

  if (
    valueField &&
    typeof valueField === "object" &&
    "fields" in valueField &&
    valueField.fields &&
    typeof valueField.fields === "object" &&
    "id" in valueField.fields &&
    valueField.fields.id &&
    typeof valueField.fields.id === "object" &&
    "id" in valueField.fields.id
  ) {
    return normalizeOptionalIdFromValue(
      (valueField.fields as { id?: { id?: string } }).id?.id
    )
  }

  return undefined
}

const isDiscountTemplateType = (objectType?: string) =>
  Boolean(
    objectType &&
    objectType.includes("::shop::DiscountTemplate") &&
    !objectType.includes("::dynamic_field::Field")
  )

const isDynamicFieldType = (objectType?: string) =>
  Boolean(objectType && objectType.includes("::dynamic_field::Field"))

const readDiscountTemplateMetadataSafe = (
  discountTemplateObject: SuiObjectData
) => {
  const fields = unwrapMoveObjectFields(discountTemplateObject)

  // Dynamic field objects wrap the value inside the `value` field.
  const templateFields =
    "value" in fields && fields.value && typeof fields.value === "object"
      ? ((fields.value as { fields?: Record<string, unknown> }).fields ??
        fields.value)
      : fields

  return {
    shopAddress: normalizeOptionalIdFromValue(
      (templateFields as Record<string, unknown>).shop_address
    ),
    appliesToListingId: normalizeOptionalIdFromValue(
      (templateFields as Record<string, unknown>).applies_to_listing
    )
  }
}
