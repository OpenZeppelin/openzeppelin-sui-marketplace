const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

/**
 * Safely stringifies data to JSON, converting bigint values to strings.
 */
export const safeJsonStringify = (value: unknown, space?: number) => {
  try {
    return JSON.stringify(
      value,
      (_key, val) => (typeof val === "bigint" ? val.toString() : val),
      space
    )
  } catch {
    return undefined
  }
}

/**
 * Converts complex values (including cyclic structures) into JSON-friendly data.
 */
export const serializeForJson = (
  value: unknown,
  seen: WeakSet<object> = new WeakSet()
): unknown => {
  if (typeof value === "bigint") return value.toString()
  if (!isRecord(value)) return value
  if (seen.has(value)) return "[Circular]"
  seen.add(value)

  const output: Record<string, unknown> = {}
  for (const key of Object.getOwnPropertyNames(value)) {
    try {
      output[key] = serializeForJson(
        (value as Record<string, unknown>)[key],
        seen
      )
    } catch (error) {
      output[key] = `[Unreadable: ${String(error)}]`
    }
  }

  if (output.name === undefined && "constructor" in value) {
    const constructorName = (value as { constructor?: { name?: string } })
      .constructor?.name
    if (constructorName) output.name = constructorName
  }

  if (typeof (value as { toString?: () => string }).toString === "function") {
    try {
      output.toStringValue = String(value)
    } catch {
      // Ignore toString errors.
    }
  }

  return output
}

/**
 * Extracts a normalized error shape for logs or UI display.
 */
export const extractErrorDetails = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause
    }
  }

  if (isRecord(error)) {
    return {
      name: typeof error.name === "string" ? error.name : undefined,
      message: typeof error.message === "string" ? error.message : undefined,
      code: typeof error.code === "string" ? error.code : undefined,
      cause: error.cause
    }
  }

  return { message: safeJsonStringify(error) }
}

/**
 * Formats unknown errors into a readable message string.
 */
export const formatErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (isRecord(error)) {
    if (typeof error.message === "string") return error.message
    if (typeof error.name === "string") return error.name
    const serialized = safeJsonStringify(serializeForJson(error))
    if (serialized) return serialized
  }
  const fallback = String(error)
  if (fallback && fallback !== "[object Object]") return fallback
  return "Unexpected error. Check console for details."
}
