export type ToKebabCaseOptions = {
  replaceUnderscores?: boolean
}

export const toKebabCase = (
  value: string,
  { replaceUnderscores = false }: ToKebabCaseOptions = {}
) => {
  const withWordSeparators = value.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
  const withNormalizedSeparators = replaceUnderscores
    ? withWordSeparators.replace(/_/g, "-")
    : withWordSeparators

  return withNormalizedSeparators.toLowerCase()
}
