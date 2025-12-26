import { normalizeSuiAddress, normalizeSuiObjectId } from "@mysten/sui/utils"
import { ensureHexPrefix, hexToBytes } from "../hex.ts"
import { parseTypeNameFromString } from "./type-name.ts"

/**
 * Returns a clean validation error message when possible.
 */
export const resolveValidationMessage = (
  error: unknown,
  fallbackMessage: string
) => (error instanceof Error ? error.message : fallbackMessage)

/**
 * Validates that a value is a fully qualified Move type string.
 */
export const validateMoveType = (
  value: string,
  label: string
): string | undefined => {
  const trimmed = value.trim()
  if (!trimmed) return `${label} is required.`

  try {
    parseTypeNameFromString(trimmed)
    return undefined
  } catch (error) {
    return resolveValidationMessage(
      error,
      `${label} must be a fully qualified Move type.`
    )
  }
}

/**
 * Validates that a value is a required Sui object ID.
 */
export const validateRequiredSuiObjectId = (
  value: string,
  label: string
): string | undefined => {
  const trimmed = value.trim()
  if (!trimmed) return `${label} is required.`

  try {
    normalizeSuiObjectId(trimmed)
    return undefined
  } catch (error) {
    return resolveValidationMessage(
      error,
      `${label} must be a valid Sui object id.`
    )
  }
}

/**
 * Validates an optional Sui object ID.
 */
export const validateOptionalSuiObjectId = (
  value: string,
  label: string
): string | undefined => {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return validateRequiredSuiObjectId(trimmed, label)
}

/**
 * Validates an optional Sui address.
 */
export const validateOptionalSuiAddress = (
  value: string,
  label: string
): string | undefined => {
  const trimmed = value.trim()
  if (!trimmed) return undefined

  try {
    normalizeSuiAddress(trimmed)
    return undefined
  } catch (error) {
    return resolveValidationMessage(
      error,
      `${label} must be a valid Sui address.`
    )
  }
}

/**
 * Validates a required hex value by expected byte length.
 */
export const validateRequiredHexBytes = ({
  value,
  expectedBytes,
  label
}: {
  value: string
  expectedBytes: number
  label: string
}): string | undefined => {
  const trimmed = value.trim()
  if (!trimmed) return `${label} is required.`

  try {
    const normalized = ensureHexPrefix(trimmed)
    if (!/^0x[0-9a-fA-F]+$/.test(normalized))
      throw new Error(`${label} must be a valid hex string.`)

    const bytes = hexToBytes(normalized)
    if (bytes.some((byte) => Number.isNaN(byte)))
      throw new Error(`${label} must be a valid hex string.`)

    if (bytes.length !== expectedBytes)
      throw new Error(
        `${label} must be ${expectedBytes} bytes (${expectedBytes * 2} hex chars).`
      )
    return undefined
  } catch (error) {
    return resolveValidationMessage(error, `Invalid ${label}.`)
  }
}
