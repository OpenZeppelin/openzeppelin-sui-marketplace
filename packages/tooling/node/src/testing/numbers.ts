export const parseNonNegativeInteger = (
  value: string | undefined
): number | undefined => {
  if (!value) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) return undefined
  return parsed
}

export const parsePositiveInteger = (
  value: string | undefined
): number | undefined => {
  const parsed = parseNonNegativeInteger(value)
  if (parsed === undefined || parsed <= 0) return undefined
  return parsed
}
