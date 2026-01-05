/**
 * Parses a Move `vector<u8>` into a number array for downstream decoding.
 * Centralizes vector<u8> parsing so scripts can stay lean.
 */
export const asNumberArray = (value: unknown): number[] | undefined => {
  if (!Array.isArray(value)) return undefined

  return value.map((entry) => {
    if (typeof entry !== "number")
      throw new Error("Expected vector<u8> to be an array of numbers.")
    return entry
  })
}

/**
 * Decodes a Move `vector<u8>` into a UTF-8 string when possible.
 */
export const decodeUtf8Vector = (value: unknown): string | undefined => {
  const byteArray = asNumberArray(value)
  if (!byteArray) return undefined

  const decoded = new TextDecoder().decode(Uint8Array.from(byteArray)).trim()
  return decoded || undefined
}

const tryGetBufferForBase64 = ():
  | {
      from: (
        data: string,
        encoding: string
      ) => { toString: (enc: string) => string }
    }
  | undefined => {
  const maybeBuffer = (globalThis as unknown as { Buffer?: unknown }).Buffer
  if (!maybeBuffer) return undefined

  const candidate = maybeBuffer as { from?: unknown }
  if (typeof candidate.from !== "function") return undefined
  return candidate as {
    from: (
      data: string,
      encoding: string
    ) => { toString: (enc: string) => string }
  }
}

const decodeBase64ToString = (value: string): string | undefined => {
  const buffer = tryGetBufferForBase64()
  if (buffer) {
    try {
      return buffer.from(value, "base64").toString("utf8")
    } catch {
      return undefined
    }
  }

  if (typeof globalThis.atob === "function") {
    try {
      const binary = globalThis.atob(value)
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
      return new TextDecoder().decode(bytes)
    } catch {
      return undefined
    }
  }

  return undefined
}

/**
 * Attempts to decode a Move `string` field from Sui RPC responses.
 */
export const readMoveString = (value: unknown): string | undefined => {
  if (typeof value === "string") return value
  if (!value || typeof value !== "object") return undefined

  const record = value as Record<string, unknown>
  const fields = record.fields as Record<string, unknown> | undefined
  const bytes = fields?.bytes
  if (typeof bytes !== "string") return undefined

  const decoded = decodeBase64ToString(bytes)?.trim()
  return decoded || undefined
}

/**
 * Decodes a byte array to a UTF-8 string.
 */
export const fromBytesToString = (bytes: number[]): string =>
  new TextDecoder().decode(new Uint8Array(bytes))

/**
 * Attempts to load Node's Buffer API for hex encoding without a hard dependency.
 */
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

/**
 * Formats a Move `vector<u8>` as a hex string.
 */
export const formatVectorBytesAsHex = (value: unknown): string => {
  const byteArray = asNumberArray(value)
  if (!byteArray) return "Unknown"

  const buffer = tryGetBuffer()
  const hexValue = buffer
    ? buffer.from(byteArray).toString("hex")
    : byteArray.map((byte) => byte.toString(16).padStart(2, "0")).join("")

  return `0x${hexValue}`
}

/**
 * Formats numeric-like values as strings for display (supports bigint, number, string).
 */
export const formatOptionalNumericValue = (
  value: unknown
): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "number") return value.toString()
  if (typeof value === "string") return value

  return undefined
}

/**
 * Formats epoch seconds into a locale date string.
 */
export const formatEpochSeconds = (rawSeconds?: string | number): string => {
  if (rawSeconds === undefined) return "Unknown"
  const seconds =
    typeof rawSeconds === "string" ? Number(rawSeconds) : rawSeconds
  if (!Number.isFinite(seconds)) return "Unknown"

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric"
  }).format(new Date(seconds * 1000))
}

/**
 * Formats a timestamp (ms) into a locale datetime string.
 */
export const formatTimestamp = (timestampMs?: string | number): string => {
  if (!timestampMs) return "Unknown"
  const timestamp = Number(timestampMs)
  if (!Number.isFinite(timestamp)) return "Unknown"
  return new Date(timestamp).toLocaleString()
}

/**
 * Shortens a long identifier for display.
 */
export const shortenId = (value: string, start = 6, end = 4) => {
  if (value.length <= start + end) return value
  return `${value.slice(0, start)}...${value.slice(-end)}`
}

const normalizeBigInt = (value: bigint | number | string) => {
  if (typeof value === "bigint") return value
  if (typeof value === "number") return BigInt(Math.trunc(value))
  return BigInt(value)
}

/**
 * Formats a coin balance using its decimal scale.
 */
export const formatCoinBalance = ({
  balance,
  decimals = 9,
  maxFractionDigits = 6
}: {
  balance: bigint | number | string
  decimals?: number
  maxFractionDigits?: number
}) => {
  const normalized = normalizeBigInt(balance)
  if (decimals <= 0) return normalized.toString()

  const divisor = 10n ** BigInt(decimals)
  const whole = normalized / divisor
  const fraction = normalized % divisor
  const fractionValue = fraction
    .toString()
    .padStart(decimals, "0")
    .slice(0, maxFractionDigits)
    .replace(/0+$/, "")

  return fractionValue
    ? `${whole.toString()}.${fractionValue}`
    : whole.toString()
}

/**
 * Formats a Move struct type into its terminal label.
 */
export const getStructLabel = (typeName?: string) => {
  if (!typeName) return "Unknown"
  const fragments = typeName.split("::")
  return fragments[fragments.length - 1] || typeName
}

/**
 * Parses an optional number from user input or RPC output.
 */
export const parseOptionalNumber = (value: unknown): number | undefined => {
  if (typeof value === "number") return value
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10)
    return Number.isNaN(parsed) ? undefined : parsed
  }

  return undefined
}
