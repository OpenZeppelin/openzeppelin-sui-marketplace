import { describe, expect, it, vi } from "vitest"
import { normalizeSuiAddress } from "@mysten/sui/utils"
import { resolveOwnerAddress } from "../../src/account.ts"

const getAccountConfigMock = vi.hoisted(() => vi.fn())
const loadKeypairMock = vi.hoisted(() => vi.fn())

vi.mock("../../src/config.ts", () => ({
  getAccountConfig: getAccountConfigMock
}))

vi.mock("../../src/keypair.ts", () => ({
  loadKeypair: loadKeypairMock
}))

describe("resolveOwnerAddress", () => {
  it("prefers the provided address", async () => {
    const resolved = await resolveOwnerAddress("0x2", {
      account: { accountIndex: 0 }
    } as never)

    expect(resolved).toBe(normalizeSuiAddress("0x2"))
  })

  it("uses account address from config when provided", async () => {
    getAccountConfigMock.mockReturnValueOnce({ accountAddress: "0x3" })

    const resolved = await resolveOwnerAddress(undefined, {
      account: { accountIndex: 0 }
    } as never)

    expect(resolved).toBe(normalizeSuiAddress("0x3"))
  })

  it("falls back to loading a keypair", async () => {
    getAccountConfigMock.mockReturnValueOnce({ accountIndex: 0 })
    loadKeypairMock.mockResolvedValueOnce({ toSuiAddress: () => "0x4" })

    const resolved = await resolveOwnerAddress(undefined, {
      account: { accountIndex: 0 }
    } as never)

    expect(resolved).toBe(normalizeSuiAddress("0x4"))
  })
})
