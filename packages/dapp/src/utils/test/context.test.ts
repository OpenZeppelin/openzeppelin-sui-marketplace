import { captureConsole } from "@sui-oracle-market/tooling-node/testing/observability"
import { describe, expect, it, vi } from "vitest"

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

import {
  logListContext,
  logListContextWithHeader,
  logScriptContext
} from "../context.ts"

describe("context helpers", () => {
  it("logs script context entries", () => {
    const consoleCapture = captureConsole()

    logScriptContext([
      { label: "Network", value: "localnet" },
      { label: "RPC", value: "http://localhost:9000" },
      { label: "Skip", value: undefined }
    ])

    const logged = consoleCapture.records.log
      .map((entry) => entry.join(" "))
      .join(" ")
    expect(logged).toContain("Network")
    expect(logged).toContain("localnet")
    expect(logged).toContain("RPC")
    consoleCapture.restore()
  })

  it("logs list context with custom shop label", () => {
    const consoleCapture = captureConsole()

    logListContext({
      networkName: "testnet",
      rpcUrl: "http://rpc",
      ownerAddress: "0x1",
      packageId: "0x2",
      shopId: "0x3",
      shopLabel: "Shop-filter"
    })

    const logged = consoleCapture.records.log
      .map((entry) => entry.join(" "))
      .join(" ")
    expect(logged).toContain("Shop-filter")
    expect(logged).toContain("0x3")
    consoleCapture.restore()
  })

  it("logs list context with a header", () => {
    const consoleCapture = captureConsole()

    logListContextWithHeader(
      {
        networkName: "localnet",
        rpcUrl: "http://rpc",
        shopId: "0x1"
      },
      { label: "Item-listings", count: 2 }
    )

    const logged = consoleCapture.records.log
      .map((entry) => entry.join(" "))
      .join(" ")
    expect(logged).toContain("Item-listings")
    expect(logged).toContain("Count")
    consoleCapture.restore()
  })
})
