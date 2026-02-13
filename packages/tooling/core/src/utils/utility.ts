type SafeObject = Record<string, unknown>

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object"

/**
 * Guards against prototype-pollution keys when merging objects.
 */
const isDangerousKey = (key: string): boolean =>
  key === "__proto__" || key === "constructor" || key === "prototype"

/**
 * Allows only safe keys to be merged.
 */
const isAllowedKey = (key: string): boolean => !isDangerousKey(key)

/**
 * Checks for non-empty, non-array objects for deep merge.
 */
const isMergeableObject = (value: unknown): value is SafeObject =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

/**
 * Builds a new object from key/value pairs.
 */
const buildObjectFromEntries = (entries: [string, unknown][]): SafeObject =>
  entries.reduce<SafeObject>(
    (result, [key, value]) => ({ ...result, [key]: value }),
    {}
  )

/**
 * Returns the union of keys across two objects.
 */
const getAllUniqueKeys = (left: SafeObject, right: SafeObject): string[] =>
  Array.from(new Set([...Object.keys(left), ...Object.keys(right)]))

/**
 * Merges two values, recursing on plain objects.
 */
const mergeValuesAtPath = (
  leftValue: unknown,
  rightValue: unknown
): unknown => {
  if (isMergeableObject(leftValue) && isMergeableObject(rightValue)) {
    return mergeDeepObjects(leftValue, rightValue)
  }

  return rightValue
}

/**
 * Deeply merges two objects, guarding against prototype-pollution keys.
 */
export const mergeDeepObjects = <
  Left extends SafeObject,
  Right extends SafeObject
>(
  left: Left,
  right: Right
): Left & Right => {
  const keys = getAllUniqueKeys(left, right)

  const mergedEntries = keys.reduce<[string, unknown][]>((entries, key) => {
    if (!isAllowedKey(key)) {
      return entries
    }

    const leftHasKey = Object.prototype.hasOwnProperty.call(left, key)
    const rightHasKey = Object.prototype.hasOwnProperty.call(right, key)

    if (!leftHasKey && !rightHasKey) {
      return entries
    }

    const leftValue = left[key]
    const rightValue = right[key]

    const mergedValue =
      leftHasKey && rightHasKey
        ? mergeValuesAtPath(leftValue, rightValue)
        : leftHasKey
          ? leftValue
          : rightValue

    return [...entries, [key, mergedValue]]
  }, [])

  return buildObjectFromEntries(mergedEntries) as Left & Right
}

/**
 * Creates a cancelable delay helper.
 */
const makeDelay = () => (ms: number) => {
  const startTimer = (resolve: () => void) => {
    const id = setTimeout(resolve, ms)
    return () => clearTimeout(id)
  }

  let cancelFn: () => void = () => {}

  const promise = new Promise<void>((resolve) => {
    cancelFn = startTimer(resolve)
  })

  return { promise, cancel: cancelFn }
}

/**
 * Returns a promise that resolves after `ms` milliseconds.
 */
export const wait = (ms: number) => makeDelay()(ms).promise

/**
 * Alias for wait.
 */
export const sleep = wait

/**
 * Parses a bigint or throws a descriptive error on failure.
 */
export const tryParseBigInt = (value: string): bigint => {
  try {
    return BigInt(value)
  } catch {
    throw new Error(`Invalid numeric value: ${value}`)
  }
}

type Parser<T> = (rawValue: string, label: string) => T

const buildBoundedBigIntParser = <T>({
  min,
  max,
  map,
  maxLabel
}: {
  min: bigint
  max: bigint
  map: (value: bigint) => T
  maxLabel: string
}): Parser<T> => {
  return (rawValue, label) => {
    const value = tryParseBigInt(rawValue)
    if (value < min) throw new Error(`${label} cannot be negative.`)
    if (value > max)
      throw new Error(`${label} exceeds the maximum allowed ${maxLabel} value.`)

    return map(value)
  }
}

const withPositive = <T extends bigint | number>(parser: Parser<T>): Parser<T> =>
  (rawValue, label) => {
    const value = parser(rawValue, label)
    const isPositive = typeof value === "bigint" ? value > 0n : value > 0
    if (!isPositive) throw new Error(`${label} must be greater than zero.`)
    return value
  }

const withOptional = <T>(parser: Parser<T>) => {
  return (rawValue: string | undefined, label: string): T | undefined =>
    rawValue === undefined ? undefined : parser(rawValue, label)
}

/**
 * Parses a non-negative u64 from user input.
 * Sui uses u64 for many on-chain quantities; keep them as bigint in JS.
 */
export const parseNonNegativeU64 = (
  rawValue: string,
  label: string
): bigint => {
  return buildBoundedBigIntParser({
    min: 0n,
    max: (1n << 64n) - 1n,
    map: (value) => value,
    maxLabel: "u64"
  })(rawValue, label)
}

/**
 * Parses a positive (non-zero) u64 from user input.
 */
export const parsePositiveU64 = (rawValue: string, label: string): bigint => {
  return withPositive(parseNonNegativeU64)(rawValue, label)
}

/**
 * Parses an optional u64 from user input.
 */
export const parseOptionalU64 = (
  rawValue: string | undefined,
  label: string
): bigint | undefined =>
  withOptional(parseNonNegativeU64)(rawValue, label)

/**
 * Parses an optional positive u64 from user input.
 */
export const parseOptionalPositiveU64 = (
  rawValue: string | undefined,
  label: string
): bigint | undefined =>
  withOptional(parsePositiveU64)(rawValue, label)

/**
 * Parses a non-negative u16 from user input.
 */
export const parseNonNegativeU16 = (
  rawValue: string,
  label: string
): number => {
  return buildBoundedBigIntParser({
    min: 0n,
    max: (1n << 16n) - 1n,
    map: (value) => Number(value),
    maxLabel: "u16"
  })(rawValue, label)
}

/**
 * Parses a positive (non-zero) u16 from user input.
 */
export const parsePositiveU16 = (rawValue: string, label: string): number => {
  return withPositive(parseNonNegativeU16)(rawValue, label)
}

/**
 * Parses an optional u16 from user input.
 */
export const parseOptionalU16 = (
  rawValue: string | undefined,
  label: string
): number | undefined =>
  withOptional(parseNonNegativeU16)(rawValue, label)

/**
 * Parses an optional positive u16 from user input.
 */
export const parseOptionalPositiveU16 = (
  rawValue: string | undefined,
  label: string
): number | undefined =>
  withOptional(parsePositiveU16)(rawValue, label)

/**
 * Parses a bigint-like value and falls back to 0 on invalid input.
 */
export const parseBalance = (value?: string | number | bigint) => {
  if (value === undefined) return 0n
  if (typeof value === "bigint") return value
  if (typeof value === "number") return BigInt(Math.trunc(value))
  try {
    return BigInt(value)
  } catch {
    return 0n
  }
}

/**
 * Asserts a value is present, otherwise throws with the provided message.
 */
export const requireValue = <T>(
  value: T | undefined,
  errorMessage: string
): T => {
  if (!value) throw new Error(errorMessage)
  return value
}
