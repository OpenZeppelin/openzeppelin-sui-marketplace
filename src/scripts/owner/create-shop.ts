import "dotenv/config";
import path from "node:path";

import { SuiClient } from "@mysten/sui/client";
import { normalizeSuiObjectId } from "@mysten/sui/utils";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { DEFAULT_KEYSTORE_PATH } from "../utils/constants";
import { resolveAccountsConfig, selectNetworkConfig } from "../utils/config";
import { loadDeployerKeypair } from "../utils/keypair";
import { logKeyValueBlue, logKeyValueGreen } from "../utils/log";
import { resolveRpcUrl } from "../utils/network";
import { runSuiScript } from "../utils/process";
import {
  assertTransactionSuccess,
  findCreatedObjectBySuffix,
  newTransaction,
  signAndExecute,
} from "../utils/transactions";
import type { NetworkName } from "../utils/types";
import { writeShopObjectArtifact } from "../utils/shop";

type CliArgs = {
  packageId: string;
  publisherCapId: string;
};

type ShopCreation = {
  shopId: string;
  shopOwnerCapId: string;
  shopInitialSharedVersion?: number | string;
  digest?: string;
};

runSuiScript(async (config) => {
  const cliArgs = await parseCliArgs();
  const { networkName, networkConfig } = selectNetworkConfig(config);
  const fullNodeUrl = resolveRpcUrl(
    networkName as NetworkName,
    networkConfig.url
  );
  const suiClient = new SuiClient({ url: fullNodeUrl });

  const accounts = resolveAccountsConfig(networkConfig, {
    keystorePath: DEFAULT_KEYSTORE_PATH,
    accountIndex: 0,
    accountAddress: undefined,
  });
  const gasBudget = networkConfig.gasBudget ?? 100_000_000;
  const artifactPath = path.join(
    config.paths.objects,
    `object.${networkName}.json`
  );

  const signer = await loadDeployerKeypair(accounts);

  logCallContext({
    network: networkName as NetworkName,
    rpcUrl: fullNodeUrl,
    packageId: cliArgs.packageId,
    publisherCapId: cliArgs.publisherCapId,
    sender: signer.toSuiAddress(),
    gasBudget,
  });

  const tx = buildCreateShopTx({
    packageId: cliArgs.packageId,
    publisherCapId: cliArgs.publisherCapId,
    gasBudget,
  });

  const result = await signAndExecute({ tx, signer }, suiClient);
  assertTransactionSuccess(result);

  const creation = extractShopCreation(result);

  await writeShopObjectArtifact(
    networkName as NetworkName,
    buildArtifactPayload({
      packageId: cliArgs.packageId,
      publisherCapId: cliArgs.publisherCapId,
      creation,
      signerAddress: signer.toSuiAddress(),
      digest: result.digest,
    }),
    { artifactPath }
  );

  logShopCreation(creation, artifactPath);
});

const parseCliArgs = async (): Promise<CliArgs> => {
  const provided = await yargs(hideBin(process.argv))
    .scriptName("create-shop")
    .option("package-id", {
      type: "string",
      description: "Package ID for the sui_oracle_market Move package",
      default: process.env.SHOP_PACKAGE_ID,
      demandOption: !process.env.SHOP_PACKAGE_ID,
    })
    .option("publisher-cap-id", {
      type: "string",
      description:
        "Publisher object ID to authorize shop::create_shop for this module",
      default:
        process.env.SHOP_PUBLISHER_CAP_ID ?? process.env.PUBLISHER_CAP_ID,
      demandOption: !(process.env.SHOP_PUBLISHER_CAP_ID ?? process.env.PUBLISHER_CAP_ID),
    })
    .strict()
    .help()
    .parseAsync();

  if (!provided.packageId)
    throw new Error("Provide --package-id or set SHOP_PACKAGE_ID.");
  if (!provided.publisherCapId)
    throw new Error(
      "Provide --publisher-cap-id or set SHOP_PUBLISHER_CAP_ID/PUBLISHER_CAP_ID."
    );

  return {
    packageId: normalizeSuiObjectId(provided.packageId),
    publisherCapId: normalizeSuiObjectId(provided.publisherCapId),
  };
};

const buildCreateShopTx = ({
  packageId,
  publisherCapId,
  gasBudget,
}: {
  packageId: string;
  publisherCapId: string;
  gasBudget: number;
}) => {
  const tx = newTransaction(gasBudget);

  tx.moveCall({
    target: `${packageId}::shop::create_shop`,
    arguments: [tx.object(publisherCapId)],
  });

  return tx;
};

const extractShopCreation = (
  result: Awaited<ReturnType<typeof signAndExecute>>
): ShopCreation => {
  const shop = findCreatedObjectBySuffix(result, "::shop::Shop");
  const ownerCap = findCreatedObjectBySuffix(
    result,
    "::shop::ShopOwnerCap"
  );

  if (!shop?.objectId || !ownerCap?.objectId)
    throw new Error("shop::create_shop succeeded but created objects were not found.");

  return {
    shopId: shop.objectId,
    shopOwnerCapId: ownerCap.objectId,
    shopInitialSharedVersion: shop.initialSharedVersion,
    digest: result.digest ?? undefined,
  };
};

const buildArtifactPayload = ({
  packageId,
  publisherCapId,
  creation,
  signerAddress,
  digest,
}: {
  packageId: string;
  publisherCapId: string;
  creation: ShopCreation;
  signerAddress: string;
  digest?: string;
}) => ({
  packageId,
  publisherId: publisherCapId,
  shopId: creation.shopId,
  shopOwnerCapId: creation.shopOwnerCapId,
  shopInitialSharedVersion: creation.shopInitialSharedVersion,
  shopOwnerAddress: signerAddress,
  digest: digest ?? creation.digest,
});

const logCallContext = ({
  network,
  rpcUrl,
  packageId,
  publisherCapId,
  sender,
  gasBudget,
}: {
  network: NetworkName;
  rpcUrl: string;
  packageId: string;
  publisherCapId: string;
  sender: string;
  gasBudget: number;
}) => {
  logKeyValueBlue("network")(network);
  logKeyValueBlue("rpc")(rpcUrl);
  logKeyValueBlue("package")(packageId);
  logKeyValueBlue("publisher")(publisherCapId);
  logKeyValueBlue("sender")(sender);
  logKeyValueBlue("gas")(gasBudget);
};

const logShopCreation = (creation: ShopCreation, artifactPath: string) => {
  logKeyValueGreen("shop")(creation.shopId);
  if (creation.shopInitialSharedVersion !== undefined)
    logKeyValueGreen("shared v")(String(creation.shopInitialSharedVersion));
  logKeyValueGreen("owner cap")(creation.shopOwnerCapId);
  if (creation.digest) logKeyValueGreen("digest")(creation.digest);
  logKeyValueGreen("artifact")(artifactPath);
};
