import { describe, expect, it, vi } from "vitest"
import { normalizeSuiAddress, normalizeSuiObjectId } from "@mysten/sui/utils"
import {
  buildCoinTransferTransaction,
  normalizeCoinType,
  resolveCoinOwnership
} from "../../src/coin.ts"
import { createSuiClientMock } from "../../../tests-integration/helpers/sui.ts"

describe("coin helpers", () => {
  it("normalizes coin types", () => {
    expect(normalizeCoinType("0x2::sui::SUI")).toBe(
      `${normalizeSuiObjectId("0x2")}::sui::SUI`
    )
    expect(() => normalizeCoinType("")).toThrow("coinType cannot be empty.")
  })

  it("builds a coin transfer transaction", () => {
    const transaction = buildCoinTransferTransaction({
      coinObjectId: "0x1",
      amount: 10n,
      recipientAddress: "0x2"
    })

    expect(transaction).toBeDefined()
  })

  it("resolves coin ownership from object responses", async () => {
    const { client } = createSuiClientMock({
      getObject: vi.fn().mockResolvedValue({
        data: {
          type: "0x2::coin::Coin<0x2::sui::SUI>",
          owner: { AddressOwner: "0x2" }
        },
        error: undefined
      })
    })

    const ownership = await resolveCoinOwnership(
      { coinObjectId: "0x1" },
      { suiClient: client }
    )

    expect(ownership.coinType).toBe("0x2::coin::Coin<0x2::sui::SUI>")
    expect(ownership.ownerAddress).toBe(normalizeSuiAddress("0x2"))
  })
})
