import type {
  ObjectOwner,
  ObjectResponseError,
  SuiClient,
  SuiObjectData,
  SuiObjectDataOptions
} from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"

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

export type WrappedSuiSharedObject = {
  object: SuiObjectData
  sharedRef: {
    objectId: string
    mutable: boolean
    initialSharedVersion: number | string
  }
  error?: ObjectResponseError
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
      initialSharedVersion: sharedProperty.initial_shared_version
    }
  }
}
