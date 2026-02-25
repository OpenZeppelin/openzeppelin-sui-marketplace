import type { SuiObjectData } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import type { ToolingCoreContext } from "./context.ts"
import { getAllDynamicFields } from "./dynamic-fields.ts"
import {
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
 * Fetches a single table entry dynamic field object by typed key.
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
  { suiClient }: ToolingCoreContext
): Promise<SuiObjectData | undefined> => {
  const { data: dynamicFieldObject } = await suiClient.getDynamicFieldObject({
    parentId: normalizeSuiObjectId(tableObjectId),
    name: {
      type: keyType,
      value: keyValue
    }
  })

  return dynamicFieldObject || undefined
}
