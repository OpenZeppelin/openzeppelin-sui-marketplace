import { describe, expect, it, vi } from "vitest"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import { captureConsole } from "../../../tests-integration/helpers/console.ts"

vi.mock("chalk", () => {
  const identity = (value: unknown) => String(value)
  return {
    default: new Proxy(
      { gray: identity },
      {
        get: (_target, _prop) => identity
      }
    )
  }
})
import {
  buildObjectInformation,
  logInspectionContext,
  logObjectInformation,
  normalizeTargetObjectId
} from "../../src/describe-object.ts"

describe("describe-object helpers", () => {
  it("normalizes target object ids", () => {
    expect(normalizeTargetObjectId("0x2")).toBe(normalizeSuiObjectId("0x2"))
  })

  it("builds object information with content summaries", () => {
    const objectInformation = buildObjectInformation({
      object: {
        objectId: "0x1",
        version: "7",
        digest: "digest",
        owner: { AddressOwner: "0x2" },
        type: "0x2::module::Struct",
        content: {
          dataType: "moveObject",
          type: "0x2::module::Struct",
          hasPublicTransfer: true,
          fields: { name: "example" }
        }
      } as never
    })

    expect(objectInformation.objectId).toBe("0x1")
    expect(objectInformation.ownerLabel).toBe("0x2")
    expect(objectInformation.hasPublicTransfer).toBe(true)
    expect(objectInformation.contentSummary?.dataType).toBe("moveObject")
  })

  it("builds object information with package, display, bcs, and errors", () => {
    const longBcsBytes = "a".repeat(130)
    const objectInformation = buildObjectInformation({
      object: {
        objectId: "0x1",
        version: "5",
        digest: "digest",
        owner: { AddressOwner: "0x3" },
        type: "0x3::module::Struct",
        storageRebate: "100",
        previousTransaction: "0xabc",
        content: {
          dataType: "package",
          disassembled: { moduleA: "content" }
        },
        display: {
          data: {
            name: "Example",
            count: 10
          }
        },
        bcs: {
          dataType: "moveObject",
          type: "0x3::module::Struct",
          bcsBytes: longBcsBytes
        }
      } as never,
      error: { code: "NOT_FOUND", error: "Missing object" } as never
    })

    const contentSummary = objectInformation.contentSummary
    expect(contentSummary?.dataType).toBe("package")
    if (contentSummary?.dataType === "package") {
      expect(contentSummary.moduleNames).toEqual(["moduleA"])
    }
    expect(objectInformation.displayData).toEqual({ name: "Example" })
    expect(objectInformation.bcsSummary?.bytesLength).toBe(longBcsBytes.length)
    expect(objectInformation.bcsSummary?.bytesPreview?.endsWith("...")).toBe(
      true
    )
    expect(objectInformation.errorMessage).toBe("NOT_FOUND - Missing object")
  })

  it("logs inspection context and object information", () => {
    const consoleCapture = captureConsole()

    logInspectionContext({
      objectId: "0x1",
      rpcUrl: "http://localhost:9000",
      networkName: "localnet"
    })

    logObjectInformation({
      objectId: "0x1",
      objectType: "0x2::module::Struct",
      version: "1",
      ownerLabel: "0x2",
      contentSummary: {
        dataType: "package",
        moduleNames: ["module"]
      }
    })

    expect(consoleCapture.records.log.length).toBeGreaterThan(0)
    consoleCapture.restore()
  })

  it("logs warnings when object details are missing", () => {
    const consoleCapture = captureConsole()

    logObjectInformation({
      objectId: "0x2",
      version: "1"
    })

    const logged = consoleCapture.records.log
      .map((entry) => entry.join(" "))
      .join(" ")
    expect(logged).toContain("No content returned for this object.")
    expect(logged).toContain("No display data available.")
    expect(logged).toContain("No BCS bytes available.")
    consoleCapture.restore()
  })
})
