import { describe, expect, it } from "vitest"
import {
  parseBalance,
  parseNonNegativeU64,
  parseOptionalPositiveU64,
  parsePositiveU64,
  requireValue,
  tryParseBigInt
} from "../../../src/utils/utility.ts"

describe("utility helpers", () => {
  it("parses bigint values or throws with context", () => {
    expect(tryParseBigInt("10")).toBe(10n)
    expect(() => tryParseBigInt("nope")).toThrow("Invalid numeric value")
  })

  it("parses non-negative and positive u64 values", () => {
    expect(parseNonNegativeU64("0", "Amount")).toBe(0n)
    expect(parsePositiveU64("1", "Amount")).toBe(1n)
    expect(() => parseNonNegativeU64("-1", "Amount")).toThrow(
      "Amount cannot be negative."
    )
  })

  it("parses optional positive u64 values", () => {
    expect(parseOptionalPositiveU64(undefined, "Amount")).toBeUndefined()
    expect(parseOptionalPositiveU64("5", "Amount")).toBe(5n)
  })

  it("parses balances with safe fallback", () => {
    expect(parseBalance("10")).toBe(10n)
    expect(parseBalance(10)).toBe(10n)
    expect(parseBalance(10n)).toBe(10n)
    expect(parseBalance("nope")).toBe(0n)
  })

  it("requires values with explicit errors", () => {
    expect(requireValue("value", "missing")).toBe("value")
    expect(() => requireValue(undefined, "missing")).toThrow("missing")
  })
})
