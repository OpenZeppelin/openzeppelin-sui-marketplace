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

const tryGetBuffer = ():
  | { from: (data: number[]) => { toString: (enc: string) => string } }
  | undefined => {
  const maybeBuffer = (globalThis as unknown as { Buffer?: unknown }).Buffer
  if (!maybeBuffer) return undefined

  const candidate = maybeBuffer as { from?: unknown }
  if (typeof candidate.from !== "function") return undefined
  return candidate as {
    from: (data: number[]) => { toString: (enc: string) => string }
  }
}

export const formatVectorBytesAsHex = (value: unknown): string => {
  const byteArray = asNumberArray(value)
  if (!byteArray) return "Unknown"

  const buffer = tryGetBuffer()
  const hexValue = buffer
    ? buffer.from(byteArray).toString("hex")
    : byteArray.map((byte) => byte.toString(16).padStart(2, "0")).join("")

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
