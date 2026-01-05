import { describe, expect, it } from "vitest"
import {
  asNumberArray,
  decodeUtf8Vector,
  readMoveString,
  formatVectorBytesAsHex,
  formatOptionalNumericValue,
  formatCoinBalance,
  shortenId
} from "../../../src/utils/formatters.ts"

describe("formatters", () => {
  it("parses vector<u8> into number arrays", () => {
    expect(asNumberArray([1, 2, 3])).toEqual([1, 2, 3])
    expect(() => asNumberArray([1, "x"] as unknown as number[])).toThrow(
      "Expected vector<u8> to be an array of numbers."
    )
  })

  it("decodes utf8 vectors", () => {
    expect(decodeUtf8Vector([104, 101, 108, 108, 111])).toBe("hello")
  })

  it("reads Move strings from base64 bytes", () => {
    const bytes = Buffer.from("hello").toString("base64")
    expect(readMoveString({ fields: { bytes } })).toBe("hello")
  })

  it("formats vector bytes as hex", () => {
    expect(formatVectorBytesAsHex([1, 255])).toBe("0x01ff")
  })

  it("formats numeric values for display", () => {
    expect(formatOptionalNumericValue(42)).toBe("42")
    expect(formatOptionalNumericValue(42n)).toBe("42")
    expect(formatOptionalNumericValue("42")).toBe("42")
  })

  it("formats coin balances with decimals", () => {
    expect(formatCoinBalance({ balance: 1_000_000_000n, decimals: 9 })).toBe(
      "1"
    )
    expect(formatCoinBalance({ balance: 1_000_500_000n, decimals: 9 })).toBe(
      "1.0005"
    )
  })

  it("shortens ids for display", () => {
    expect(shortenId("0x1234567890", 4, 2)).toBe("0x12...90")
  })
})
