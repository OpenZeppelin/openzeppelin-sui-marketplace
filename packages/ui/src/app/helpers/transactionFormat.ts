import type { SuiTransactionBlockResponse } from "@mysten/sui/client"
import { getStructLabel } from "./format"

export const formatTimestamp = (timestampMs?: string | number | null) => {
  if (!timestampMs) return "Unknown"
  const timestamp = Number(timestampMs)
  if (!Number.isFinite(timestamp)) return "Unknown"
  return new Date(timestamp).toLocaleString()
}

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
