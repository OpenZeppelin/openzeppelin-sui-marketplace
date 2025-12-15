import { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { writeShopObjectArtifact } from "../../models/shop.ts"
import { loadKeypair } from "../../tooling/keypair.ts"
import {
  logEachBlue,
  logEachGreen,
  logKeyValueBlue,
  logKeyValueGreen
} from "../../tooling/log.ts"
import { runSuiScript } from "../../tooling/process.ts"
import {
  findCreatedObjectBySuffix,
  newTransaction,
  signAndExecute
} from "../../tooling/transactions.ts"

type ShopCreation = {
  shopId: string
  shopOwnerCapId: string
  shopInitialSharedVersion?: number | string
  digest?: string
}

runSuiScript(
  async (
    { network, currentNetwork },
    { shopPackageId, publisherCapId: providedPublisherId }
  ) => {
    const suiClient = new SuiClient({ url: network.url })
    const signer = await loadKeypair(network.account)
    const packageId = normalizeSuiObjectId(shopPackageId)
    const publisherId = await resolvePublisherId({
      suiClient,
      packageId,
      ownerAddress: signer.toSuiAddress(),
      explicitPublisherId: providedPublisherId
    })

    logEachBlue({
      network: currentNetwork,
      rpcUrl: network.url,
      shopPackageId: packageId,
      publisherId,
      sender: signer.toSuiAddress()
    })

    const createShopTransaction = newTransaction()
    createShopTransaction.moveCall({
      target: `${packageId}::shop::create_shop`,
      arguments: [createShopTransaction.object(publisherId)]
    })

    const result = await signAndExecute(
      { transaction: createShopTransaction, signer },
      suiClient
    )

    const creation = extractShopCreation(result)

    await writeShopObjectArtifact(
      currentNetwork,
      buildArtifactPayload({
        packageId,
        publisherId,
        creation,
        signerAddress: signer.toSuiAddress(),
        digest: result.digest
      })
    )

    logEachGreen(creation)
  },
  yargs()
    .option("shopPackageId", {
      alias: "shop-package-id",
      type: "string",
      description: "Package ID for the sui_oracle_market Move package",
      demandOption: true
    })
    .option("publisherCapId", {
      alias: ["publisher-cap-id", "publisher-id"],
      type: "string",
      description:
        "0x2::package::Publisher object ID for this module (not the UpgradeCap). If omitted, the script will try to find one owned by the signer.",
      demandOption: false
    })
    .strict()
)

const PACKAGE_PUBLISHER_TYPE = "0x2::package::Publisher"
const PACKAGE_UPGRADE_CAP_SUFFIX = "::package::UpgradeCap"

const resolvePublisherId = async ({
  suiClient,
  packageId,
  ownerAddress,
  explicitPublisherId
}: {
  suiClient: SuiClient
  packageId: string
  ownerAddress: string
  explicitPublisherId?: string
}) => {
  if (explicitPublisherId) {
    const { type, fields } = await fetchObjectMetadata(
      suiClient,
      explicitPublisherId
    )
    if (type?.endsWith(PACKAGE_UPGRADE_CAP_SUFFIX))
      throw new Error(
        `Object ${explicitPublisherId} is an UpgradeCap. Pass the 0x2::package::Publisher object ID instead (claim it with your UpgradeCap via 'sui client call --package 0x2 --module package --function claim --args ${explicitPublisherId}').`
      )
    if (type !== PACKAGE_PUBLISHER_TYPE)
      throw new Error(
        `Object ${explicitPublisherId} is type ${type ?? "unknown"}; expected ${
          PACKAGE_PUBLISHER_TYPE
        }.`
      )

    const publisherPackageId =
      fields?.package || fields?.packageId || fields?.package_id
    if (publisherPackageId) {
      const normalizedPublisherPackage = normalizeSuiObjectId(
        String(publisherPackageId)
      )
      if (normalizedPublisherPackage !== packageId)
        throw new Error(
          `Publisher ${explicitPublisherId} is for package ${normalizedPublisherPackage}, expected ${packageId}.`
        )
    }

    return normalizeSuiObjectId(explicitPublisherId)
  }

  const discovered = await findPublisherForPackage({
    suiClient,
    packageId,
    ownerAddress
  })

  if (!discovered)
    throw new Error(
      `No ${PACKAGE_PUBLISHER_TYPE} found for package ${packageId}. Pass --publisher-id with the publisher object ID (not the UpgradeCap), or mint one with your UpgradeCap via 'sui client call --package 0x2 --module package --function claim --args <upgradeCapId>'.`
    )

  return discovered
}

const fetchObjectMetadata = async (suiClient: SuiClient, objectId: string) => {
  const response = await suiClient.getObject({
    id: objectId,
    options: { showType: true, showContent: true }
  })

  if (!response.data)
    throw new Error(`Object ${objectId} was not found or could not be loaded.`)

  return {
    type: response.data.type,
    fields:
      response.data.content?.dataType === "moveObject"
        ? response.data.content.fields
        : undefined
  }
}

const findPublisherForPackage = async ({
  suiClient,
  packageId,
  ownerAddress
}: {
  suiClient: SuiClient
  packageId: string
  ownerAddress: string
}) => {
  const publishers = await suiClient.getOwnedObjects({
    owner: ownerAddress,
    filter: { StructType: PACKAGE_PUBLISHER_TYPE },
    options: { showType: true, showContent: true }
  })

  const normalizedPackage = normalizeSuiObjectId(packageId)

  const match = publishers.data.find((object) => {
    if (object.data?.type !== PACKAGE_PUBLISHER_TYPE) return false

    const fields =
      object.data.content?.dataType === "moveObject"
        ? object.data.content.fields
        : undefined

    const publisherPackageId =
      fields?.package || fields?.packageId || fields?.package_id
    if (!publisherPackageId) return false

    return (
      normalizeSuiObjectId(String(publisherPackageId)) === normalizedPackage
    )
  })

  return match?.data?.objectId
    ? normalizeSuiObjectId(match.data.objectId)
    : undefined
}

const extractShopCreation = (
  transactionResult: Awaited<ReturnType<typeof signAndExecute>>
): ShopCreation => {
  const shop = findCreatedObjectBySuffix(transactionResult, "::shop::Shop")
  const ownerCap = findCreatedObjectBySuffix(
    transactionResult,
    "::shop::ShopOwnerCap"
  )

  console.log({ shop, ownerCap })

  if (!shop?.objectId || !ownerCap?.objectId)
    throw new Error(
      "shop::create_shop succeeded but created objects were not found."
    )

  return {
    shopId: shop.objectId,
    shopOwnerCapId: ownerCap.objectId,
    shopInitialSharedVersion: shop.initialSharedVersion,
    digest: transactionResult.digest ?? undefined
  }
}

const buildArtifactPayload = ({
  packageId,
  publisherId,
  creation,
  signerAddress,
  digest
}: {
  packageId: string
  publisherId: string
  creation: ShopCreation
  signerAddress: string
  digest?: string
}) => ({
  packageId,
  publisherId,
  shopId: creation.shopId,
  shopOwnerCapId: creation.shopOwnerCapId,
  shopInitialSharedVersion: creation.shopInitialSharedVersion,
  shopOwnerAddress: signerAddress,
  digest: digest ?? creation.digest
})

const logCallContext = ({
  network,
  rpcUrl,
  packageId,
  publisherId,
  sender,
  gasBudget
}: {
  network: string
  rpcUrl: string
  packageId: string
  publisherId: string
  sender: string
  gasBudget: number
}) => {
  logKeyValueBlue("network")(network)
  logKeyValueBlue("rpc")(rpcUrl)
  logKeyValueBlue("package")(packageId)
  logKeyValueBlue("publisher")(publisherId)
  logKeyValueBlue("sender")(sender)
  logKeyValueBlue("gas")(gasBudget)
}

const logShopCreation = (creation: ShopCreation, artifactPath: string) => {
  logKeyValueGreen("shop")(creation.shopId)
  if (creation.shopInitialSharedVersion !== undefined)
    logKeyValueGreen("shared v")(String(creation.shopInitialSharedVersion))
  logKeyValueGreen("owner cap")(creation.shopOwnerCapId)
  if (creation.digest) logKeyValueGreen("digest")(creation.digest)
  logKeyValueGreen("artifact")(artifactPath)
}
