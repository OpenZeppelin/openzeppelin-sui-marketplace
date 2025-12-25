import { normalizeSuiAddress, normalizeSuiObjectId } from "@mysten/sui/utils"
import { ensureHexPrefix, hexToBytes } from "@sui-oracle-market/tooling-core/hex"
import { parseTypeNameFromString } from "@sui-oracle-market/tooling-core/utils/type-name"

export const resolveValidationMessage = (
  error: unknown,
  fallbackMessage: string
) => (error instanceof Error ? error.message : fallbackMessage)

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

export const validateOptionalSuiObjectId = (
  value: string,
  label: string
): string | undefined => {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return validateRequiredSuiObjectId(trimmed, label)
}

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
