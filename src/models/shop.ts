import { getLatestObjectFromArtifact } from "../tooling/artifacts.ts"
import { normalizeIdOrThrow } from "../tooling/object.ts"
import { tryParseBigInt } from "../utils/utility.ts"

export type ShopIdentifierInputs = {
  packageId?: string
  shopId?: string
  ownerCapId?: string
}

export type ShopIdentifiers = {
  packageId: string
  shopId: string
  ownerCapId: string
}

export const parseUsdToCents = (rawPrice: string): bigint => {
  const normalized = rawPrice.trim()
  if (!normalized) throw new Error("Price is required.")

  const decimalMatch = normalized.match(/^(\d+)(?:\.(\d{0,2}))?$/)
  if (!decimalMatch) {
    const asInteger = tryParseBigInt(normalized)
    if (asInteger < 0n) throw new Error("Price cannot be negative.")
    return asInteger
  }

  const dollars = decimalMatch[1]
  const fractional = (decimalMatch[2] || "").padEnd(2, "0")

  return BigInt(dollars) * 100n + BigInt(fractional)
}

export const resolveLatestShopIdentifiers = async (
  providedIdentifiers: ShopIdentifierInputs,
  networkName: string
): Promise<ShopIdentifiers> => {
  const [shopArtifact, ownerCapArtifact] = await Promise.all([
    getLatestObjectFromArtifact("shop::Shop", networkName),
    getLatestObjectFromArtifact("shop::ShopOwnerCap", networkName)
  ])

  return {
    packageId: normalizeIdOrThrow(
      providedIdentifiers.packageId ?? shopArtifact?.packageId,
      "A shop package id is required; publish the package first or provide --shop-package-id."
    ),
    shopId: normalizeIdOrThrow(
      providedIdentifiers.shopId ?? shopArtifact?.objectId,
      "A shop id is required; create a shop first or provide --shop-id."
    ),
    ownerCapId: normalizeIdOrThrow(
      providedIdentifiers.ownerCapId ?? ownerCapArtifact?.objectId,
      "An owner cap id is required; create a shop first or provide --owner-cap-id."
    )
  }
}
