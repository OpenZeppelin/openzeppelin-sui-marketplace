import { describe, expect, it } from "vitest"
import {
  validateMoveType,
  validateRequiredSuiObjectId,
  validateOptionalSuiAddress,
  validateRequiredHexBytes
} from "../../../src/utils/validation.ts"

describe("validation helpers", () => {
  it("validates move types", () => {
    expect(validateMoveType("", "Type")).toBe("Type is required.")
    expect(validateMoveType("0x2::sui::SUI", "Type")).toBeUndefined()
  })

  it("validates required object ids", () => {
    expect(validateRequiredSuiObjectId("", "Object")).toBe(
      "Object is required."
    )
    expect(validateRequiredSuiObjectId("0x2", "Object")).toBeUndefined()
  })

  it("validates optional addresses", () => {
    expect(validateOptionalSuiAddress("", "Owner")).toBeUndefined()
    expect(validateOptionalSuiAddress("0x2", "Owner")).toBeUndefined()
  })

  it("validates required hex byte lengths", () => {
    expect(
      validateRequiredHexBytes({
        value: "0x1234",
        expectedBytes: 2,
        label: "Hash"
      })
    ).toBeUndefined()

    expect(
      validateRequiredHexBytes({
        value: "0x12",
        expectedBytes: 2,
        label: "Hash"
      })
    ).toBe("Hash must be 2 bytes (4 hex chars).")
  })
})
