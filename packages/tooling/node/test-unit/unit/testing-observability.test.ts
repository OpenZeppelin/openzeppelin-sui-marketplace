import { describe, expect, it } from "vitest"

import {
  captureConsole,
  withCapturedConsole
} from "../../src/testing/observability.ts"

describe("testing observability helpers", () => {
  it("captures console output", () => {
    const consoleCapture = captureConsole(["log"])

    console.log("hello")

    expect(consoleCapture.records.log.length).toBe(1)
    consoleCapture.restore()
  })

  it("captures console output with helper wrapper", async () => {
    const { result, records } = await withCapturedConsole(async () => {
      console.log("wrapped")
      return "ok"
    })

    expect(result).toBe("ok")
    expect(records.log.length).toBe(1)
  })
})
