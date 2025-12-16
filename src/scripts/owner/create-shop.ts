import type { SuiObjectChangeCreated } from "@mysten/sui/client"
import { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import {
  getObjectArtifactPath,
  writeObjectArtifact
} from "../../tooling/artifacts.ts"
import { loadKeypair } from "../../tooling/keypair.ts"
import { logKeyValueGreen } from "../../tooling/log.ts"
import type { ObjectArtifactPackageInfo } from "../../tooling/object.ts"
import {
  mapOwnerToArtifact,
  normalizeVersion,
  type ObjectArtifact
} from "../../tooling/object.ts"
import { runSuiScript } from "../../tooling/process.ts"
import {
  ensureCreatedObject,
  newTransaction,
  signAndExecute
} from "../../tooling/transactions.ts"

type ShopCreation = {
  shop: SuiObjectChangeCreated
  shopOwnerCap: SuiObjectChangeCreated
  digest?: string
}

runSuiScript(
  async ({ network }, { shopPackageId, publisherCapId }) => {
    const suiClient = new SuiClient({ url: network.url })
    const signer = await loadKeypair(network.account)
    const packageId = normalizeSuiObjectId(shopPackageId)

    const createShopTransaction = newTransaction()
    createShopTransaction.moveCall({
      target: `${packageId}::shop::create_shop`,
      arguments: [createShopTransaction.object(publisherCapId)]
    })

    const shopCreationTransactionResult = await signAndExecute(
      { transaction: createShopTransaction, signer },
      suiClient
    )

    const shopCreatedObjects = extractShopCreationObject(
      shopCreationTransactionResult
    )

    const shopCreationArtifact = buildArtifactPayload({
      packageId,
      publisherId: publisherCapId,
      createdObjects: shopCreatedObjects,
      signer: signer.toSuiAddress()
    })

    await writeObjectArtifact(
      getObjectArtifactPath(network.networkName),
      shopCreationArtifact
    )

    logShopCreation(shopCreatedObjects)
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
      demandOption: true
    })
    .strict()
)

const extractShopCreationObject = (
  transactionResult: Awaited<ReturnType<typeof signAndExecute>>
): ShopCreation => ({
  shop: ensureCreatedObject("shop::Shop", transactionResult),
  shopOwnerCap: ensureCreatedObject("shop::ShopOwnerCap", transactionResult),
  digest: transactionResult.digest || undefined
})

const buildArtifactPayload = ({
  packageId,
  publisherId,
  createdObjects,
  signer
}: {
  packageId: string
  publisherId: string
  createdObjects: ShopCreation
  signer: string
}): ObjectArtifact[] => {
  const packageInfo = {
    packageId,
    publisherId,
    signer
  }

  return [
    buildObjectArtifact({
      objectName: "shop",
      createdObject: createdObjects.shop,
      packageInfo
    }),
    buildObjectArtifact({
      objectName: "shopOwnerCap",
      createdObject: createdObjects.shopOwnerCap,
      packageInfo
    })
  ]
}

const buildObjectArtifact = ({
  packageInfo: { packageId, publisherId, signer },
  objectName,
  createdObject
}: {
  packageInfo: ObjectArtifactPackageInfo
  objectName: string
  createdObject: SuiObjectChangeCreated
}): ObjectArtifact => ({
  packageId,
  publisherId,
  signer,
  objectId: createdObject.objectId,
  objectType: createdObject.objectType,
  objectName,
  owner: mapOwnerToArtifact(createdObject.owner),
  initialSharedVersion: normalizeVersion(createdObject.version),
  version: normalizeVersion(createdObject.version),
  digest: createdObject.digest
})

const logShopCreation = (creation: ShopCreation) => {
  logKeyValueGreen("shop")(creation.shop.objectId)
  logKeyValueGreen("owner cap")(creation.shopOwnerCap.objectId)
  if (creation.digest) logKeyValueGreen("digest")(creation.digest)
}
