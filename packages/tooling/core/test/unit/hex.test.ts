import { describe, expect, it } from "vitest"
import {
  assertBytesLength,
  ensureHexPrefix,
  hexToBytes,
  normalizeHex
} from "../../src/hex.ts"

describe("hex helpers", () => {
  it("ensures a hex prefix", () => {
    expect(ensureHexPrefix("abcd")).toBe("0xabcd")
    expect(ensureHexPrefix("0xabcd")).toBe("0xabcd")
  })

  it("normalizes hex strings", () => {
    expect(normalizeHex("0xABcd")).toBe("abcd")
    expect(normalizeHex("abcd")).toBe("abcd")
  })

  it("converts hex to bytes", () => {
    expect(hexToBytes("0x00ff")).toEqual([0, 255])
  })

  it("throws on odd-length hex strings", () => {
    expect(() => hexToBytes("0xabc")).toThrow(
      "Hex string must have even length."
    )
  })

  it("asserts byte lengths", () => {
    expect(assertBytesLength([0, 1], 2)).toEqual([0, 1])
    expect(() => assertBytesLength([0], 2)).toThrow("Expected 2 bytes, got 1.")
  })
})
