import { normalizeSuiObjectId } from "@mysten/sui/utils"

export type TypeNameParts = {
  packageId: string
  moduleName: string
  structName: string
}

/**
 * Parses a fully qualified Move type string into its parts.
 * Throws when the type is not well formed to keep caller validation explicit.
 */
export const parseTypeNameFromString = (typeName: string): TypeNameParts => {
  const trimmed = typeName.trim()
  const genericIndex = trimmed.indexOf("<")
  const normalizedType =
    genericIndex >= 0 ? trimmed.slice(0, genericIndex) : trimmed
  const [packageId, moduleName, structName] = normalizedType.split("::")
  if (!packageId || !moduleName || !structName)
    throw new Error(
      "Type must be fully qualified (e.g., 0x2::sui::SUI or 0x...::module::Type)."
    )

  return {
    packageId: normalizeSuiObjectId(packageId),
    moduleName,
    structName
  }
}

/**
 * Normalizes Move type info from heterogeneous RPC field representations.
 * Sui responses may embed type names as strings or nested structs.
 */
export const normalizeTypeNameFromFieldValue = (
  fieldValue: unknown
): TypeNameParts | undefined => {
  if (!fieldValue) return undefined

  const tryParseFromString = (value: unknown) => {
    if (typeof value !== "string") return undefined

    try {
      return parseTypeNameFromString(value)
    } catch {
      return undefined
    }
  }

  const parsedFromString = tryParseFromString(fieldValue)
  if (parsedFromString) return parsedFromString

  if (typeof fieldValue !== "object") return undefined

  const value = fieldValue as Record<string, unknown>

  if ("fields" in value && value.fields !== undefined) {
    const parsedFromFields = normalizeTypeNameFromFieldValue(value.fields)
    if (parsedFromFields) return parsedFromFields
  }

  const packageId = value.package ?? value.address
  const moduleName = value.module ?? value.module_name
  const structName = value.name ?? value.struct ?? value.struct_name

  if (
    typeof packageId === "string" &&
    typeof moduleName === "string" &&
    typeof structName === "string"
  ) {
    try {
      return {
        packageId: normalizeSuiObjectId(packageId),
        moduleName,
        structName
      }
    } catch {
      return undefined
    }
  }

  const fallbackTypeName = tryParseFromString(structName)
  if (fallbackTypeName) return fallbackTypeName

  if (typeof value.name === "string") return tryParseFromString(value.name)

  return undefined
}

/**
 * Checks whether a candidate field value matches an expected Move type.
 */
export const isMatchingTypeName = (
  expectedTypeName: TypeNameParts,
  candidateFieldValue: unknown
): boolean => {
  const normalizedCandidate =
    normalizeTypeNameFromFieldValue(candidateFieldValue)
  if (!normalizedCandidate) return false

  return (
    normalizedCandidate.packageId === expectedTypeName.packageId &&
    normalizedCandidate.moduleName === expectedTypeName.moduleName &&
    normalizedCandidate.structName === expectedTypeName.structName
  )
}

/**
 * Formats a fully qualified Move type name.
 */
export const formatTypeName = (typeName: TypeNameParts) =>
  `${typeName.packageId}::${typeName.moduleName}::${typeName.structName}`

/**
 * Formats a Move type name from a field value if it can be parsed.
 */
export const formatTypeNameFromFieldValue = (fieldValue: unknown) => {
  const typeName = normalizeTypeNameFromFieldValue(fieldValue)
  if (!typeName) return undefined

  return formatTypeName(typeName)
}

/**
 * Extracts the struct name from a fully qualified Move type string.
 * Returns undefined when the type cannot be parsed.
 */
export const extractStructNameFromType = (
  typeName: string
): string | undefined => {
  const trimmed = typeName.trim()
  if (!trimmed) return undefined

  const withoutGenerics = trimmed.split("<")[0]
  const parts = withoutGenerics.split("::").filter(Boolean)
  if (parts.length === 0) return undefined

  return parts[parts.length - 1]
}
