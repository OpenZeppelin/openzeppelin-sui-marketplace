import { SuiClient } from "@mysten/sui/client"
import yargs from "yargs"

import { loadKeypair } from "../utils/keypair.js"
import {
  logEachBlue,
  logEachGreen,
  logKeyValueBlue,
  logKeyValueGreen
} from "../utils/log.js"
import { runSuiScript } from "../utils/process.js"
import {
  findCreatedObjectBySuffix,
  newTransaction,
  signAndExecute
} from "../utils/transactions.js"

type ShopCreation = {
  shopId: string
  shopOwnerCapId: string
  shopInitialSharedVersion?: number | string
  digest?: string
}

runSuiScript(
  async ({ network, currentNetwork }, { shopPackageId, publisherCapId }) => {
    const suiClient = new SuiClient({ url: network.url })
    const signer = await loadKeypair(network.account)

    logEachBlue({
      network: currentNetwork,
      rpcUrl: network.url,
      shopPackageId,
      publisherCapId,
      sender: signer.toSuiAddress()
    })

    const createShopTransaction = newTransaction()
    createShopTransaction.moveCall({
      target: `${shopPackageId}::shop::create_shop`,
      arguments: [createShopTransaction.object(publisherCapId)]
    })

    const result = await signAndExecute(
      { transaction: createShopTransaction, signer },
      suiClient
    )

    const creation = extractShopCreation(result)

    // await writeShopObjectArtifact(
    //   networkName as NetworkName,
    //   buildArtifactPayload({
    //     packageId: cliArgs.packageId,
    //     publisherCapId: cliArgs.publisherCapId,
    //     creation,
    //     signerAddress: signer.toSuiAddress(),
    //     digest: result.digest,
    //   }),
    //   { artifactPath }
    // );

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
      alias: "publisher-cap-id",
      type: "string",
      description:
        "Publisher object ID to authorize shop::create_shop for this module",
      demandOption: true
    })
    .strict()
)

const extractShopCreation = (
  result: Awaited<ReturnType<typeof signAndExecute>>
): ShopCreation => {
  const shop = findCreatedObjectBySuffix(result, "::shop::Shop")
  const ownerCap = findCreatedObjectBySuffix(result, "::shop::ShopOwnerCap")

  console.log({ shop, ownerCap })

  // if (!shop?.objectId || !ownerCap?.objectId)
  //   throw new Error(
  //     "shop::create_shop succeeded but created objects were not found."
  //   );

  // return {
  //   shopId: shop.objectId,
  //   shopOwnerCapId: ownerCap.objectId,
  //   shopInitialSharedVersion: shop.initialSharedVersion,
  //   digest: result.digest ?? undefined,
  // };

  return {}
}

const buildArtifactPayload = ({
  packageId,
  publisherCapId,
  creation,
  signerAddress,
  digest
}: {
  packageId: string
  publisherCapId: string
  creation: ShopCreation
  signerAddress: string
  digest?: string
}) => ({
  packageId,
  publisherId: publisherCapId,
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
  publisherCapId,
  sender,
  gasBudget
}: {
  network: string
  rpcUrl: string
  packageId: string
  publisherCapId: string
  sender: string
  gasBudget: number
}) => {
  logKeyValueBlue("network")(network)
  logKeyValueBlue("rpc")(rpcUrl)
  logKeyValueBlue("package")(packageId)
  logKeyValueBlue("publisher")(publisherCapId)
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
