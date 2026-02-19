import type {
  SuiClient,
  SuiObjectData,
  SuiObjectDataOptions
} from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"

import type { ToolingCoreContext } from "./context.ts"
import type { WrappedSuiObject } from "./object.ts"
import { getSuiObject, normalizeOptionalIdFromValue } from "./object.ts"
import { normalizeBigIntFromMoveValue } from "./utils/move-values.ts"
import { isRecord } from "./utils/utility.ts"

export type WrappedSuiDynamicFieldObject = WrappedSuiObject & {
  childObjectId: string
  parentObjectId: string
  dynamicFieldId: string
}

type DynamicFieldInfo = Awaited<
  ReturnType<SuiClient["getDynamicFields"]>
>["data"][number]
type DynamicFieldName = Parameters<
  SuiClient["getDynamicFieldObject"]
>[0]["name"]

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
  context: ToolingCoreContext
): Promise<WrappedSuiDynamicFieldObject> =>
  getSuiDynamicFieldObjectByName(
    {
      parentObjectId,
      name: {
        type: "0x2::object::ID",
        value: normalizeSuiObjectId(childObjectId)
      }
    },
    context
  )

const normalizeDynamicFieldNameValue = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmedValue = value.trim()
    if (!trimmedValue) return undefined

    // Preserve numeric keys like u64 ("7") instead of coercing them into object IDs.
    if (!trimmedValue.startsWith("0x")) {
      const normalizedNumericValue = normalizeBigIntFromMoveValue(trimmedValue)
      if (normalizedNumericValue !== undefined)
        return normalizedNumericValue.toString()
      return trimmedValue
    }

    const normalizedHexId = normalizeOptionalIdFromValue(trimmedValue)
    if (normalizedHexId) return normalizedHexId
    return trimmedValue
  }

  const normalizedObjectId = normalizeOptionalIdFromValue(value)
  if (normalizedObjectId) return normalizedObjectId

  const normalizedNumericValue = normalizeBigIntFromMoveValue(value)
  if (normalizedNumericValue !== undefined)
    return normalizedNumericValue.toString()

  if (typeof value === "number") return Math.trunc(value).toString()
  if (typeof value === "bigint") return value.toString()

  return undefined
}

const normalizeDynamicFieldNameType = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined
  const normalizedType = value.trim().toLowerCase()
  if (!normalizedType) return undefined
  if (normalizedType === "address") return "object::id"
  if (normalizedType.includes("::object::id")) return "object::id"
  return normalizedType
}

const hasMatchingDynamicFieldName = ({
  expectedName,
  candidateField
}: {
  expectedName: DynamicFieldName
  candidateField: DynamicFieldInfo
}) => {
  const expectedType = normalizeDynamicFieldNameType(expectedName.type)
  const candidateType = normalizeDynamicFieldNameType(candidateField.name.type)
  if (expectedType && candidateType && expectedType !== candidateType)
    return false

  const expectedValue = normalizeDynamicFieldNameValue(expectedName.value)
  const candidateValue = normalizeDynamicFieldNameValue(
    candidateField.name.value
  )

  return expectedValue !== undefined && candidateValue === expectedValue
}

/**
 * Fetches a single dynamic field object by parent/name pair.
 * Supports non-object keys such as `u64` for Table entries.
 */
export const getSuiDynamicFieldObjectByName = async (
  {
    parentObjectId,
    name
  }: {
    parentObjectId: string
    name: DynamicFieldName
  },
  { suiClient }: ToolingCoreContext
): Promise<WrappedSuiDynamicFieldObject> => {
  const normalizedParentObjectId = normalizeSuiObjectId(parentObjectId)
  const normalizedNameValue =
    normalizeDynamicFieldNameValue(name.value) ?? String(name.value)

  const { data: dynamicFieldObject, error } =
    await suiClient.getDynamicFieldObject({
      parentId: normalizedParentObjectId,
      name
    })

  if (!dynamicFieldObject) {
    const dynamicFields = await getAllDynamicFields(
      { parentObjectId: normalizedParentObjectId },
      { suiClient }
    )
    const matchingField = dynamicFields.find((dynamicField) =>
      hasMatchingDynamicFieldName({
        expectedName: name,
        candidateField: dynamicField
      })
    )

    if (!matchingField)
      throw new Error(
        `Could not fetch dynamic field for key ${normalizedNameValue}`
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
      parentObjectId: normalizedParentObjectId,
      childObjectId: normalizedNameValue,
      dynamicFieldId: matchingField.objectId,
      error: objectError || undefined
    }
  }

  return {
    object: dynamicFieldObject,
    parentObjectId: normalizedParentObjectId,
    childObjectId: normalizedNameValue,
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
