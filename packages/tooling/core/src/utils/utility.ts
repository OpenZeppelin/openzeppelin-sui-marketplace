type SafeObject = Record<string, unknown>

const isDangerousKey = (key: string): boolean =>
  key === "__proto__" || key === "constructor" || key === "prototype"

const isAllowedKey = (key: string): boolean => !isDangerousKey(key)

const isMergeableObject = (value: unknown): value is SafeObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const buildObjectFromEntries = (entries: [string, unknown][]): SafeObject =>
  entries.reduce<SafeObject>(
    (result, [key, value]) => ({ ...result, [key]: value }),
    {}
  )

const getAllUniqueKeys = (left: SafeObject, right: SafeObject): string[] =>
  Array.from(new Set([...Object.keys(left), ...Object.keys(right)]))

const mergeValuesAtPath = (
  leftValue: unknown,
  rightValue: unknown
): unknown => {
  if (isMergeableObject(leftValue) && isMergeableObject(rightValue)) {
    return mergeDeepObjects(leftValue, rightValue)
  }

  return rightValue
}

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

export const wait = (ms: number) => makeDelay()(ms).promise
export const sleep = wait

export const tryParseBigInt = (value: string): bigint => {
  try {
    return BigInt(value)
  } catch {
    throw new Error(`Invalid numeric value: ${value}`)
  }
}

export const parseNonNegativeU64 = (
  rawValue: string,
  label: string
): bigint => {
  const value = tryParseBigInt(rawValue)
  if (value < 0n) throw new Error(`${label} cannot be negative.`)

  const maxU64 = (1n << 64n) - 1n
  if (value > maxU64)
    throw new Error(`${label} exceeds the maximum allowed u64 value.`)

  return value
}

export const parsePositiveU64 = (rawValue: string, label: string): bigint => {
  const value = parseNonNegativeU64(rawValue, label)
  if (value <= 0n) throw new Error(`${label} must be greater than zero.`)
  return value
}

export const parseOptionalU64 = (
  rawValue: string | undefined,
  label: string
): bigint | undefined =>
  rawValue === undefined ? undefined : parseNonNegativeU64(rawValue, label)

export const parseOptionalPositiveU64 = (
  rawValue: string | undefined,
  label: string
): bigint | undefined =>
  rawValue === undefined ? undefined : parsePositiveU64(rawValue, label)

export const requireValue = <T>(
  value: T | undefined,
  errorMessage: string
): T => {
  if (!value) throw new Error(errorMessage)
  return value
}
