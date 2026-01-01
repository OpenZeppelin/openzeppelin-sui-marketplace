import { describe, expect, it } from "vitest"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import { captureConsole } from "../../../test/helpers/console.ts"
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
})
