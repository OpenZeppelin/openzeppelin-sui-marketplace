import type {
  SuiObjectChange,
  SuiObjectChangeCreated,
  SuiTransactionBlockResponse
} from "@mysten/sui/client"
import { Transaction } from "@mysten/sui/transactions"

/**
 * Creates a Transaction and optionally seeds a gas budget.
 * Why: Sui PTBs are built client-side; setting gas early mirrors how wallets prepare PTBs.
 */
export const newTransaction = (gasBudget?: number) => {
  const tx = new Transaction()
  if (gasBudget) tx.setGasBudget(gasBudget)
  return tx
}

/**
 * Throws if a transaction block did not succeed.
 * Mirrors EVM receipt status checks to keep scripts predictable.
 */
export const assertTransactionSuccess = ({
  effects
}: SuiTransactionBlockResponse) => {
  if (effects?.status?.status !== "success")
    throw new Error(effects?.status?.error || "Transaction failed")
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

export const assertCreatedObject = (
  objectChange: SuiObjectChange | undefined,
  objectToFind: string
): SuiObjectChangeCreated => {
  if (!objectChange || objectChange.type !== "created")
    throw new Error(
      `Transaction succeeded but ${objectToFind} was not found in object changes.`
    )

  return objectChange as SuiObjectChangeCreated
}

/**
 * Convenience wrapper for `findCreatedObject` that matches on a type suffix.
 */
export const findCreatedObjectBySuffix = (
  result: SuiTransactionBlockResponse,
  typeSuffix: string
): SuiObjectChange | undefined =>
  findObjectMatching(result, (objectType) => objectType.endsWith(typeSuffix))

export const ensureCreatedObject = (
  objectToFind: string,
  transactionResult: SuiTransactionBlockResponse
): SuiObjectChangeCreated =>
  assertCreatedObject(
    findCreatedObjectBySuffix(transactionResult, objectToFind),
    objectToFind
  )
