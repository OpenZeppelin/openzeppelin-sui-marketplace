import { describe, expect, it } from "vitest"
import {
  formatEpochSeconds,
  formatOptionalNumericValue,
  formatTimestamp,
  parseOptionalNumber,
  shortenId
} from "../../src/utils/formatters.ts"

describe("formatters edge cases", () => {
  it("parses optional numbers from strings", () => {
    expect(parseOptionalNumber("42")).toBe(42)
    expect(parseOptionalNumber("not-a-number")).toBeUndefined()
  })

  it("returns Unknown for invalid timestamps", () => {
    expect(formatEpochSeconds("not-a-number")).toBe("Unknown")
    expect(formatTimestamp("not-a-number")).toBe("Unknown")
    expect(formatTimestamp(null)).toBe("Unknown")
  })

  it("returns formatted strings for valid timestamps", () => {
    expect(formatEpochSeconds(1)).not.toBe("Unknown")
    expect(formatTimestamp(1)).not.toBe("Unknown")
  })

  it("formats optional numeric values safely", () => {
    expect(formatOptionalNumericValue(null)).toBeUndefined()
    expect(formatOptionalNumericValue(undefined)).toBeUndefined()
  })

  it("keeps short ids intact", () => {
    expect(shortenId("0x1234", 6, 4)).toBe("0x1234")
  })
})
