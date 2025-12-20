import type {
  SuiClient,
  SuiObjectChangeCreated,
  SuiObjectData
} from "@mysten/sui/client"

import type { WrappedSuiObject } from "./object.ts"
import { getSuiObject, normalizeVersion } from "./object.ts"

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
