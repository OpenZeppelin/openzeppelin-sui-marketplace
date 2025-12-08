import {
  SuiClient,
  type SuiTransactionBlockResponse,
} from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import type {
  BuildOutput,
  NetworkName,
  PublishArtifact,
  PublishResult,
} from "./types";
import { writeArtifact } from "./artifacts";
import { buildExplorerUrl } from "./network";
import { buildMovePackage } from "./move";
import path from "path";
import { logChalkBlue, logChalkGreen } from "./log";

export const publishPackageWithLog = async (
  {
    network,
    fullNodeUrl,
    packagePath,
    gasBudget,
    keypair,
    withUnpublishedDependencies = false,
  }: {
    network: NetworkName;
    packagePath: string;
    fullNodeUrl: string;
    keypair: Ed25519Keypair;
    gasBudget: number;
    withUnpublishedDependencies?: boolean;
  },
  initiatedSuiClient?: SuiClient
) => {
  logChalkBlue("Publishing package 💧")();
  logChalkBlue("network")(`${network} / ${fullNodeUrl}`);
  logChalkBlue("package")(packagePath);
  logChalkBlue("publisher")(keypair.toSuiAddress());
  if (withUnpublishedDependencies)
    logChalkBlue("with unpublished deps")("enabled");

  const { packageId, explorerUrl, digest, upgradeCap } = await publishPackage(
    {
      network,
      packagePath,
      fullNodeUrl,
      keypair,
      gasBudget,
      withUnpublishedDependencies,
    },
    initiatedSuiClient
  );

  logChalkGreen("\nPublish succeeded ✅");
  logChalkBlue("packageId")(packageId);
  if (upgradeCap) logChalkBlue("upgradeCap")(upgradeCap);

  logChalkBlue("digest")(digest);
  if (explorerUrl) logChalkBlue("explorer")(explorerUrl);
};

export const publishPackage = async (
  {
    network,
    fullNodeUrl,
    packagePath,
    gasBudget,
    keypair,
    withUnpublishedDependencies = false,
  }: {
    network: NetworkName;
    packagePath: string;
    fullNodeUrl: string;
    keypair: Ed25519Keypair;
    gasBudget: number;
    withUnpublishedDependencies?: boolean;
  },
  initiatedSuiClient?: SuiClient
): Promise<PublishArtifact> => {
  const buildOutput = await buildMovePackage(
    packagePath,
    withUnpublishedDependencies ? ["--with-unpublished-dependencies"] : []
  );

  const publishResult = await doPublishPackage(
    {
      fullNodeUrl,
      keypair,
      buildOutput,
      gasBudget,
    },
    initiatedSuiClient
  );

  if (!publishResult.packageId)
    throw new Error("Publish succeeded but no packageId was returned.");

  const artifact: PublishArtifact = {
    network: network,
    rpcUrl: fullNodeUrl,
    packagePath,
    packageId: publishResult.packageId,
    upgradeCap: publishResult.upgradeCap,
    sender: keypair.toSuiAddress(),
    digest: publishResult.digest,
    publishedAt: new Date().toISOString(),
    modules: buildOutput.modules,
    dependencies: buildOutput.dependencies,
    explorerUrl: buildExplorerUrl(publishResult.digest, network as NetworkName),
  };

  await writeArtifact(
    path.join(process.cwd(), "deployments", `deployment.${network}.json`),
    artifact
  );

  return artifact;
};

export const doPublishPackage = async (
  {
    fullNodeUrl,
    buildOutput,
    gasBudget,
    keypair,
  }: {
    fullNodeUrl: string;
    keypair: Ed25519Keypair;
    buildOutput: BuildOutput;
    gasBudget: number;
  },
  initiatedSuiClient?: SuiClient
) => {
  const suiClient = initiatedSuiClient || new SuiClient({ url: fullNodeUrl });

  const tx = new Transaction();

  const [upgradeCap] = tx.publish({
    modules: buildOutput.modules,
    dependencies: buildOutput.dependencies,
  });

  console.log({ upgradeCap });

  tx.transferObjects([upgradeCap], keypair.toSuiAddress());
  tx.setSender(keypair.toSuiAddress());
  tx.setGasBudget(gasBudget);

  const result = await suiClient.signAndExecuteTransaction({
    transaction: tx,
    signer: keypair,
    requestType: "WaitForLocalExecution",
    options: {
      showEffects: true,
      showObjectChanges: true,
      showEvents: true,
    },
  });

  if (result.effects?.status.status !== "success")
    throw new Error(
      `Publish failed: ${result.effects?.status.error ?? "unknown error"}`
    );

  const publishInfo = extractPublishResult(result);
  if (!publishInfo.packageId)
    throw new Error("Publish succeeded but no packageId was returned.");

  return publishInfo;
};

const extractPublishResult = (
  result: SuiTransactionBlockResponse
): PublishResult => {
  const packageChange = result.objectChanges?.find(
    (change) => change.type === "published"
  ) as { packageId?: string } | undefined;

  const upgradeCapChange = result.objectChanges?.find(
    (change) =>
      change.type === "created" &&
      "objectType" in change &&
      typeof change.objectType === "string" &&
      change.objectType.endsWith("::package::UpgradeCap")
  ) as { objectId?: string } | undefined;

  return {
    packageId: packageChange?.packageId,
    upgradeCap: upgradeCapChange?.objectId as string,
    digest: result.digest,
  };
};
