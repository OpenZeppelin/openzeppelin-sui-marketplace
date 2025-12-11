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
