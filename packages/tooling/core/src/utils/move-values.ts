import { tryParseBigInt } from "./utility.ts"

type MoveFieldRecord = Record<string, unknown>

const isRecord = (value: unknown): value is MoveFieldRecord =>
  typeof value === "object" && value !== null

/**
 * Unwraps a Move-like value into its fields record when present.
 */
export const unwrapMoveFields = (
  value: unknown
): MoveFieldRecord | undefined => {
  if (!isRecord(value)) return undefined

  if ("fields" in value && isRecord(value.fields))
    return value.fields as MoveFieldRecord

  return value
}

/**
 * Unwraps a Move Option<T>-like value into the underlying payload.
 */
export const unwrapMoveOptionValue = (value: unknown): unknown => {
  const record = unwrapMoveFields(value)
  if (!record) return value

  if ("some" in record) return (record as { some: unknown }).some
  if ("none" in record) return undefined

  return value
}

/**
 * Extracts the first matching field value by key list.
 */
export const extractFieldValueByKeys = (
  container: MoveFieldRecord | undefined,
  candidateKeys: string[]
): unknown => {
  if (!container) return undefined

  for (const key of candidateKeys) {
    if (key in container) return container[key]
  }

  return undefined
}

/**
 * Normalizes a bigint from Move-like values (Option, nested fields, or primitives).
 */
export const normalizeBigIntFromMoveValue = (
  value: unknown
): bigint | undefined => {
  const unwrappedValue = unwrapMoveOptionValue(value)
  if (unwrappedValue === undefined || unwrappedValue === null) return undefined

  if (typeof unwrappedValue === "bigint") return unwrappedValue
  if (typeof unwrappedValue === "number") return BigInt(unwrappedValue)
  if (typeof unwrappedValue === "string") {
    try {
      return tryParseBigInt(unwrappedValue)
    } catch {
      return undefined
    }
  }

  const nestedFields = unwrapMoveFields(unwrappedValue)
  if (!nestedFields) return undefined

  if ("value" in nestedFields)
    return normalizeBigIntFromMoveValue(nestedFields.value)

  const nestedFieldValues = Object.values(nestedFields)
  if (nestedFieldValues.length === 1)
    return normalizeBigIntFromMoveValue(nestedFieldValues[0])

  return undefined
}

/**
 * Normalizes a boolean from Move-like values (Option, nested fields, or primitives).
 */
export const normalizeBooleanFromMoveValue = (
  value: unknown
): boolean | undefined => {
  const unwrappedValue = unwrapMoveOptionValue(value)
  if (typeof unwrappedValue === "boolean") return unwrappedValue
  if (typeof unwrappedValue === "string") {
    if (unwrappedValue.toLowerCase() === "true") return true
    if (unwrappedValue.toLowerCase() === "false") return false
  }

  const fields = unwrapMoveFields(unwrappedValue)
  if (!fields) return undefined
  if ("value" in fields) return normalizeBooleanFromMoveValue(fields.value)

  const nestedValues = Object.values(fields)
  if (nestedValues.length === 1)
    return normalizeBooleanFromMoveValue(nestedValues[0])

  return undefined
}

/**
 * Parses an i64-like Move value into magnitude + sign.
 */
export const parseI64FromMoveValue = (
  value: unknown
): { magnitude: bigint; negative: boolean } | undefined => {
  const fields = unwrapMoveFields(value)
  if (!fields) return undefined

  const magnitude = normalizeBigIntFromMoveValue(fields.magnitude)
  const negative = normalizeBooleanFromMoveValue(fields.negative)

  if (magnitude === undefined || negative === undefined) return undefined

  return { magnitude, negative }
}
