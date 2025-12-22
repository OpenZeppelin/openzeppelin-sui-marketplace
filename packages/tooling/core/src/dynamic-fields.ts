import type {
  SuiClient,
  SuiObjectData,
  SuiObjectDataOptions
} from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"

import type { ToolingCoreContext } from "./context.ts"
import type { WrappedSuiObject } from "./object.ts"
import { getSuiObject } from "./object.ts"

export type WrappedSuiDynamicFieldObject = WrappedSuiObject & {
  childObjectId: string
  parentObjectId: string
  dynamicFieldId: string
}

type DynamicFieldInfo = Awaited<
  ReturnType<SuiClient["getDynamicFields"]>
>["data"][number]

export const getAllDynamicFields = async (
  {
    parentObjectId,
    objectTypeFilter
  }: { parentObjectId: string; objectTypeFilter?: string },
  { suiClient }: ToolingCoreContext
): Promise<DynamicFieldInfo[]> => {
  const dynamicFields: DynamicFieldInfo[] = []
  let cursor: string | null | undefined

  do {
    const page = await suiClient.getDynamicFields({
      parentId: normalizeSuiObjectId(parentObjectId),
      cursor
    })

    dynamicFields.push(...page.data)
    cursor = page.hasNextPage ? page.nextCursor : undefined
  } while (cursor)

  return objectTypeFilter
    ? dynamicFields.filter((dynamicField) =>
        dynamicField.objectType?.includes(objectTypeFilter)
      )
    : dynamicFields
}

export const getAllDynamicFieldObjects = async (
  {
    parentObjectId,
    objectTypeFilter
  }: { parentObjectId: string; objectTypeFilter?: string },
  context: ToolingCoreContext
): Promise<WrappedSuiDynamicFieldObject[]> => {
  const allDynamicFields = await getAllDynamicFields(
    {
      parentObjectId,
      objectTypeFilter
    },
    context
  )

  return await Promise.all(
    allDynamicFields.map(({ name }) =>
      getSuiDynamicFieldObject(
        {
          childObjectId: name.value as string,
          parentObjectId
        },
        context
      )
    )
  )
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

type DynamicFieldValueIdContent = {
  fields: {
    value: {
      fields: {
        id: {
          id: string
        }
      }
    }
  }
}

export const hasDynamicFieldValueId = (
  content: unknown
): content is DynamicFieldValueIdContent => {
  if (!isRecord(content)) return false

  const fields = content["fields"]
  if (!isRecord(fields)) return false

  const value = fields["value"]
  if (!isRecord(value)) return false

  const valueFields = value["fields"]
  if (!isRecord(valueFields)) return false

  const id = valueFields["id"]
  if (!isRecord(id)) return false

  return typeof id["id"] === "string"
}

export const getObjectIdFromDynamicFieldObject = ({
  content
}: SuiObjectData): string | undefined =>
  hasDynamicFieldValueId(content)
    ? content.fields.value.fields.id.id
    : undefined

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
  { suiClient }: ToolingCoreContext
): Promise<WrappedSuiDynamicFieldObject> => {
  const { data: dynamicFieldObject, error } =
    await suiClient.getDynamicFieldObject({
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

export const getObjectWithDynamicFieldFallback = async (
  {
    objectId,
    parentObjectId,
    options = { showContent: true, showOwner: true, showType: true }
  }: {
    objectId: string
    parentObjectId: string
    options?: SuiObjectDataOptions
  },
  context: ToolingCoreContext
): Promise<SuiObjectData> => {
  try {
    const { object } = await getSuiObject({ objectId, options }, context)
    return object
  } catch (error) {
    try {
      const { object } = await getSuiDynamicFieldObject(
        { childObjectId: objectId, parentObjectId },
        context
      )
      return object
    } catch {
      throw error
    }
  }
}
