import type {
  SuiObjectChange,
  SuiObjectChangeCreated,
  SuiTransactionBlockResponse
} from "@mysten/sui/client"
import { Transaction } from "@mysten/sui/transactions"
import { getStructLabel } from "./utils/formatters.ts"
import { parseBalance } from "./utils/utility.ts"

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

/**
 * Type guard for created object changes that carry a Move type and object ID.
 */
const isCreatedWithType = (
  change: NonNullable<SuiTransactionBlockResponse["objectChanges"]>[number]
): change is ObjectChangeWithType =>
  change.type === "created" &&
  "objectType" in change &&
  typeof change.objectType === "string" &&
  "objectId" in change &&
  typeof change.objectId === "string"

/**
 * Collects created object IDs that match a predicate on the Move type.
 * Sui transaction responses include object changes, which replace EVM-style logs for creation.
 */
const findCreatedByMatcher = (
  result: SuiTransactionBlockResponse,
  matcher: (objectType: string) => boolean
): string[] =>
  (result.objectChanges ?? [])
    .filter(isCreatedWithType)
    .filter((change) => matcher(change.objectType))
    .map((change) => change.objectId)

/**
 * Returns all created object IDs whose types end with the provided suffix.
 * Useful for `::StructName` lookups when the package ID is unknown.
 */
export const findCreatedObjectIds = (
  result: SuiTransactionBlockResponse,
  typeSuffix: string
): string[] =>
  findCreatedByMatcher(result, (objectType) => objectType.endsWith(typeSuffix))

/**
 * Returns all created object IDs matched by a caller-supplied predicate.
 */
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

/**
 * Ensures a created object change exists and narrows it to the created type.
 */
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
 * Convenience wrapper for `findObjectMatching` that matches on a type suffix.
 */
export const findCreatedObjectBySuffix = (
  result: SuiTransactionBlockResponse,
  typeSuffix: string
): SuiObjectChange | undefined =>
  findObjectMatching(result, (objectType) => objectType.endsWith(typeSuffix))

/**
 * Finds and asserts a created object by type suffix in a transaction response.
 */
export const ensureCreatedObject = (
  objectToFind: string,
  transactionResult: SuiTransactionBlockResponse
): SuiObjectChangeCreated =>
  assertCreatedObject(
    findCreatedObjectBySuffix(transactionResult, objectToFind),
    objectToFind
  )

/**
 * Extracts created object changes with type and ID metadata.
 */
export const extractCreatedObjects = (
  transactionBlock: SuiTransactionBlockResponse
) =>
  (transactionBlock.objectChanges ?? []).filter(
    (
      change
    ): change is { objectId: string; objectType: string; type: "created" } =>
      change.type === "created" &&
      "objectType" in change &&
      typeof change.objectType === "string" &&
      "objectId" in change &&
      typeof change.objectId === "string"
  )

type ObjectTypeCount = {
  objectType: string
  label: string
  count: number
}

export type ObjectChangeDetail = {
  label: string
  count: number
  types: ObjectTypeCount[]
}

/**
 * Summarizes transaction object changes by change type and object type.
 */
export const summarizeObjectChanges = (
  objectChanges: SuiTransactionBlockResponse["objectChanges"]
): ObjectChangeDetail[] => {
  const changeTypeLabels = [
    { type: "created", label: "Created" },
    { type: "mutated", label: "Mutated" },
    { type: "transferred", label: "Transferred" },
    { type: "deleted", label: "Deleted" },
    { type: "wrapped", label: "Wrapped" },
    { type: "unwrapped", label: "Unwrapped" },
    { type: "published", label: "Published" }
  ] as const

  if (!objectChanges) {
    return changeTypeLabels.map((item) => ({
      label: item.label,
      count: 0,
      types: []
    }))
  }

  const countByType = new Map<string, number>()
  const objectTypesByChange = new Map<string, Map<string, number>>()

  for (const change of objectChanges) {
    countByType.set(change.type, (countByType.get(change.type) ?? 0) + 1)

    if ("objectType" in change && typeof change.objectType === "string") {
      const typeMap = objectTypesByChange.get(change.type) ?? new Map()
      typeMap.set(change.objectType, (typeMap.get(change.objectType) ?? 0) + 1)
      objectTypesByChange.set(change.type, typeMap)
    }
  }

  return changeTypeLabels.map((item) => {
    const typeMap = objectTypesByChange.get(item.type) ?? new Map()
    const types = Array.from(typeMap.entries())
      .map(([objectType, count]) => ({
        objectType,
        label: getStructLabel(objectType),
        count
      }))
      .sort((a, b) => b.count - a.count)

    return {
      label: item.label,
      count: countByType.get(item.type) ?? 0,
      types
    }
  })
}

export type GasSummary = {
  computation: bigint
  storage: bigint
  rebate: bigint
  total: bigint
}

/**
 * Summarizes gas usage totals from a transaction response.
 */
export const summarizeGasUsed = (
  gasUsed?: NonNullable<SuiTransactionBlockResponse["effects"]>["gasUsed"]
): GasSummary | undefined => {
  if (!gasUsed) return undefined
  const computation = parseBalance(gasUsed.computationCost)
  const storage = parseBalance(gasUsed.storageCost)
  const rebate = parseBalance(gasUsed.storageRebate)
  const total = computation + storage - rebate

  return {
    computation,
    storage,
    rebate,
    total
  }
}
