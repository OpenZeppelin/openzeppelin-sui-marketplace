/**
 * Helpers for decoding common Move data representations into friendlier formats.
 * Centralizes vector<u8> parsing and numeric normalization so scripts can stay lean.
 */
export const asNumberArray = (value: unknown): number[] | undefined => {
  if (!Array.isArray(value)) return undefined

  return value.map((entry) => {
    if (typeof entry !== "number")
      throw new Error("Expected vector<u8> to be an array of numbers.")
    return entry
  })
}

export const decodeUtf8Vector = (value: unknown): string | undefined => {
  const byteArray = asNumberArray(value)
  if (!byteArray) return undefined

  const decoded = new TextDecoder().decode(Uint8Array.from(byteArray)).trim()
  return decoded || undefined
}

export const formatVectorBytesAsHex = (value: unknown): string => {
  const byteArray = asNumberArray(value)
  if (!byteArray) return "Unknown"

  const hexValue = Buffer.from(byteArray).toString("hex")
  return `0x${hexValue}`
}

export const formatOptionalNumericValue = (
  value: unknown
): string | undefined => {
  if (value === undefined || value === null) return undefined
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "number") return value.toString()
  if (typeof value === "string") return value

  return undefined
}

export const parseOptionalNumber = (value: unknown): number | undefined => {
  if (typeof value === "number") return value
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10)
    return Number.isNaN(parsed) ? undefined : parsed
  }

  return undefined
}
