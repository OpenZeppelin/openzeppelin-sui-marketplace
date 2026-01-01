import { describe, expect, it } from "vitest"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import {
  buildOwnedObjectLogFields,
  countUniqueObjectTypes,
  formatOptionalNumber,
  getResponseContentField,
  getResponseDisplayField,
  getResponseObjectId,
  mapOwnerToLabel
} from "../../src/object-info.ts"

describe("object info helpers", () => {
  it("maps owner labels from response shapes", () => {
    expect(mapOwnerToLabel({ AddressOwner: "0x1" })).toBe("0x1")
    expect(mapOwnerToLabel({ ObjectOwner: "0x2" })).toBe("0x2")
    expect(mapOwnerToLabel({ Shared: {} })).toBe("Shared")
    expect(mapOwnerToLabel({ Immutable: true })).toBe("Immutable")
  })

  it("formats optional numbers", () => {
    expect(formatOptionalNumber("5")).toBe("5")
    expect(formatOptionalNumber(10)).toBe("10")
    expect(formatOptionalNumber(undefined)).toBe("Unknown")
  })

  it("counts unique object types", () => {
    const count = countUniqueObjectTypes([
      { objectId: "0x1", objectType: "Foo" },
      { objectId: "0x2", objectType: "foo" },
      { objectId: "0x3", objectType: "Bar" }
    ])

    expect(count).toBe(2)
  })

  it("builds log fields with defaults", () => {
    const fields = buildOwnedObjectLogFields({
      objectId: "0x1",
      objectType: undefined
    })

    expect(fields).toEqual({
      objectId: "0x1",
      objectType: "Unknown type",
      version: "Unknown",
      owner: "Unknown owner",
      transaction: "N/A"
    })
  })

  it("extracts content, display, and object id fields", () => {
    const response = {
      data: {
        objectId: normalizeSuiObjectId("0x2"),
        content: { dataType: "moveObject", fields: { name: "Item" } },
        display: { data: { label: "Label" } }
      }
    }

    expect(getResponseContentField(response as never, "name")).toBe("Item")
    expect(getResponseDisplayField(response as never, "label")).toBe("Label")
    expect(getResponseObjectId(response as never)).toBe(
      normalizeSuiObjectId("0x2")
    )
  })
})
