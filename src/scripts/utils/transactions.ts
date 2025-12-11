import type { SuiObjectChange } from "@mysten/sui/client"
import {
  type SuiClient,
  type SuiObjectChangeCreated,
  type SuiTransactionBlockResponse
} from "@mysten/sui/client"
import type { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import { Transaction } from "@mysten/sui/transactions"

type ExecuteParams = {
  transaction: Transaction
  signer: Ed25519Keypair
  requestType?: "WaitForEffectsCert" | "WaitForLocalExecution"
  retryOnGasStale?: boolean
  assertSuccess?: boolean
}

export const newTransaction = (gasBudget?: number) => {
  const tx = new Transaction()
  if (gasBudget) tx.setGasBudget(gasBudget)
  return tx
}

export const assertTransactionSuccess = ({
  effects
}: SuiTransactionBlockResponse) => {
  if (effects?.status?.status !== "success")
    throw new Error(effects?.status?.error || "Transaction failed")
}

export const signAndExecute = async (
  {
    transaction,
    signer,
    requestType = "WaitForLocalExecution",
    retryOnGasStale = true,
    assertSuccess = true
  }: ExecuteParams,
  suiClient: SuiClient
): Promise<SuiTransactionBlockResponse> => {
  const signerAddress = signer.toSuiAddress()
  let lastError: unknown

  const ensureFreshGasPayment = async (
    force?: boolean,
    excludeObjectIds: Set<string> = new Set()
  ) => {
    // If payment is already set (and force is not requested) keep the caller's selection.
    if (
      !force &&
      Array.isArray(transaction.blockData.gasConfig.payment) &&
      transaction.blockData.gasConfig.payment.length > 0
    )
      return

    const gasCoin = await pickFreshGasCoin(
      signerAddress,
      suiClient,
      excludeObjectIds
    )
    transaction.setGasOwner(signerAddress)
    transaction.setGasPayment([gasCoin])
  }

  // Pre-populate gas with the freshest coin to avoid stale object errors on the first attempt.
  await ensureFreshGasPayment()

  for (let attempt = 0; attempt < (retryOnGasStale ? 2 : 1); attempt++) {
    try {
      const transactionResult = await suiClient.signAndExecuteTransaction({
        transaction: transaction,
        signer,
        options: {
          showEffects: true,
          showEvents: true,
          showObjectChanges: true
        },
        requestType
      })

      if (assertSuccess) assertTransactionSuccess(transactionResult)

      return transactionResult
    } catch (error) {
      lastError = error
      if (!retryOnGasStale || attempt > 0) break

      const staleObjectId = parseStaleObjectId(error)
      const lockedObjectIds = parseLockedObjectIds(error)
      if (!staleObjectId && lockedObjectIds.size === 0) break

      // Refresh gas with the latest version in case the stale object is a SUI coin.
      await ensureFreshGasPayment(true, lockedObjectIds)
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

type ObjectChangeWithType = Extract<
  NonNullable<SuiTransactionBlockResponse["objectChanges"]>[number],
  { type: "created" }
> & { objectType: string; objectId: string }

const isCreatedWithType = (
  change: NonNullable<SuiTransactionBlockResponse["objectChanges"]>[number]
): change is ObjectChangeWithType =>
  change.type === "created" &&
  "objectType" in change &&
  typeof change.objectType === "string" &&
  "objectId" in change &&
  typeof change.objectId === "string"

const findCreatedByMatcher = (
  result: SuiTransactionBlockResponse,
  matcher: (objectType: string) => boolean
): string[] =>
  (result.objectChanges ?? [])
    .filter(isCreatedWithType)
    .filter((change) => matcher(change.objectType))
    .map((change) => change.objectId)

export const findCreatedObjectIds = (
  result: SuiTransactionBlockResponse,
  typeSuffix: string
): string[] =>
  findCreatedByMatcher(result, (objectType) => objectType.endsWith(typeSuffix))

export const findCreatedByType = (
  result: SuiTransactionBlockResponse,
  matcher: (objectType: string) => boolean
): string[] => findCreatedByMatcher(result, matcher)

export type CreatedObjectSummary = {
  objectId: string
  objectType: string
  owner?: SuiObjectChangeCreated["owner"]
  initialSharedVersion?: number | string
}

/**
 * Returns the first created object whose type matches the provided predicate, preserving owner metadata.
 */
export const findObjectMatching = (
  result: SuiTransactionBlockResponse,
  matcher: (objectType: string) => boolean
): SuiObjectChange | undefined =>
  (result.objectChanges ?? []).find(
    (change) => isCreatedWithType(change) && matcher(change.objectType)
  )

/**
 * Convenience wrapper for `findCreatedObject` that matches on a type suffix.
 */
export const findCreatedObjectBySuffix = (
  result: SuiTransactionBlockResponse,
  typeSuffix: string
): SuiObjectChange | undefined =>
  findObjectMatching(result, (objectType) => objectType.endsWith(typeSuffix))

const pickFreshGasCoin = async (
  owner: string,
  client: SuiClient,
  excludeObjectIds: Set<string> = new Set()
) => {
  const coins = await client.getCoins({
    owner,
    coinType: "0x2::sui::SUI",
    limit: 10
  })

  const latestCoin = coins.data?.find(
    (coin) => !excludeObjectIds.has(coin.coinObjectId.toLowerCase())
  )
  if (!latestCoin)
    throw new Error(
      "No usable SUI coins available for gas; fund the account or request faucet."
    )

  return {
    objectId: latestCoin.coinObjectId,
    version: latestCoin.version,
    digest: latestCoin.digest
  }
}

const parseStaleObjectId = (error: unknown): string | undefined => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : ""
  const match = message.match(/Object ID (\S+)/)
  return match?.[1]
}

const parseLockedObjectIds = (error: unknown): Set<string> => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : ""

  const lockedIds = new Set<string>()
  for (const line of message.split("\n")) {
    const match = line.match(/0x[0-9a-fA-F]+/)
    if (match) lockedIds.add(match[0].toLowerCase())
  }
  return lockedIds
}
