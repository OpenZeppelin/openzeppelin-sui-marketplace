import type {
  ObjectOwner,
  ObjectResponseError,
  SuiClient,
  SuiObjectChangeCreated,
  SuiObjectData,
  SuiObjectDataOptions,
  SuiObjectResponse
} from "@mysten/sui/client"
import { normalizeSuiAddress, normalizeSuiObjectId } from "@mysten/sui/utils"
import type { ToolingCoreContext } from "./context.ts"
import { requireValue } from "./utils/utility.ts"

type ObjectOwnerAddress =
  | { ownerType: "address"; address: string }
  | { ownerType: "consensus-address"; address: string }

export type ObjectOwnerArtifact =
  | ObjectOwnerAddress
  | { ownerType: "object"; objectId?: string }
  | { ownerType: "shared"; initialSharedVersion?: string }
  | { ownerType: "immutable" }

export type ObjectArtifactPackageInfo = {
  packageId: string
  signer: string
}

export type ObjectArtifactObjectInfo = {
  objectId: string
  objectType: string
  owner?: ObjectOwnerArtifact
  dynamicFieldId?: string
  initialSharedVersion?: string
  version?: string
  digest?: string
  deletedAt?: string
  wrappedAt?: string
}

export type ObjectArtifact = ObjectArtifactPackageInfo &
  ObjectArtifactObjectInfo

/**
 * Checks if an owner artifact represents a direct address owner (vs object/shared/immutable).
 */
const isAddressTypeOwner = (
  owner?: ObjectOwnerArtifact
): owner is ObjectOwnerAddress => Boolean(owner?.ownerType.includes("address"))

/**
 * Normalizes Sui owner metadata into an artifact-friendly structure.
 * Sui ownership can be address-owned, object-owned, shared, immutable, or consensus-address,
 * so this helper yields a stable shape for storage and comparisons.
 */
export const mapOwnerToArtifact = (
  owner?: ObjectOwner | SuiObjectChangeCreated["owner"]
): ObjectOwnerArtifact | undefined => {
  if (!owner) return undefined

  if (owner === "Immutable") return { ownerType: "immutable" }

  if ("AddressOwner" in owner)
    return {
      ownerType: "address",
      address: normalizeSuiAddress(owner.AddressOwner)
    }

  if ("ObjectOwner" in owner)
    return {
      ownerType: "object",
      objectId: normalizeSuiObjectId(owner.ObjectOwner)
    }

  if ("Shared" in owner)
    return {
      ownerType: "shared",
      initialSharedVersion: normalizeVersion(
        owner.Shared.initial_shared_version
      )
    }

  if ("Immutable" in owner) return { ownerType: "immutable" }

  if ("ConsensusAddressOwner" in owner)
    return {
      ownerType: "consensus-address",
      address: normalizeSuiAddress(owner.ConsensusAddressOwner.owner)
    }

  return undefined
}

/**
 * Normalizes a full object artifact for persistence or comparison.
 * Ensures object IDs and version fields are canonicalized to avoid false diffs.
 */
export const normalizeObjectArtifact = (
  artifact: ObjectArtifact
): ObjectArtifact => ({
  ...artifact,
  objectId: normalizeOptionalId(artifact.objectId) ?? artifact.objectId,
  owner: normalizeOwner(artifact.owner),
  initialSharedVersion: normalizeVersion(artifact.initialSharedVersion),
  version:
    artifact.version === undefined ? artifact.version : String(artifact.version)
})

/**
 * Normalizes owner-specific fields (addresses, object IDs, shared versions).
 */
export const normalizeOwner = (owner?: ObjectOwnerArtifact) => {
  if (!owner) return owner

  if (isAddressTypeOwner(owner))
    return {
      ...owner,
      ownerAddress: normalizeOptionalAddress(owner.address)
    }

  if (owner.ownerType === "object")
    return { ...owner, objectId: normalizeOptionalId(owner.objectId) }

  if (owner.ownerType === "shared")
    return {
      ...owner,
      initialSharedVersion: normalizeVersion(owner.initialSharedVersion)
    }

  return owner
}

