import { getAllDynamicFields } from "./dynamic-fields.ts"
import {
  getSuiObject,
  normalizeIdOrThrow,
  normalizeOptionalIdFromValue,
  unwrapMoveObjectFields,
  type WrappedSuiObject
} from "./object.ts"

/**
 * Resolves a table object ID stored in a Move object field.
 */
export const resolveTableObjectIdFromField = ({
  object,
  fieldName
}: {
  object: WrappedSuiObject["object"]
  fieldName: string
}): string => {
  const objectFields = unwrapMoveObjectFields<Record<string, unknown>>(object)
  const tableObjectId = normalizeOptionalIdFromValue(objectFields[fieldName])
  return normalizeIdOrThrow(
    tableObjectId,
    `Object ${object.objectId} is missing table field ${fieldName}.`
  )
}

/**
 * Lists table entry dynamic fields for a table object.
 */
export const getTableEntryDynamicFields = async (
  {
    tableObjectId,
    objectTypeFilter
  }: { tableObjectId: string; objectTypeFilter?: string },
  context: Parameters<typeof getAllDynamicFields>[1]
): Promise<Awaited<ReturnType<typeof getAllDynamicFields>>> =>
  getAllDynamicFields(
    { parentObjectId: tableObjectId, objectTypeFilter },
    context
  )

/**
 * Resolves a single table entry dynamic field object by key.
 * Supports direct `0x2::object::ID` lookups and falls back to dynamic-field scans.
 */
export const getTableEntryDynamicFieldObject = async (
  {
    tableObjectId,
    keyType,
    keyValue
  }: {
    tableObjectId: string
    keyType: string
    keyValue: unknown
  },
  context: Parameters<typeof getAllDynamicFields>[1]
): Promise<WrappedSuiObject["object"] | undefined> => {
  const normalizedObjectIdKey =
    keyType === "0x2::object::ID"
      ? normalizeOptionalIdFromValue(keyValue)
      : undefined

  if (normalizedObjectIdKey) {
    try {
      const { object } = await getSuiObject(
        {
          objectId: normalizeIdOrThrow(
            normalizedObjectIdKey,
            "Missing table entry object id."
          ),
          options: { showContent: true, showType: true }
        },
        context
      )
      return object
    } catch {
      // Fall through to dynamic-field scan when the object ID is not directly fetchable.
    }
  }

  const tableEntryFields = await getTableEntryDynamicFields(
    { tableObjectId },
    context
  )
  const matchingEntry = tableEntryFields.find((tableEntryField) => {
    if (normalizedObjectIdKey)
      return (
        normalizeOptionalIdFromValue(tableEntryField.name.value) ===
        normalizedObjectIdKey
      )

    return (
      JSON.stringify(tableEntryField.name.value) === JSON.stringify(keyValue)
    )
  })

  if (!matchingEntry) return undefined

  const { object } = await getSuiObject(
    {
      objectId: matchingEntry.objectId,
      options: { showContent: true, showType: true }
    },
    context
  )

  return object
}
