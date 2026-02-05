import type {
  SuiClient,
  SuiObjectData,
  SuiObjectDataOptions
} from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"

import type { ToolingCoreContext } from "./context.ts"
import type { WrappedSuiObject } from "./object.ts"
import { getSuiObject, normalizeOptionalIdFromValue } from "./object.ts"
import { isRecord } from "./utils/utility.ts"

export type WrappedSuiDynamicFieldObject = WrappedSuiObject & {
  childObjectId: string
  parentObjectId: string
  dynamicFieldId: string
}

type DynamicFieldInfo = Awaited<
  ReturnType<SuiClient["getDynamicFields"]>
>["data"][number]

/**
 * Lists all dynamic field entries under a parent object.
 * Dynamic fields are object-owned key-value tables attached to a parent object,
 * and pagination is handled internally.
 */
export const getAllDynamicFields = async (
  {
    parentObjectId,
    objectTypeFilter
  }: { parentObjectId: string; objectTypeFilter?: string },
  { suiClient }: ToolingCoreContext
): Promise<DynamicFieldInfo[]> => {
  const dynamicFields: DynamicFieldInfo[] = []
  let cursor: string | undefined

  do {
    const page = await suiClient.getDynamicFields({
      parentId: normalizeSuiObjectId(parentObjectId),
      cursor
    })

    dynamicFields.push(...page.data)
    cursor = page.hasNextPage ? (page.nextCursor ?? undefined) : undefined
  } while (cursor)

  return objectTypeFilter
    ? dynamicFields.filter((dynamicField) =>
        dynamicField.objectType?.includes(objectTypeFilter)
      )
    : dynamicFields
}

/**
 * Fetches full object data for every dynamic field entry under a parent.
 * Useful when the dynamic field value is an object ID and you want to inspect
 * each child object in one pass.
 */
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

/**
 * Checks whether a dynamic field's content structure contains a nested `id.id` string.
 * Many dynamic field values wrap an object ID, which is stored deeper than the top-level fields.
 */
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

/**
 * Extracts a child object ID from a dynamic field object, if present.
 * On Sui, dynamic fields often store object IDs instead of direct values.
 */
export const getObjectIdFromDynamicFieldObject = ({
  content
}: SuiObjectData): string | undefined =>
  hasDynamicFieldValueId(content)
    ? content.fields.value.fields.id.id
    : undefined

/**
 * Returns true if the object type indicates a dynamic field object.
 */
export const isDynamicFieldObject = (objectType?: string) =>
  objectType?.includes("0x2::dynamic_field")

/**
 * Placeholder normalization hook for dynamic field objects.
 * Intentionally a no-op today; kept for symmetry with other normalization utilities.
 */
export const dynamicFieldObjectNormalization = (suiObject: SuiObjectData) => ({
  ...suiObject
})

/**
 * Fetches a single dynamic field object by parent/child IDs.
 * Dynamic field lookups are keyed by (parent object, name); this wraps the RPC call.
 */
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
  const normalizedChildObjectId = normalizeSuiObjectId(childObjectId)
  const { data: dynamicFieldObject, error } =
    await suiClient.getDynamicFieldObject({
      parentId: normalizeSuiObjectId(parentObjectId),
      name: {
        type: "0x2::object::ID",
        value: normalizedChildObjectId
      }
    })

  if (!dynamicFieldObject) {
    const dynamicFields = await getAllDynamicFields(
      { parentObjectId },
      { suiClient }
    )
    const matchingField = dynamicFields.find(
      (dynamicField) =>
        normalizeOptionalIdFromValue(dynamicField.name.value) ===
        normalizedChildObjectId
    )

    if (!matchingField)
      throw new Error(
        `Could not fetch dynamic field for ${normalizedChildObjectId}`
      )

    const { object, error: objectError } = await getSuiObject(
      {
        objectId: matchingField.objectId,
        options: { showContent: true, showType: true }
      },
      { suiClient }
    )

    return {
      object,
      parentObjectId,
      childObjectId: normalizedChildObjectId,
      dynamicFieldId: matchingField.objectId,
      error: objectError || undefined
    }
  }

  return {
    object: dynamicFieldObject,
    parentObjectId,
    childObjectId: normalizedChildObjectId,
    dynamicFieldId: dynamicFieldObject.objectId,
    error: error || undefined
  }
}

/**
 * Attempts to fetch an object directly, then falls back to dynamic field lookup.
 * Handy when callers only know an ID that might be stored inside a dynamic field.
 */
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
