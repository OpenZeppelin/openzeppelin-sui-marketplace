import { describe, expect, it, vi } from "vitest"
import { createSuiClientMock } from "../../../test/helpers/sui.ts"
import {
  getAllDynamicFields,
  getObjectIdFromDynamicFieldObject,
  getObjectWithDynamicFieldFallback,
  hasDynamicFieldValueId,
  isDynamicFieldObject
} from "../../src/dynamic-fields.ts"

describe("dynamic field helpers", () => {
  it("paginates and filters dynamic fields", async () => {
    const { client, mocks } = createSuiClientMock({
      getDynamicFields: vi
        .fn()
        .mockResolvedValueOnce({
          data: [
            { objectType: "match::type", name: { value: "0x1" } },
            { objectType: "other::type", name: { value: "0x2" } }
          ],
          hasNextPage: true,
          nextCursor: "next"
        })
        .mockResolvedValueOnce({
          data: [{ objectType: "match::type", name: { value: "0x3" } }],
          hasNextPage: false,
          nextCursor: null
        })
    })

    const fields = await getAllDynamicFields(
      { parentObjectId: "0xabc", objectTypeFilter: "match::type" },
      { suiClient: client }
    )

    expect(fields.map((field) => field.name)).toEqual([
      { value: "0x1" },
      { value: "0x3" }
    ])
    expect(mocks.getDynamicFields).toHaveBeenCalledTimes(2)
  })

  it("detects nested dynamic field value ids", () => {
    expect(
      hasDynamicFieldValueId({
        fields: { value: { fields: { id: { id: "0x1" } } } }
      })
    ).toBe(true)
  })

  it("extracts child object ids from dynamic field objects", () => {
    const objectId = getObjectIdFromDynamicFieldObject({
      content: {
        fields: {
          value: { fields: { id: { id: "0x2" } } }
        }
      }
    } as never)

    expect(objectId).toBe("0x2")
  })

  it("detects dynamic field object types", () => {
    expect(isDynamicFieldObject("0x2::dynamic_field::Field")).toBe(true)
    expect(isDynamicFieldObject("0x2::other::Type")).toBe(false)
  })

  it("falls back to dynamic field lookup when direct object fetch fails", async () => {
    const { client } = createSuiClientMock({
      getObject: vi.fn().mockResolvedValue({ data: undefined }),
      getDynamicFieldObject: vi.fn().mockResolvedValue({
        data: { objectId: "0x5" },
        error: undefined
      })
    })

    const result = await getObjectWithDynamicFieldFallback(
      {
        objectId: "0x5",
        parentObjectId: "0xparent"
      },
      { suiClient: client }
    )

    expect(result.objectId).toBe("0x5")
  })
})
