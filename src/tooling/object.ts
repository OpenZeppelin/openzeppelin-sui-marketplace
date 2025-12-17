import type {
  ObjectOwner,
  ObjectResponseError,
  SuiClient,
  SuiObjectChangeCreated,
  SuiObjectData,
  SuiObjectDataOptions
} from "@mysten/sui/client"
import { normalizeSuiAddress, normalizeSuiObjectId } from "@mysten/sui/utils"
import { requireValue } from "../utils/utility.ts"

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
}

export type ObjectArtifact = ObjectArtifactPackageInfo &
  ObjectArtifactObjectInfo

const isAddressTypeOwner = (
  owner?: ObjectOwnerArtifact
): owner is ObjectOwnerAddress => Boolean(owner?.ownerType.includes("address"))

/**
 * Normalizes Sui owner metadata into an artifact-friendly structure.
 * Why: RPC owner responses vary by owner type; this helper gives callers
 * predictable owner fields they can persist or inspect.
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

export const normalizeOptionalId = (value?: string) =>
  value ? normalizeSuiObjectId(value) : value

export const normalizeOptionalAddress = (value?: string) =>
  value ? normalizeSuiAddress(value) : value

export const normalizeVersion = (value?: number | string) => String(value)

export const extractInitialSharedVersion = (
  created: SuiObjectChangeCreated | SuiObjectData
): string | undefined => {
  if (
    created.owner &&
    typeof created.owner === "object" &&
    "Shared" in created.owner
  )
    return normalizeVersion(created.owner.Shared.initial_shared_version)

  if ("initialSharedVersion" in created)
    return normalizeVersion(
      (created as unknown as { initialSharedVersion?: number | string })
        .initialSharedVersion
    )

  return undefined
}

/**
 * Fetches an object with owner metadata, normalizing the ID.
 * Useful for scripts that need to reason about ownership (shared vs owned) before building PTBs.
 */
export const getSuiObject = async (
  {
    objectId,
    options = { showOwner: true, showContent: true, showType: true }
  }: { objectId: string; options?: SuiObjectDataOptions },
  suiClient: SuiClient
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

export type WrappedSuiDynamicFieldObject = WrappedSuiObject & {
  childObjectId: string
  parentObjectId: string
  dynamicFieldId: string
}

export type WrappedSuiSharedObject = WrappedSuiObject & {
  sharedRef: {
    objectId: string
    mutable: boolean
    initialSharedVersion: string
  }
}

/**
 * Fetches a shared object and returns the shared reference fields needed for Move calls.
 * Why: Shared objects carry an `initial_shared_version` that must be supplied in PTBs;
 * this helper extracts it so devs coming from EVM (where storage is global) don’t have to.
 */
export const getSuiSharedObject = async (
  { objectId, mutable = false }: { objectId: string; mutable?: boolean },
  suiClient: SuiClient
): Promise<WrappedSuiSharedObject> => {
  const suiObject = await getSuiObject({ objectId }, suiClient)

  //@ts-expect-error Shared do exist on owner if a shared object
  const sharedProperty = suiObject.owner?.Shared as {
    initial_shared_version: string
  }

  if (!sharedProperty)
    throw new Error(`Object ${objectId} is not shared or missing metadata`)

  return {
    ...suiObject,
    sharedRef: {
      objectId: suiObject.object.objectId,
      mutable,
      initialSharedVersion: normalizeVersion(
        sharedProperty.initial_shared_version
      )
    }
  }
}

export const getObjectIdFromDynamicFieldObject = ({
  content
}: SuiObjectData): string | undefined =>
  //@ts-expect-error the fields will be there for object (not for package)
  content?.fields?.value.fields.id.id

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
    typeof value === "object" &&
    value !== null &&
    "some" in value &&
    (value as { some?: unknown }).some !== undefined
  )
    return attemptNormalize((value as { some?: unknown }).some)

  if (
    typeof value === "object" &&
    value !== null &&
    "none" in value &&
    (value as { none?: unknown }).none === null
  )
    return undefined

  if (typeof value === "object" && value !== null && "fields" in value)
    return attemptNormalize((value as { fields?: unknown }).fields)

  return attemptNormalize(value)
}

export const unwrapMoveObjectFields = (
  object: SuiObjectData
): Record<string, unknown> => {
  const moveContent = object.content
  if (!moveContent || moveContent.dataType !== "moveObject")
    throw new Error(`Object ${object.objectId} is missing Move content.`)

  const fields = (moveContent.fields ?? {}) as Record<string, unknown>
  if ("value" in fields && fields.value && typeof fields.value === "object") {
    const nested = (fields.value as { fields?: Record<string, unknown> }).fields
    if (nested) return nested
  }

  return fields
}

export const isDynamicFieldObject = (objectType?: string) =>
  objectType?.includes("0x2::dynamic_field")

export const dynamicFieldObjectNormalization = (suiObject: SuiObjectData) => ({
  ...suiObject
})

export const getSuiDynamicFieldObject = async (
  {
    childObjectId,
    parentObjectId
  }: {
    childObjectId: string
    parentObjectId: string
  },
  suClient: SuiClient
): Promise<WrappedSuiDynamicFieldObject> => {
  const { data: dynamicFieldObject, error } =
    await suClient.getDynamicFieldObject({
      parentId: normalizeSuiObjectId(parentObjectId),
      name: {
        type: "0x2::object::ID",
        value: normalizeSuiObjectId(childObjectId)
      }
    })

  if (!dynamicFieldObject)
    throw new Error(`Could not fetch dynamic field for ${childObjectId}`)

  return {
    object: dynamicFieldObject,
    parentObjectId,
    childObjectId,
    dynamicFieldId: dynamicFieldObject.objectId,
    error: error || undefined
  }
}

export const fetchObjectWithDynamicFieldFallback = async (
  {
    objectId,
    parentObjectId,
    options = { showContent: true, showOwner: true, showType: true }
  }: {
    objectId: string
    parentObjectId: string
    options?: SuiObjectDataOptions
  },
  suiClient: SuiClient
): Promise<SuiObjectData> => {
  try {
    const { object } = await getSuiObject({ objectId, options }, suiClient)
    return object
  } catch (error) {
    try {
      const { object } = await getSuiDynamicFieldObject(
        { childObjectId: objectId, parentObjectId },
        suiClient
      )
      return object
    } catch {
      throw error
    }
  }
}

export const deriveRelevantPackageId = (objectType: string): string => {
  const packageIdMatches = objectType.match(/0x[0-9a-fA-F]{64}/g)
  const packageIdCandidate =
    packageIdMatches && packageIdMatches.length > 0
      ? packageIdMatches[packageIdMatches.length - 1]
      : objectType.split("::")[0]

  return normalizeSuiObjectId(packageIdCandidate)
}

export const normalizeIdOrThrow = (
  id: string | undefined,
  errorMessage: string
): string => normalizeSuiObjectId(requireValue(id, errorMessage))
