import { deriveObjectID, normalizeSuiObjectId } from "@mysten/sui/utils"
import { describe, expect, it, vi } from "vitest"
import { createSuiClientMock } from "../../../tests-integration/helpers/sui.ts"
import {
  deriveCurrencyObjectId,
  listCurrencyRegistryEntries,
  resolveCurrencyObjectId
} from "../../src/coin-registry.ts"

const dynamicFieldMock = vi.hoisted(() => ({
  getAllDynamicFields: vi.fn()
}))

vi.mock("../../src/dynamic-fields.ts", () => ({
  getAllDynamicFields: dynamicFieldMock.getAllDynamicFields
}))

describe("coin registry helpers", () => {
  it("derives currency object ids", () => {
    const registryId = normalizeSuiObjectId("0x1")
    const coinType = "0x2::sui::SUI"

    const derived = deriveCurrencyObjectId(coinType, registryId)
    const expected = normalizeSuiObjectId(
      deriveObjectID(
        registryId,
        `0x2::coin_registry::CurrencyKey<${coinType}>`,
        new Uint8Array([0])
      )
    )

    expect(derived).toBe(expected)
  })

  it("returns empty entries when no dynamic fields exist", async () => {
    const { client } = createSuiClientMock()
    dynamicFieldMock.getAllDynamicFields.mockResolvedValue([])

    const entries = await listCurrencyRegistryEntries({}, { suiClient: client })

    expect(entries).toEqual([])
  })

  it("lists registry entries with metadata when requested", async () => {
    const { client } = createSuiClientMock({
      multiGetObjects: vi.fn().mockResolvedValue([
        {
          data: {
            objectId: "0x2",
            type: "0x2::coin_registry::Currency<0x2::sui::SUI>",
            content: {
              fields: {
                symbol: {
                  fields: { bytes: Buffer.from("SUI").toString("base64") }
                },
                name: {
                  fields: { bytes: Buffer.from("Sui").toString("base64") }
                },
                description: {
                  fields: { bytes: Buffer.from("coin").toString("base64") }
                },
                decimals: 9
              }
            }
          }
        }
      ])
    })

    dynamicFieldMock.getAllDynamicFields.mockResolvedValue([
      { name: { value: { pos0: "0x2" } } }
    ])

    const entries = await listCurrencyRegistryEntries(
      { includeMetadata: true },
      { suiClient: client }
    )

    expect(entries).toEqual([
      expect.objectContaining({
        currencyId: normalizeSuiObjectId("0x2"),
        coinType: "0x2::sui::SUI",
        symbol: "SUI",
        name: "Sui",
        description: "coin",
        decimals: 9
      })
    ])
  })

  it("resolves currency object id from derived lookup", async () => {
    const normalizedPackage = normalizeSuiObjectId("0x2")
    const { client } = createSuiClientMock({
      getObject: vi.fn().mockResolvedValue({
        data: {
          objectId: "0x2",
          type: `0x2::coin_registry::Currency<${normalizedPackage}::sui::SUI>`
        }
      })
    })

    const resolved = await resolveCurrencyObjectId(
      { coinType: "0x2::sui::SUI" },
      { suiClient: client }
    )

    expect(resolved).toBe(normalizeSuiObjectId("0x2"))
  })

  it("resolves currency object id when registry uses short address types", async () => {
    const { client } = createSuiClientMock({
      getObject: vi.fn().mockResolvedValue({
        data: {
          objectId: "0x2",
          type: "0x2::coin_registry::Currency<0x2::sui::SUI>"
        }
      })
    })

    const resolved = await resolveCurrencyObjectId(
      { coinType: "0x2::sui::SUI" },
      { suiClient: client }
    )

    expect(resolved).toBe(normalizeSuiObjectId("0x2"))
  })

  it("returns undefined when derived lookup fails and fallback is disabled", async () => {
    const { client } = createSuiClientMock({
      getObject: vi.fn().mockResolvedValue({ data: { type: "0x2::other::X" } })
    })

    const resolved = await resolveCurrencyObjectId(
      { coinType: "0x2::sui::SUI", fallbackRegistryScan: false },
      { suiClient: client }
    )

    expect(resolved).toBeUndefined()
  })

  it("falls back to registry scan when derived lookup fails", async () => {
    const normalizedPackage = normalizeSuiObjectId("0x2")
    const { client } = createSuiClientMock({
      getObject: vi.fn().mockResolvedValue({ data: { type: "0x2::other::X" } }),
      multiGetObjects: vi.fn().mockResolvedValue([
        {
          data: {
            objectId: "0x3",
            type: `0x2::coin_registry::Currency<${normalizedPackage}::sui::SUI>`
          }
        }
      ])
    })

    dynamicFieldMock.getAllDynamicFields.mockResolvedValue([
      { name: { value: { pos0: "0x3" } } }
    ])

    const resolved = await resolveCurrencyObjectId(
      {
        coinType: "0x2::sui::SUI",
        fallbackRegistryScan: true
      },
      { suiClient: client }
    )

    expect(resolved).toBe(normalizeSuiObjectId("0x3"))
  })

  it("returns undefined when registry scan finds no matches", async () => {
    const normalizedPackage = normalizeSuiObjectId("0x2")
    const { client } = createSuiClientMock({
      getObject: vi.fn().mockResolvedValue({ data: { type: "0x2::other::X" } }),
      multiGetObjects: vi.fn().mockResolvedValue([
        {
          data: {
            objectId: "0x4",
            type: `${normalizedPackage}::coin_registry::Currency<${normalizedPackage}::other::Token>`
          }
        }
      ])
    })

    dynamicFieldMock.getAllDynamicFields.mockResolvedValue([
      { name: { value: { pos0: "0x4" } } }
    ])

    const resolved = await resolveCurrencyObjectId(
      {
        coinType: "0x2::sui::SUI",
        fallbackRegistryScan: true
      },
      { suiClient: client }
    )

    expect(resolved).toBeUndefined()
  })
})
