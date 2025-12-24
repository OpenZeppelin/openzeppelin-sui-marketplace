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
 * Sui ownership can be address-owned, object-owned, shared, or immutable,
 * which is a different mental model from EVM's account-centric state.
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
 * Sui RPCs sometimes return numeric-like fields as strings; this normalizes them.
 */
export const formatOptionalNumber = (value?: string | number) =>
  value !== undefined ? value.toString() : "Unknown"

/**
 * Counts the unique Move object types in the provided summaries.
 * Useful for quick introspection of object composition in Sui accounts.
 */
export const countUniqueObjectTypes = (objects: OwnedObjectSummary[]) =>
  new Set(
    objects.map((object) => (object.objectType ?? "Unknown type").toLowerCase())
  ).size

/**
 * Builds a log-friendly representation for an owned object entry.
 * Sui objects track versioning and previous transaction digests, which can help
 * EVM developers think of state changes per object rather than per account.
 */
export const buildOwnedObjectLogFields = (object: OwnedObjectSummary) => ({
  objectId: object.objectId,
  objectType: object.objectType || "Unknown type",
  version: formatOptionalNumber(object.version),
  owner: object.ownerLabel || "Unknown owner",
  transaction: object.previousTransaction || "N/A"
})
