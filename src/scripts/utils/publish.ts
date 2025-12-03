import {
  SuiClient,
  type SuiTransactionBlockResponse,
} from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import type { BuildOutput, PublishResult } from "./types";

type PublishParams = {
  fullNodeUrl: string;
  keypair: Ed25519Keypair;
  buildOutput: BuildOutput;
  gasBudget: number;
};

export async function publishPackage({
  fullNodeUrl,
  buildOutput,
  gasBudget,
  keypair,
}: PublishParams) {
  const suiClient = new SuiClient({ url: fullNodeUrl });

  const tx = new Transaction();

  console.log({
    modules: buildOutput.modules,
    dependencies: buildOutput.dependencies,
  });

  // const [upgradeCap] = tx.publish({
  //   modules: buildOutput.modules,
  //   dependencies: buildOutput.dependencies,
  // });

  // tx.transferObjects([upgradeCap], keypair.toSuiAddress());
  // tx.setGasBudget(gasBudget);

  // const result = await suiClient.signAndExecuteTransactionBlock({
  //   transactionBlock: tx,
  //   signer: keypair,
  //   options: {
  //     showEffects: true,
  //     showObjectChanges: true,
  //     showEvents: true,
  //   },
  //   requestType: "WaitForLocalExecution",
  // });

  // if (result.effects?.status.status !== "success") throw new Error(
  //     `Publish failed: ${result.effects?.status.error ?? "unknown error"}`
  //   )

  // const publishInfo = extractPublishResult(result);
  // if (!publishInfo.packageId) throw new Error("Publish succeeded but no packageId was returned.")

  // return publishInfo;
}

function extractPublishResult(
  result: SuiTransactionBlockResponse
): PublishResult {
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
    upgradeCap: upgradeCapChange?.objectId,
    digest: result.digest,
  };
}
