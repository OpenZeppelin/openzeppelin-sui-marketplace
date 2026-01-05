import { describe, expect, it, vi } from "vitest"

import { waitForObjectState } from "../../src/testing/objects.ts"

describe("testing object helpers", () => {
  it("returns the object when predicate matches", async () => {
    const getObject = vi.fn().mockResolvedValue({
      data: { objectId: "0x1" }
    })

    const response = await waitForObjectState({
      suiClient: { getObject } as never,
      objectId: "0x1",
      predicate: (candidate) => Boolean(candidate.data),
      timeoutMs: 0
    })

    expect(response.data?.objectId).toBe("0x1")
    expect(getObject).toHaveBeenCalledTimes(1)
  })

  it("throws after timeout when predicate never matches", async () => {
    const getObject = vi.fn().mockResolvedValue({
      data: undefined,
      error: { message: "not found" }
    })

    await expect(
      waitForObjectState({
        suiClient: { getObject } as never,
        objectId: "0xdead",
        predicate: (candidate) => Boolean(candidate.data),
        timeoutMs: 0,
        intervalMs: 0
      })
    ).rejects.toThrow("Timed out waiting for object 0xdead")
  })
})
