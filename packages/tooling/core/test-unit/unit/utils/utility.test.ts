import { describe, expect, it } from "vitest"
import {
  parseBalance,
  parseNonNegativeU64,
  parseNonNegativeU16,
  parseOptionalPositiveU16,
  parseOptionalPositiveU64,
  parseOptionalU16,
  parseOptionalU64,
  parsePositiveU16,
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
    expect(() => parseNonNegativeU64("18446744073709551616", "Amount")).toThrow(
      "Amount exceeds the maximum allowed u64 value."
    )
  })

  it("parses optional u64 values", () => {
    expect(parseOptionalU64(undefined, "Amount")).toBeUndefined()
    expect(parseOptionalU64("7", "Amount")).toBe(7n)
  })

  it("parses optional positive u64 values", () => {
    expect(parseOptionalPositiveU64(undefined, "Amount")).toBeUndefined()
    expect(parseOptionalPositiveU64("5", "Amount")).toBe(5n)
  })

  it("parses non-negative and positive u16 values", () => {
    expect(parseNonNegativeU16("0", "Count")).toBe(0)
    expect(parsePositiveU16("1", "Count")).toBe(1)
    expect(() => parseNonNegativeU16("-1", "Count")).toThrow(
      "Count cannot be negative."
    )
    expect(() => parseNonNegativeU16("65536", "Count")).toThrow(
      "Count exceeds the maximum allowed u16 value."
    )
  })

  it("parses optional u16 values", () => {
    expect(parseOptionalU16(undefined, "Count")).toBeUndefined()
    expect(parseOptionalU16("42", "Count")).toBe(42)
  })

  it("parses optional positive u16 values", () => {
    expect(parseOptionalPositiveU16(undefined, "Count")).toBeUndefined()
    expect(parseOptionalPositiveU16("9", "Count")).toBe(9)
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
