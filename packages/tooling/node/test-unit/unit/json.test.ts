import { describe, expect, it } from "vitest"
import { captureConsole } from "@sui-oracle-market/tooling-node/testing/observability"

import { emitJsonOutput } from "../../src/json.ts"

describe("json helpers", () => {
  it("skips output when disabled", () => {
    const consoleCapture = captureConsole()

    const wrote = emitJsonOutput({ ok: true }, false)

    expect(wrote).toBe(false)
    expect(consoleCapture.records.log.length).toBe(0)
    consoleCapture.restore()
  })

  it("prints JSON when enabled", () => {
    const consoleCapture = captureConsole()

    const wrote = emitJsonOutput({ ok: true }, true)

    expect(wrote).toBe(true)
    const logged = consoleCapture.records.log
      .map((entry) => entry.join(" "))
      .join(" ")
    expect(logged).toContain('"ok": true')
    consoleCapture.restore()
  })
})
