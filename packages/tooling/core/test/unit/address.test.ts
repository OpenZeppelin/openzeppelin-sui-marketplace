import { describe, expect, it, vi } from "vitest"
import { normalizeSuiAddress } from "@mysten/sui/utils"
import {
  asMinimumBalanceOf,
  getCoinBalanceSummary,
  getCoinBalances,
  parseAddressList
} from "../../src/address.ts"
import { createSuiClientMock } from "../../../test/helpers/sui.ts"

describe("address helpers", () => {
  it("parses and normalizes address lists", () => {
    const addresses = parseAddressList({
      rawAddresses: "0x2, 0x2",
      label: "Addresses"
    })

    expect(addresses).toEqual([normalizeSuiAddress("0x2")])
  })

  it("throws when address list is empty", () => {
    expect(() =>
      parseAddressList({ rawAddresses: "", label: "Addresses" })
    ).toThrow("Addresses must include at least one address.")
  })

  it("summarizes coin balances", async () => {
    const { client } = createSuiClientMock({
      getBalance: vi.fn().mockResolvedValue({
        coinType: "0x2::sui::SUI",
        coinObjectCount: 2,
        totalBalance: "100",
        lockedBalance: { epoch: "25" }
      })
    })

    const summary = await getCoinBalanceSummary(
      { address: "0x2", coinType: "0x2::sui::SUI" },
      { suiClient: client }
    )

    expect(summary.totalBalance).toBe(100n)
    expect(summary.lockedBalanceTotal).toBe(25n)
  })

  it("summarizes all balances", async () => {
    const { client } = createSuiClientMock({
      getAllBalances: vi.fn().mockResolvedValue([
        {
          coinType: "0x2::sui::SUI",
          coinObjectCount: 1,
          totalBalance: "50",
          lockedBalance: {}
        }
      ])
    })

    const balances = await getCoinBalances(
      { address: "0x2" },
      { suiClient: client }
    )

    expect(balances).toHaveLength(1)
    expect(balances[0]?.totalBalance).toBe(50n)
  })

  it("checks minimum balances", async () => {
    const { client } = createSuiClientMock({
      getBalance: vi.fn().mockResolvedValue({
        coinType: "0x2::sui::SUI",
        coinObjectCount: 1,
        totalBalance: "200",
        lockedBalance: {}
      })
    })

    await expect(
      asMinimumBalanceOf(
        { address: "0x2", minimumBalance: 100n },
        { suiClient: client }
      )
    ).resolves.toBe(true)
  })
})
