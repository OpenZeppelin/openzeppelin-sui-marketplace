import { describe, expect, it, vi } from "vitest"
import { captureConsole } from "@sui-oracle-market/tooling-node/testing/observability"

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
  logEachBlue,
  logKeyValueBlue,
  logSimpleBlue,
  logStructuredJson,
  toKebabCase
} from "../../src/log.ts"

describe("log helpers", () => {
  it("converts camelCase to kebab-case", () => {
    expect(toKebabCase("camelCaseValue")).toBe("camel-case-value")
  })

  it("logs key/value pairs", () => {
    const consoleCapture = captureConsole()

    logKeyValueBlue("Network")("localnet")
    logSimpleBlue("Header")

    expect(consoleCapture.records.log.length).toBeGreaterThan(0)
    consoleCapture.restore()
  })

  it("logs entries in kebab-case", () => {
    const consoleCapture = captureConsole()

    logEachBlue({
      networkName: "localnet",
      gasBudget: 10
    })

    const logged = consoleCapture.records.log
      .map((entry) => entry.join(" "))
      .join(" ")
    expect(logged).toContain("network-name")
    expect(logged).toContain("gas-budget")
    consoleCapture.restore()
  })

  it("logs structured json output", () => {
    const consoleCapture = captureConsole()

    logStructuredJson("Fields", { name: "example" })

    const logged = consoleCapture.records.log
      .map((entry) => entry.join(" "))
      .join(" ")
    expect(logged).toContain("Fields:")
    expect(logged).toContain('"name": "example"')
    consoleCapture.restore()
  })

  it("logs an empty structured json message", () => {
    const consoleCapture = captureConsole()

    logStructuredJson("Fields", {})

    const logged = consoleCapture.records.log
      .map((entry) => entry.join(" "))
      .join(" ")
    expect(logged).toContain("No fields present.")
    consoleCapture.restore()
  })
})
