import {
  type SuiTransactionBlockResponse,
  type SuiClient,
} from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

type ExecuteParams = {
  client: SuiClient;
  tx: Transaction;
  signer: Ed25519Keypair;
  requestType?: "WaitForEffectsCert" | "WaitForLocalExecution";
};

export const newTx = (gasBudget?: number) => {
  const tx = new Transaction();
  if (gasBudget) tx.setGasBudget(gasBudget);
  return tx;
};

export const signAndExecute = async ({
  client,
  tx,
  signer,
  requestType = "WaitForLocalExecution",
}: ExecuteParams): Promise<SuiTransactionBlockResponse> =>
  client.signAndExecuteTransaction({
    transaction: tx,
    signer,
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
    },
    requestType,
  });

export const findCreatedObjectIds = (
  result: SuiTransactionBlockResponse,
  typeSuffix: string
): string[] => {
  if (!result.objectChanges) return [];

  return result.objectChanges
    .filter(
      (change) =>
        change.type === "created" &&
        "objectType" in change &&
        typeof change.objectType === "string" &&
        change.objectType.endsWith(typeSuffix)
    )
    .map((change) => ("objectId" in change ? change.objectId : ""))
    .filter(Boolean);
};

export const findCreatedByType = (
  result: SuiTransactionBlockResponse,
  matcher: (objectType: string) => boolean
): string[] => {
  if (!result.objectChanges) return [];

  return result.objectChanges
    .filter(
      (change) =>
        change.type === "created" &&
        "objectType" in change &&
        typeof change.objectType === "string" &&
        matcher(change.objectType)
    )
    .map((change) => ("objectId" in change ? change.objectId : ""))
    .filter(Boolean);
};
