export const formatUsdFromCents = (rawCents?: string) => {
  if (!rawCents) return "Unknown"
  try {
    const cents = BigInt(rawCents)
    const dollars = cents / 100n
    const remainder = (cents % 100n).toString().padStart(2, "0")
    return `$${dollars.toString()}.${remainder}`
  } catch {
    return "Unknown"
  }
}

export const formatEpochSeconds = (rawSeconds?: string) => {
  if (!rawSeconds) return "Unknown"
  const timestamp = Number(rawSeconds) * 1000
  if (!Number.isFinite(timestamp)) return "Unknown"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric"
  }).format(new Date(timestamp))
}

export const shortenId = (value: string, start = 6, end = 4) => {
  if (value.length <= start + end) return value
  return `${value.slice(0, start)}...${value.slice(-end)}`
}

const normalizeBigInt = (value: bigint | number | string) => {
  if (typeof value === "bigint") return value
  if (typeof value === "number") return BigInt(Math.trunc(value))
  return BigInt(value)
}

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

export const getStructLabel = (typeName?: string) => {
  if (!typeName) return "Unknown"
  const fragments = typeName.split("::")
  return fragments[fragments.length - 1] || typeName
}
