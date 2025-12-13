/**
 * Provides helpers for interpreting owned object metadata returned by the RPC.
 */
export type OwnedObjectSummary = {
  objectId: string
  objectType?: string
  version?: string
  ownerLabel?: string
  previousTransaction?: string
}

/**
 * Translates the RPC owner descriptor into a readable label.
 */
export const mapOwnerToLabel = (owner?: unknown): string | undefined => {
  if (!owner) return undefined
  if (typeof owner === "string") return owner

  const ownerRecord = owner as Record<string, unknown>

  if (typeof ownerRecord.AddressOwner === "string")
    return ownerRecord.AddressOwner

  if (typeof ownerRecord.ObjectOwner === "string")
    return ownerRecord.ObjectOwner

  if (ownerRecord.Shared !== undefined) return "Shared"
  if (ownerRecord.Immutable !== undefined) return "Immutable"

  return JSON.stringify(ownerRecord)
}

/**
 * Returns a string representation for optional numeric values.
 */
export const formatOptionalNumber = (value?: string | number) =>
  value !== undefined ? value.toString() : "Unknown"

/**
 * Counts the unique object types contained inside the provided summaries.
 */
export const countUniqueObjectTypes = (objects: OwnedObjectSummary[]) =>
  new Set(
    objects.map((object) => (object.objectType ?? "Unknown type").toLowerCase())
  ).size

/**
 * Builds a log-friendly representation for an owned object entry.
 */
export const buildOwnedObjectLogFields = (object: OwnedObjectSummary) => ({
  objectId: object.objectId,
  objectType: object.objectType || "Unknown type",
  version: formatOptionalNumber(object.version),
  owner: object.ownerLabel || "Unknown owner",
  transaction: object.previousTransaction || "N/A"
})
