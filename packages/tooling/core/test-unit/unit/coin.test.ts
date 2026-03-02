import { describe, expect, it, vi } from "vitest"
import { normalizeSuiAddress, normalizeSuiObjectId } from "@mysten/sui/utils"
import {
  buildCoinTransferTransaction,
  findCreatedCoinObjectRefs,
  normalizeCoinType,
  pickDedicatedGasPaymentRefFromSplit,
  resolveCoinOwnership
} from "../../src/coin.ts"
import {
  buildCreatedObjectChange,
  buildTransactionResponse,
  createSuiClientMock
} from "../../../tests-integration/helpers/sui.ts"

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

  it("finds created coin object references by coin type", () => {
    const transactionBlock = buildTransactionResponse({
      objectChanges: [
        buildCreatedObjectChange({
          objectType: "0x2::coin::Coin<0x2::sui::SUI>",
          objectId: "0x5",
          version: "7",
          digest: "digest-a"
        }),
        buildCreatedObjectChange({
          objectType: "0x2::coin::Coin<0x2::usdc::USDC>",
          objectId: "0x6",
          version: "9",
          digest: "digest-b"
        })
      ]
    })

    const references = findCreatedCoinObjectRefs(
      transactionBlock,
      "0x2::sui::SUI"
    )

    expect(references).toEqual([
      {
        objectId: normalizeSuiObjectId("0x5"),
        version: "7",
        digest: "digest-a"
      }
    ])
  })

  it("picks a dedicated gas coin ref from split results", () => {
    const splitTransactionBlock = buildTransactionResponse({
      objectChanges: [
        buildCreatedObjectChange({
          objectType: "0x2::coin::Coin<0x2::sui::SUI>",
          objectId: "0x5",
          version: "10",
          digest: "digest-payment"
        }),
        buildCreatedObjectChange({
          objectType: "0x2::coin::Coin<0x2::sui::SUI>",
          objectId: "0x7",
          version: "11",
          digest: "digest-gas"
        })
      ]
    })

    const dedicatedGasPaymentRef = pickDedicatedGasPaymentRefFromSplit({
      splitTransactionBlock,
      paymentCoinObjectId: "0x0005"
    })

    expect(dedicatedGasPaymentRef).toEqual({
      objectId: normalizeSuiObjectId("0x7"),
      version: "11",
      digest: "digest-gas"
    })
  })

  it("returns undefined when split only creates the payment SUI coin", () => {
    const splitTransactionBlock = buildTransactionResponse({
      objectChanges: [
        buildCreatedObjectChange({
          objectType: "0x2::coin::Coin<0x2::sui::SUI>",
          objectId: "0x9",
          version: "12",
          digest: "digest-payment-only"
        })
      ]
    })

    const dedicatedGasPaymentRef = pickDedicatedGasPaymentRefFromSplit({
      splitTransactionBlock,
      paymentCoinObjectId: "0x9"
    })

    expect(dedicatedGasPaymentRef).toBeUndefined()
  })

  it("returns undefined when split creates no SUI coins", () => {
    const splitTransactionBlock = buildTransactionResponse({
      objectChanges: [
        buildCreatedObjectChange({
          objectType: "0x2::coin::Coin<0x2::usdc::USDC>",
          objectId: "0xa",
          version: "13",
          digest: "digest-usdc"
        })
      ]
    })

    const dedicatedGasPaymentRef = pickDedicatedGasPaymentRefFromSplit({
      splitTransactionBlock,
      paymentCoinObjectId: "0x9"
    })

    expect(dedicatedGasPaymentRef).toBeUndefined()
  })
})
