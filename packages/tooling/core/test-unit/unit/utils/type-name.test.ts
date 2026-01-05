import { normalizeSuiObjectId } from "@mysten/sui/utils"
import { describe, expect, it } from "vitest"
import {
  parseTypeNameFromString,
  normalizeTypeNameFromFieldValue,
  isMatchingTypeName,
  formatTypeName,
  extractStructNameFromType
} from "../../../src/utils/type-name.ts"

describe("type name helpers", () => {
  it("parses fully qualified type names", () => {
    const parsed = parseTypeNameFromString("0x2::sui::SUI")
    expect(parsed.packageId).toBe(normalizeSuiObjectId("0x2"))
    expect(parsed.moduleName).toBe("sui")
    expect(parsed.structName).toBe("SUI")
  })

  it("parses type names with generics", () => {
    const parsed = parseTypeNameFromString("0x2::coin::Coin<0x2::sui::SUI>")
    expect(parsed.moduleName).toBe("coin")
    expect(parsed.structName).toBe("Coin")
  })

  it("normalizes type names from field values", () => {
    const normalized = normalizeTypeNameFromFieldValue({
      package: "0x2",
      module: "sui",
      name: "SUI"
    })

    expect(normalized?.packageId).toBe(normalizeSuiObjectId("0x2"))
    expect(normalized?.moduleName).toBe("sui")
    expect(normalized?.structName).toBe("SUI")
  })

  it("matches expected type names", () => {
    const expected = parseTypeNameFromString("0x2::sui::SUI")
    expect(
      isMatchingTypeName(expected, {
        package: "0x2",
        module: "sui",
        name: "SUI"
      })
    ).toBe(true)
  })

  it("formats and extracts struct names", () => {
    const formatted = formatTypeName({
      packageId: normalizeSuiObjectId("0x2"),
      moduleName: "sui",
      structName: "SUI"
    })
    expect(formatted).toBe(`${normalizeSuiObjectId("0x2")}::sui::SUI`)
    expect(extractStructNameFromType(formatted)).toBe("SUI")
  })
})
