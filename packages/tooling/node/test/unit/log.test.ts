import { describe, expect, it, vi } from "vitest"
import { captureConsole } from "../../../test/helpers/console.ts"

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
})