/**
 * Normalizes a Sui object ID if present.
 */
export const normalizeOptionalId = (value?: string) =>
  value ? normalizeSuiObjectId(value) : value

/**
 * Normalizes a Sui address if present.
 */
export const normalizeOptionalAddress = (value?: string) =>
  value ? normalizeSuiAddress(value) : value

/**
 * Normalizes a Sui object version to string for JSON-safe storage.
 * Versions are u64 on chain; keeping them as strings avoids precision loss.
 */
export const normalizeVersion = (
  value?: number | string
): string | undefined => (value === undefined ? undefined : String(value))

/**
 * Fetches an object with owner metadata, normalizing the ID.
 * Useful for scripts that need to reason about ownership (shared vs owned) before building PTBs.
 */
export const getSuiObject = async (
  {
    objectId,
    options = { showOwner: true, showContent: true, showType: true }
  }: { objectId: string; options?: SuiObjectDataOptions },
  { suiClient }: ToolingCoreContext
): Promise<{
  object: SuiObjectData
  owner?: ObjectOwner
  error?: ObjectResponseError
}> => {
  const { data: object, error } = await suiClient.getObject({
    id: normalizeSuiObjectId(objectId),
    options: { showOwner: true, ...options }
  })

  if (!object)
    throw new Error(
      `Could Not find object ${objectId}${error ? error.code : ""}`
    )

  return {
    object,
    owner: object.owner || undefined,
    error: error || undefined
  }
}

export type WrappedSuiObject = {
  object: SuiObjectData
  error?: ObjectResponseError
}

/**
 * Attempts to extract and normalize a Sui object ID from Move-like values.
 * Handles nested `fields`, `id`, or `bytes` structures and `Option`-style wrappers.
 */
export const normalizeOptionalIdFromValue = (
  value: unknown
): string | undefined => {
  if (!value) return undefined

  const attemptNormalize = (candidate: unknown): string | undefined => {
    if (typeof candidate === "string") return normalizeSuiObjectId(candidate)
    if (
      candidate &&
      typeof candidate === "object" &&
      "id" in candidate &&
      typeof (candidate as { id?: unknown }).id === "string"
    )
      return normalizeSuiObjectId((candidate as { id: string }).id)
    if (
      candidate &&
      typeof candidate === "object" &&
      "bytes" in candidate &&
      typeof (candidate as { bytes?: unknown }).bytes === "string"
    )
      return normalizeSuiObjectId((candidate as { bytes: string }).bytes)
    if (candidate && typeof candidate === "object" && "fields" in candidate)
      return attemptNormalize((candidate as { fields?: unknown }).fields)
    return undefined
  }

  if (
    value &&
    typeof value === "object" &&
    "some" in value &&
    (value as { some?: unknown }).some !== undefined
  )
    return attemptNormalize((value as { some?: unknown }).some)

  if (value && typeof value === "object" && "none" in value) return undefined

  if (value && typeof value === "object" && "fields" in value)
    return attemptNormalize((value as { fields?: unknown }).fields)

  return attemptNormalize(value)
}

/**
 * Extracts the Move `fields` payload from a Sui moveObject response.
 * Some Move structs wrap the payload under a `value` field, so this peels it off.
 */
export const unwrapMoveObjectFields = <TFields = Record<string, unknown>>(
  object: SuiObjectData
): TFields => {
  const moveContent = object.content
  if (!moveContent || moveContent.dataType !== "moveObject")
    throw new Error(`Object ${object.objectId} is missing Move content.`)

  const fields = (moveContent.fields ?? {}) as Record<string, unknown>
  if ("value" in fields && fields.value && typeof fields.value === "object") {
    const nested = (fields.value as { fields?: Record<string, unknown> }).fields
    if (nested) return nested as TFields
  }

  return fields as TFields
}

