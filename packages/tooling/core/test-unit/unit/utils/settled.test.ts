import { describe, expect, it, vi } from "vitest"

import { mapSettledWithWarnings } from "../../../src/utils/settled.ts"

describe("settled helpers", () => {
  it("maps results and reports failures", async () => {
    const onError = vi.fn()
    const items = ["a", "b"]

    const results = await mapSettledWithWarnings({
      items,
      task: async (item) => {
        if (item === "b") throw new Error("fail")
        return item.toUpperCase()
      },
      onError
    })

    expect(results).toEqual(["A", undefined])
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toBe("b")
  })
})
