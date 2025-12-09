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

export const newTransaction = (gasBudget?: number) => {
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

type ObjectChangeWithType = Extract<
  NonNullable<SuiTransactionBlockResponse["objectChanges"]>[number],
  { type: "created" }
> & { objectType: string; objectId: string };

const isCreatedWithType = (
  change: NonNullable<SuiTransactionBlockResponse["objectChanges"]>[number]
): change is ObjectChangeWithType =>
  change.type === "created" &&
  "objectType" in change &&
  typeof change.objectType === "string" &&
  "objectId" in change &&
  typeof change.objectId === "string";

const findCreatedByMatcher = (
  result: SuiTransactionBlockResponse,
  matcher: (objectType: string) => boolean
): string[] =>
  (result.objectChanges ?? [])
    .filter(isCreatedWithType)
    .filter((change) => matcher(change.objectType))
    .map((change) => change.objectId);

export const findCreatedObjectIds = (
  result: SuiTransactionBlockResponse,
  typeSuffix: string
): string[] =>
  findCreatedByMatcher(result, (objectType) => objectType.endsWith(typeSuffix));

export const findCreatedByType = (
  result: SuiTransactionBlockResponse,
  matcher: (objectType: string) => boolean
): string[] => findCreatedByMatcher(result, matcher);

export const assertTransactionSuccess = ({
  effects,
}: SuiTransactionBlockResponse) => {
  if (effects?.status?.status !== "success")
    throw new Error(effects?.status?.error || "Transaction failed");
};
