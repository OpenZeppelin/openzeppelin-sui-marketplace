import type {
  SuiClient,
  SuiObjectData,
  SuiObjectDataOptions
} from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"

import { getSuiObject } from "./object.ts"
import type { WrappedSuiObject } from "./object.ts"

export type WrappedSuiDynamicFieldObject = WrappedSuiObject & {
  childObjectId: string
  parentObjectId: string
  dynamicFieldId: string
}

export const getObjectIdFromDynamicFieldObject = ({
  content
}: SuiObjectData): string | undefined =>
  //@ts-expect-error the fields will be there for object (not for package)
  content?.fields?.value?.fields?.id?.id

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
