import { describe, expect, it } from "vitest"
import { mergeDeepObjects } from "../../src/utils/utility.ts"

describe("mergeDeepObjects", () => {
  it("ignores prototype-pollution keys while merging", () => {
    const malicious = JSON.parse(
      '{"__proto__":{"polluted":"yes"},"safe":2}'
    ) as Record<string, unknown>

    const result = mergeDeepObjects({ safe: 1 }, malicious)

    expect(result).toEqual({ safe: 2 })
    expect((Object.prototype as { polluted?: string }).polluted).toBeUndefined()
  })
})
