import { describe, expect, it, vi } from "vitest"

const { createTestContext, withTestContext, createLocalnetHarness } =
  vi.hoisted(() => ({
    createTestContext: vi.fn(),
    withTestContext: vi.fn(),
    createLocalnetHarness: vi.fn()
  }))

const buildHarness = () => ({
  start: vi.fn(),
  stop: vi.fn(),
  get: vi.fn(() => ({ rpcUrl: "http://localhost:9000" }))
})

vi.mock("../../src/testing/localnet.ts", () => ({
  createLocalnetHarness,
  createTestContext,
  withTestContext
}))

import { createSuiLocalnetTestEnv } from "../../src/testing/env.ts"

describe("testing env helpers", () => {
  it("creates suite-scoped contexts", async () => {
    const harness = buildHarness()
    createLocalnetHarness.mockReturnValueOnce(harness)
    createTestContext.mockResolvedValue({ testId: "suite--case" })

    const env = createSuiLocalnetTestEnv({ mode: "suite" })
    await env.startSuite("suite")
    const context = await env.createTestContext("case")

    expect(harness.start).toHaveBeenCalled()
    expect(createTestContext).toHaveBeenCalledWith(harness.get(), "suite--case")
    expect(context).toEqual({ testId: "suite--case" })

    await env.stopSuite()
    expect(harness.stop).toHaveBeenCalled()
  })

  it("runs suite actions with shared localnet", async () => {
    const harness = buildHarness()
    createLocalnetHarness.mockReturnValueOnce(harness)
    withTestContext.mockImplementation(async (_instance, _id, action) =>
      action({ testId: "suite--case" })
    )

    const env = createSuiLocalnetTestEnv({ mode: "suite" })
    await env.startSuite("suite")
    const result = await env.withTestContext("case", async () => "ok")

    expect(result).toBe("ok")
    expect(withTestContext).toHaveBeenCalledWith(
      harness.get(),
      "suite--case",
      expect.any(Function)
    )
  })

  it("creates isolated test contexts", async () => {
    const harness = buildHarness()
    const cleanup = vi.fn()
    createLocalnetHarness.mockReturnValueOnce(harness)
    createTestContext.mockResolvedValue({ testId: "case", cleanup })

    const env = createSuiLocalnetTestEnv({ mode: "test" })
    const context = await env.createTestContext("case")

    expect(harness.start).toHaveBeenCalled()
    await context.cleanup()
    expect(cleanup).toHaveBeenCalled()
    expect(harness.stop).toHaveBeenCalled()
  })

  it("runs actions with isolated contexts", async () => {
    const harness = buildHarness()
    const cleanup = vi.fn()
    createLocalnetHarness.mockReturnValueOnce(harness)
    createTestContext.mockResolvedValue({ testId: "case", cleanup })

    const env = createSuiLocalnetTestEnv({ mode: "test" })
    const result = await env.withTestContext("case", async (context) => {
      expect(context.testId).toBe("case")
      return "ok"
    })

    expect(result).toBe("ok")
    expect(harness.stop).toHaveBeenCalled()
  })
})
