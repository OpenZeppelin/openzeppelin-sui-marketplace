import { describe, expect, it, vi } from "vitest"

const { resolveLatestShopIdentifiers, resolveLatestArtifactShopId } =
  vi.hoisted(() => ({
    resolveLatestShopIdentifiers: vi.fn(),
    resolveLatestArtifactShopId: vi.fn()
  }))

vi.mock("@sui-oracle-market/domain-node/shop", () => ({
  resolveLatestShopIdentifiers,
  resolveLatestArtifactShopId
}))

import {
  resolveOwnerShopIdentifiers,
  resolveShopIdOrLatest
} from "../shop-context.ts"

describe("shop context helpers", () => {
  it("resolves owner shop identifiers", async () => {
    resolveLatestShopIdentifiers.mockResolvedValue({
      packageId: "0x1",
      shopId: "0x2",
      ownerCapId: "0x3"
    })

    const result = await resolveOwnerShopIdentifiers({
      networkName: "localnet",
      shopPackageId: "0x1",
      shopId: "0x2",
      ownerCapId: "0x3"
    })

    expect(resolveLatestShopIdentifiers).toHaveBeenCalledWith(
      {
        packageId: "0x1",
        shopId: "0x2",
        ownerCapId: "0x3"
      },
      "localnet"
    )
    expect(result).toEqual({
      packageId: "0x1",
      shopId: "0x2",
      ownerCapId: "0x3"
    })
  })

  it("resolves shop id using artifacts", async () => {
    resolveLatestArtifactShopId.mockResolvedValue("0xshop")

    const result = await resolveShopIdOrLatest("0xmaybe", "testnet")

    expect(resolveLatestArtifactShopId).toHaveBeenCalledWith(
      "0xmaybe",
      "testnet"
    )
    expect(result).toBe("0xshop")
  })
})
