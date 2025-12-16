import type {
  ObjectOwner,
  ObjectResponseError,
  SuiClient,
  SuiObjectChangeCreated,
  SuiObjectData,
  SuiObjectDataOptions
} from "@mysten/sui/client"
import { normalizeSuiAddress, normalizeSuiObjectId } from "@mysten/sui/utils"

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
  publisherId: string
  signer: string
}

export type ObjectArtifactObjectInfo = {
  objectId: string
  objectType: string
  objectName?: string
  owner?: ObjectOwnerArtifact
  initialSharedVersion?: string
  version?: string
  digest?: string
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
    options = { showOwner: true }
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

export const getSuiDynamicFieldObject = async (
  {
    childObjectId,
    parentObjectId
  }: {
    childObjectId: string
    parentObjectId: string
  },
  suClient: SuiClient
): Promise<WrappedSuiObject> => {
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
    error: error || undefined
  }
}
