export const parseBooleanEnv = (value: string | undefined) => {
  if (!value) return false
  return ["1", "true", "yes", "on"].includes(value.toLowerCase())
}
