import { beforeEach, describe, expect, it, vi } from "vitest"

const { getSuiSharedObject } = vi.hoisted(() => ({
  getSuiSharedObject: vi.fn()
}))

vi.mock("@sui-oracle-market/tooling-core/shared-object", () => ({
  getSuiSharedObject
}))

import {
  getImmutableSharedObject,
  getMutableSharedObject
} from "../../src/shared-objects.ts"

describe("shared object helpers", () => {
  beforeEach(() => {
    getSuiSharedObject.mockReset()
  })

  it("requests mutable shared objects", async () => {
    getSuiSharedObject.mockResolvedValue({ ok: true })
    const toolingContext = { suiClient: {}, suiConfig: {} } as never

    await getMutableSharedObject({ objectId: "0x1" }, toolingContext)

    expect(getSuiSharedObject).toHaveBeenCalledWith(
      {
        objectId: "0x1",
        mutable: true
      },
      toolingContext
    )
  })

  it("requests immutable shared objects", async () => {
    getSuiSharedObject.mockResolvedValue({ ok: true })
    const toolingContext = { suiClient: {}, suiConfig: {} } as never

    await getImmutableSharedObject({ objectId: "0x2" }, toolingContext)

    expect(getSuiSharedObject).toHaveBeenCalledWith(
      {
        objectId: "0x2",
        mutable: false
      },
      toolingContext
    )
  })
})
