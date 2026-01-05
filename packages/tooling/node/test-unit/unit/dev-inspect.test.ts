import { describe, expect, it, vi } from "vitest"
import { captureConsole } from "@sui-oracle-market/tooling-node/testing/observability"

vi.mock("chalk", () => {
  const identity = (value: unknown) => String(value)
  return {
    default: new Proxy(
      { gray: identity },
      {
        get: () => identity
      }
    )
  }
})

import { maybeLogDevInspect } from "../../src/dev-inspect.ts"

describe("dev-inspect helper", () => {
  it("skips dev-inspect when disabled", async () => {
    const devInspectTransactionBlock = vi.fn()
    const toolingContext = {
      suiClient: { devInspectTransactionBlock },
      suiConfig: { network: { account: { accountAddress: "0x1" } } }
    } as never

    await maybeLogDevInspect(
      {
        transaction: {} as never,
        enabled: false
      },
      toolingContext
    )

    expect(devInspectTransactionBlock).not.toHaveBeenCalled()
  })

  it("logs dev-inspect output when enabled", async () => {
    const devInspectTransactionBlock = vi.fn().mockResolvedValue({
      effects: { status: { error: "boom" } },
      results: [{ ok: true }]
    })
    const toolingContext = {
      suiClient: { devInspectTransactionBlock },
      suiConfig: { network: { account: { accountAddress: "0x1" } } }
    } as never

    const consoleCapture = captureConsole()

    await maybeLogDevInspect(
      {
        transaction: {} as never,
        enabled: true
      },
      toolingContext
    )

    expect(devInspectTransactionBlock).toHaveBeenCalled()
    const logged = consoleCapture.records.log
      .map((entry) => entry.join(" "))
      .join(" ")
    expect(logged).toContain("boom")
    consoleCapture.restore()
  })
})
