/**
 * Provides helpers for interpreting owned object metadata returned by the RPC.
 */
import type { SuiObjectResponse } from "@mysten/sui/client"
import { isValidSuiObjectId } from "@mysten/sui/utils"

export type OwnedObjectSummary = {
  objectId: string
  objectType?: string
  version?: string
  ownerLabel?: string
  previousTransaction?: string
}

/**
 * Translates the RPC owner descriptor into a readable label.
 * Sui ownership can be address-owned, object-owned, shared, immutable, or consensus-address,
 * which is richer than account-only ownership models.
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
 * Includes versioning and previous transaction digests to show object-level history.
 */
export const buildOwnedObjectLogFields = (object: OwnedObjectSummary) => ({
  objectId: object.objectId,
  objectType: object.objectType || "Unknown type",
  version: formatOptionalNumber(object.version),
  owner: object.ownerLabel || "Unknown owner",
  transaction: object.previousTransaction || "N/A"
})

/**
 * Extracts a field from a moveObject response content.
 */
export const getResponseContentField = (
  response: SuiObjectResponse | undefined,
  field: string
) => {
  if (!response || !response.data || !response.data.content) return undefined

  if (response.data.content.dataType !== "moveObject") return undefined

  // @todo Find a better way to extract fields from SuiParsedData.
  /* eslint-disable  @typescript-eslint/no-explicit-any */
  const content = response.data.content as any

  if (!content.fields) return undefined

  return content.fields[field]
}

/**
 * Extracts a field from a response display payload.
 */
export const getResponseDisplayField = (
  response: SuiObjectResponse | undefined,
  field: string
) => {
  if (!response || !response.data || !response.data.display) return undefined

  // @todo Find a better way to extract fields from SuiParsedData.
  const display = response.data.display

  if (!display.data) return undefined

  return display.data[field]
}

/**
 * Normalizes the object ID from a response when valid.
 */
export const getResponseObjectId = (
  response: SuiObjectResponse | undefined
) => {
  if (!response || !response.data || !response.data.objectId) return undefined

  const objectId = response.data.objectId

  if (!isValidSuiObjectId(objectId)) return undefined

  return objectId
}
