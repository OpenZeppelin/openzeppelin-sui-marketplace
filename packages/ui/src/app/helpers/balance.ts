export const parseBalance = (value?: string | number | bigint) => {
  if (value === undefined || value === null) return 0n
  if (typeof value === "bigint") return value
  if (typeof value === "number") return BigInt(Math.trunc(value))
  try {
    return BigInt(value)
  } catch {
    return 0n
  }
}
