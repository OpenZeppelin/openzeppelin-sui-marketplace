import { describe, expect, it, vi } from "vitest"

import { isStaleObjectVersionError } from "../../../src/transactions.ts"
import { retryWithDelay } from "../../../src/utils/retry.ts"

describe("retry helpers", () => {
  it("detects stale object version errors", () => {
    expect(
      isStaleObjectVersionError(
        new Error("Object not available for consumption; current version")
      )
    ).toBe(true)
    expect(isStaleObjectVersionError(new Error("Something else"))).toBe(false)
  })

  it("retries until the action succeeds", async () => {
    const action = vi
      .fn()
      .mockRejectedValueOnce(new Error("nope"))
      .mockRejectedValueOnce(new Error("still nope"))
      .mockResolvedValue("ok")

    const result = await retryWithDelay({
      action,
      shouldRetry: () => true,
      maxAttempts: 3,
      delayMs: 0
    })

    expect(result).toBe("ok")
    expect(action).toHaveBeenCalledTimes(3)
  })

  it("surfaces errors when retry conditions fail", async () => {
    const action = vi.fn().mockRejectedValue(new Error("fatal"))

    await expect(
      retryWithDelay({
        action,
        shouldRetry: () => false,
        maxAttempts: 2,
        delayMs: 0
      })
    ).rejects.toThrow("fatal")
  })

  it("requires at least one attempt", async () => {
    await expect(
      retryWithDelay({
        action: async () => "ok",
        shouldRetry: () => false,
        maxAttempts: 0,
        delayMs: 0
      })
    ).rejects.toThrow("maxAttempts")
  })
})
