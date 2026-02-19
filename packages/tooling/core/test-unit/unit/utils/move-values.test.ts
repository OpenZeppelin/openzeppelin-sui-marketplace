import { describe, expect, it } from "vitest"
import {
  extractFieldValueByKeys,
  normalizeBigIntFromMoveValue,
  normalizeBooleanFromMoveValue,
  normalizeU64StringFromMoveValue,
  parseI64FromMoveValue,
  unwrapMoveFields,
  unwrapMoveOptionValue
} from "../../../src/utils/move-values.ts"

describe("move value helpers", () => {
  it("unwraps move fields from nested records", () => {
    expect(unwrapMoveFields({ fields: { value: 1 } })).toEqual({ value: 1 })
    expect(unwrapMoveFields({ value: 2 })).toEqual({ value: 2 })
    expect(unwrapMoveFields("nope")).toBeUndefined()
  })

  it("unwraps option-like values", () => {
    expect(unwrapMoveOptionValue({ fields: { some: 10 } })).toBe(10)
    expect(unwrapMoveOptionValue({ fields: { none: true } })).toBeUndefined()
  })

  it("extracts the first matching field by key list", () => {
    const container = { foo: 1, bar: 2 }
    expect(extractFieldValueByKeys(container, ["bar", "foo"])).toBe(2)
    expect(extractFieldValueByKeys(container, ["missing"])).toBeUndefined()
  })

  it("normalizes bigint values from move-like structures", () => {
    expect(normalizeBigIntFromMoveValue(10)).toBe(10n)
    expect(normalizeBigIntFromMoveValue("20")).toBe(20n)
    expect(normalizeBigIntFromMoveValue({ fields: { value: "30" } })).toBe(30n)
    expect(normalizeBigIntFromMoveValue({ fields: { none: true } })).toBe(
      undefined
    )
  })

  it("normalizes booleans from move-like structures", () => {
    expect(normalizeBooleanFromMoveValue(true)).toBe(true)
    expect(normalizeBooleanFromMoveValue("false")).toBe(false)
    expect(normalizeBooleanFromMoveValue({ fields: { value: "true" } })).toBe(
      true
    )
  })

  it("normalizes u64 strings from move-like values", () => {
    expect(normalizeU64StringFromMoveValue({ fields: { value: "77" } })).toBe(
      "77"
    )
    expect(normalizeU64StringFromMoveValue(-1)).toBeUndefined()
    expect(normalizeU64StringFromMoveValue(1n << 65n)).toBeUndefined()
  })

  it("parses i64 values from move-like structures", () => {
    const parsed = parseI64FromMoveValue({
      fields: { magnitude: "10", negative: "true" }
    })

    expect(parsed).toEqual({ magnitude: 10n, negative: true })
  })
})
