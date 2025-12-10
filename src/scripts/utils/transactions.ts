import {
  type SuiTransactionBlockResponse,
  type SuiClient,
  type SuiObjectChangeCreated,
} from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

type ExecuteParams = {
  tx: Transaction;
  signer: Ed25519Keypair;
  requestType?: "WaitForEffectsCert" | "WaitForLocalExecution";
  retryOnGasStale?: boolean;
};

export const newTransaction = (gasBudget?: number) => {
  const tx = new Transaction();
  if (gasBudget) tx.setGasBudget(gasBudget);
  return tx;
};

export const signAndExecute = async (
  {
    tx,
    signer,
    requestType = "WaitForLocalExecution",
    retryOnGasStale = true,
  }: ExecuteParams,
  suiClient: SuiClient
): Promise<SuiTransactionBlockResponse> => {
  const signerAddress = signer.toSuiAddress();
  let lastError: unknown;

  for (let attempt = 0; attempt < (retryOnGasStale ? 2 : 1); attempt++) {
    try {
      return await suiClient.signAndExecuteTransaction({
        transaction: tx,
        signer,
        options: {
          showEffects: true,
          showEvents: true,
          showObjectChanges: true,
        },
        requestType,
      });
    } catch (error) {
      lastError = error;
      if (!retryOnGasStale || attempt > 0) break;

      const staleObjectId = parseStaleObjectId(error);
      if (!staleObjectId) break;

      // Refresh gas with the latest version in case the stale object is a SUI coin.
      const gasCoin = await pickFreshGasCoin(suiClient, signerAddress);
      tx.setGasOwner(signerAddress);
      tx.setGasPayment([gasCoin]);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

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

export type CreatedObjectSummary = {
  objectId: string;
  objectType: string;
  owner?: SuiObjectChangeCreated["owner"];
  initialSharedVersion?: number | string;
};

/**
 * Returns the first created object whose type matches the provided predicate, preserving owner metadata.
 */
export const findCreatedObject = (
  result: SuiTransactionBlockResponse,
  matcher: (objectType: string) => boolean
): CreatedObjectSummary | null => {
  const created = (result.objectChanges ?? []).find(
    (change) => isCreatedWithType(change) && matcher(change.objectType)
  );
  if (!created) return null;

  return {
    objectId: created.objectId,
    objectType: created.objectType,
    owner: created.owner,
    initialSharedVersion:
      "Shared" in created.owner
        ? (created.owner as { Shared: { initial_shared_version: number | string } })
            .Shared.initial_shared_version
        : undefined,
  };
};

/**
 * Convenience wrapper for `findCreatedObject` that matches on a type suffix.
 */
export const findCreatedObjectBySuffix = (
  result: SuiTransactionBlockResponse,
  typeSuffix: string
): CreatedObjectSummary | null =>
  findCreatedObject(result, (objectType) => objectType.endsWith(typeSuffix));

export const assertTransactionSuccess = ({
  effects,
}: SuiTransactionBlockResponse) => {
  if (effects?.status?.status !== "success")
    throw new Error(effects?.status?.error || "Transaction failed");
};

const pickFreshGasCoin = async (owner: string, client: SuiClient) => {
  const coins = await client.getCoins({
    owner,
    coinType: "0x2::sui::SUI",
    limit: 10,
  });

  const latestCoin = coins.data?.[0];
  if (!latestCoin)
    throw new Error(
      "No SUI coins available for gas; fund the account or request faucet."
    );

  return {
    objectId: latestCoin.coinObjectId,
    version: latestCoin.version,
    digest: latestCoin.digest,
  };
};

const parseStaleObjectId = (error: unknown): string | null => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
      ? error
      : "";
  const match = message.match(/Object ID (\S+)/);
  return match?.[1] ?? null;
};