/**
 * Derives the package ID from a fully qualified Move type string.
 * On Sui, the package ID scopes the type definition and is embedded in the type tag.
 */
export const deriveRelevantPackageId = (
  objectType: SuiObjectData["type"]
): string => {
  const packageIdMatches = objectType?.match(/0x[0-9a-fA-F]{64}/g)
  const packageIdCandidate =
    packageIdMatches && packageIdMatches.length > 0
      ? packageIdMatches[packageIdMatches.length - 1]
      : objectType?.split("::")[0]

  if (!packageIdCandidate)
    throw new Error(`Could not resolve package id from ${objectType}`)

  return normalizeSuiObjectId(packageIdCandidate)
}

/**
 * Normalizes an ID or throws a caller-specified error when missing.
 */
export const normalizeIdOrThrow = (
  id: string | undefined,
  errorMessage: string
): string => normalizeSuiObjectId(requireValue(id, errorMessage))

/**
 * Fetches all objects owned by an address (optionally filtered) via pagination.
 * Sui accounts own objects directly, so this enumerates address-owned objects.
 */
export const getAllOwnedObjectsByFilter = async (
  {
    ownerAddress,
    filter,
    options = { showContent: true, showType: true }
  }: {
    ownerAddress: string
    filter?: Parameters<SuiClient["getOwnedObjects"]>[0]["filter"]
    options?: SuiObjectDataOptions
  },
  { suiClient }: ToolingCoreContext
): Promise<SuiObjectData[]> => {
  const objects: SuiObjectData[] = []
  let cursor: string | undefined

  do {
    const page = await suiClient.getOwnedObjects({
      owner: normalizeSuiAddress(ownerAddress),
      filter,
      options,
      cursor
    })

    objects.push(
      ...(page.data
        .map((entry) => entry.data)
        .filter(Boolean) as SuiObjectData[])
    )
    cursor = page.hasNextPage ? (page.nextCursor ?? undefined) : undefined
  } while (cursor)

  return objects
}

/**
 * Best-effort object fetch that returns undefined on errors instead of throwing.
 */
export const getObjectSafe = async (
  {
    objectId,
    options = { showType: true, showBcs: true }
  }: {
    objectId: string
    options?: SuiObjectDataOptions
  },
  { suiClient }: ToolingCoreContext
): Promise<SuiObjectResponse | undefined> => {
  try {
    const normalizedId = normalizeSuiObjectId(objectId)
    return await suiClient.getObject({
      id: normalizedId,
      options: { showType: true, showBcs: true, ...options }
    })
  } catch {
    return undefined
  }
}

/**
 * Extracts a Move object type from any available response field (data, BCS, or content).
 */
export const extractObjectType = (object: SuiObjectResponse | undefined) =>
  object?.data?.type ||
  // Some RPC responses only return the type inside BCS or content.
  //@ts-expect-error assuming type is present
  object?.data?.bcs?.type ||
  //@ts-expect-error assuming type is present
  object?.data?.content?.type

/**
 * Case-insensitive type equality check for Move object types.
 */
export const objectTypeMatches = (
  object: SuiObjectResponse | undefined,
  expectedType: string
) => extractObjectType(object)?.toLowerCase() === expectedType.toLowerCase()

export const extractOwnerAddress = (owner?: ObjectOwner): string => {
  if (!owner) throw new Error("Coin object is missing its owner.")

  if (typeof owner !== "object") {
    throw new Error("Coin object is not address-owned.")
  }

  if ("AddressOwner" in owner) return normalizeSuiAddress(owner.AddressOwner)

  if ("ConsensusAddressOwner" in owner)
    return normalizeSuiAddress(owner.ConsensusAddressOwner.owner)

  throw new Error("Coin object is not address-owned.")
}
