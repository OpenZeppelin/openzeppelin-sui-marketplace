import { getAllDynamicFields } from "./dynamic-fields.ts"
import {
  getSuiObject,
  normalizeIdOrThrow,
  normalizeOptionalAddress,
  normalizeOptionalIdFromValue,
  unwrapMoveObjectFields,
  type WrappedSuiObject
} from "./object.ts"
import { normalizeBigIntFromMoveValue } from "./utils/move-values.ts"
import {
  formatTypeName,
  formatTypeNameFromFieldValue,
  parseTypeNameFromString
} from "./utils/type-name.ts"

export const TABLE_KEY_TYPE_OBJECT_ID = "0x2::object::ID"
export const TABLE_KEY_TYPE_U64 = "u64"
export const TABLE_KEY_TYPE_ADDRESS = "address"
export const TABLE_KEY_TYPE_TYPE_NAME = "0x1::type_name::TypeName"

type TableKeyStringNormalizer = (keyValue: unknown) => string | undefined

const normalizeObjectIdTableKeyAsString: TableKeyStringNormalizer = (
  keyValue
) => normalizeOptionalIdFromValue(keyValue)

const normalizeU64TableKeyAsString: TableKeyStringNormalizer = (keyValue) => {
  const normalizedValue = normalizeBigIntFromMoveValue(keyValue)
  if (normalizedValue === undefined || normalizedValue < 0n) return undefined
  return normalizedValue.toString()
}

const normalizeAddressTableKeyAsString: TableKeyStringNormalizer = (
  keyValue
) => {
  if (typeof keyValue !== "string") return undefined
  return normalizeOptionalAddress(keyValue)
}

const normalizeTypeNameTableKeyAsString: TableKeyStringNormalizer = (
  keyValue
) => {
  if (typeof keyValue === "string")
    return formatTypeName(parseTypeNameFromString(keyValue))

  return formatTypeNameFromFieldValue(keyValue)
}

const tableKeyNormalizers: Record<string, TableKeyStringNormalizer> = {
  [TABLE_KEY_TYPE_OBJECT_ID]: normalizeObjectIdTableKeyAsString,
  [TABLE_KEY_TYPE_U64]: normalizeU64TableKeyAsString,
  [TABLE_KEY_TYPE_ADDRESS]: normalizeAddressTableKeyAsString,
  [TABLE_KEY_TYPE_TYPE_NAME]: normalizeTypeNameTableKeyAsString
}

const supportsDirectDynamicFieldLookup = (keyType: string) =>
  keyType !== TABLE_KEY_TYPE_TYPE_NAME

const normalizeTableKeyAsString = ({
  keyType,
  keyValue
}: {
  keyType: string
  keyValue: unknown
}): string | undefined => {
  const normalizeTableKey = tableKeyNormalizers[keyType]
  if (normalizeTableKey) return normalizeTableKey(keyValue)
  throw new Error(`Unsupported table key type ${keyType}.`)
}

const findMatchingTableEntryField = ({
  tableEntryFields,
  keyType,
  keyValue
}: {
  tableEntryFields: Awaited<ReturnType<typeof getTableEntryDynamicFields>>
  keyType: string
  keyValue: unknown
}) => {
  const normalizedExpectedKey = normalizeTableKeyAsString({ keyType, keyValue })
  if (!normalizedExpectedKey) return undefined

  return tableEntryFields.find((tableEntryField) => {
    const normalizedEntryKey = normalizeTableKeyAsString({
      keyType,
      keyValue: tableEntryField.name.value
    })

    return (
      normalizedEntryKey !== undefined &&
      normalizedEntryKey === normalizedExpectedKey
    )
  })
}

const getTableEntryObjectByDynamicFieldKey = async (
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
  if (!supportsDirectDynamicFieldLookup(keyType)) return undefined

  const normalizedKeyValue = normalizeTableKeyAsString({ keyType, keyValue })
  if (!normalizedKeyValue) return undefined

  const normalizedTableObjectId = normalizeIdOrThrow(
    tableObjectId,
    "Missing table object id."
  )

  const { data } = await context.suiClient
    .getDynamicFieldObject({
      parentId: normalizedTableObjectId,
      name: {
        type: keyType,
        value: normalizedKeyValue
      }
    })
    .catch(() => ({ data: undefined }))

  if (!data) return undefined

  const { object } = await getSuiObject(
    {
      objectId: data.objectId,
      options: { showContent: true, showType: true }
    },
    context
  )
  return object
}

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
 * Attempts direct dynamic-field lookups for supported key types and falls back
 * to dynamic-field scans when direct resolution is unavailable.
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
  const directMatch = await getTableEntryObjectByDynamicFieldKey(
    { tableObjectId, keyType, keyValue },
    context
  )
  if (directMatch) return directMatch

  const tableEntryFields = await getTableEntryDynamicFields(
    { tableObjectId },
    context
  )
  const matchingEntry = findMatchingTableEntryField({
    tableEntryFields,
    keyType,
    keyValue
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
