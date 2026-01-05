import { describe, expect, it } from "vitest"
import { captureConsole } from "@sui-oracle-market/tooling-node/testing/observability"

import { withMutedConsole } from "../../src/console.ts"

describe("console helpers", () => {
  it("suppresses console output within the action", async () => {
    const consoleCapture = captureConsole()

    const result = await withMutedConsole(async () => {
      console.log("hidden")
      console.warn("hidden")
      return "ok"
    })

    expect(result).toBe("ok")
    expect(consoleCapture.records.log.length).toBe(0)
    expect(consoleCapture.records.warn.length).toBe(0)
    consoleCapture.restore()
  })
})
