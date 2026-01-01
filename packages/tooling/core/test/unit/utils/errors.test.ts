import { describe, expect, it } from "vitest"
import {
  extractErrorDetails,
  formatErrorMessage,
  safeJsonStringify,
  serializeForJson
} from "../../../src/utils/errors.ts"

describe("error helpers", () => {
  it("stringifies bigints safely", () => {
    expect(safeJsonStringify({ amount: 10n })).toBe('{"amount":"10"}')
  })

  it("serializes cyclic values", () => {
    const value: Record<string, unknown> = {}
    value.self = value

    expect(serializeForJson(value)).toEqual(
      expect.objectContaining({ self: "[Circular]" })
    )
  })

  it("extracts error details from Error instances", () => {
    const error = new Error("bad")
    const details = extractErrorDetails(error)

    expect(details.message).toBe("bad")
    expect(details.name).toBe("Error")
  })

  it("formats error messages consistently", () => {
    expect(formatErrorMessage("boom")).toBe("boom")
    expect(formatErrorMessage({ message: "message" })).toBe("message")
    expect(formatErrorMessage({ name: "NameError" })).toBe("NameError")
  })
})
