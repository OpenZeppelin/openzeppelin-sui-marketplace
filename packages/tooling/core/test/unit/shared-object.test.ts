import { describe, expect, it, vi } from "vitest"
import {
  buildSuiObjectData,
  createSuiClientMock
} from "../../../test/helpers/sui.ts"
import {
  extractInitialSharedVersion,
  getSuiSharedObject
} from "../../src/shared-object.ts"

describe("extractInitialSharedVersion", () => {
  it("returns the shared version from shared owners", () => {
    const version = extractInitialSharedVersion({
      owner: { Shared: { initial_shared_version: "7" } }
    } as never)

    expect(version).toBe("7")
  })

  it("returns the shared version from initialSharedVersion fields", () => {
    const version = extractInitialSharedVersion({
      initialSharedVersion: "11"
    } as never)

    expect(version).toBe("11")
  })

  it("returns undefined when no shared metadata exists", () => {
    const version = extractInitialSharedVersion({
      owner: { AddressOwner: "0x1" }
    } as never)

    expect(version).toBeUndefined()
  })
})

describe("getSuiSharedObject", () => {
  it("returns shared references with normalized versions", async () => {
    const { client } = createSuiClientMock({
      getObject: vi.fn().mockResolvedValue({
        data: buildSuiObjectData({
          objectId: "0x1",
          owner: { Shared: { initial_shared_version: "9" } }
        })
      })
    })

    const result = await getSuiSharedObject(
      { objectId: "0x1", mutable: true },
      { suiClient: client }
    )

    expect(result.sharedRef).toEqual({
      objectId: "0x1",
      mutable: true,
      initialSharedVersion: "9"
    })
  })

  it("throws when the object is not shared", async () => {
    const { client } = createSuiClientMock({
      getObject: vi.fn().mockResolvedValue({
        data: buildSuiObjectData({
          objectId: "0x2",
          owner: { AddressOwner: "0x3" }
        })
      })
    })

    await expect(
      getSuiSharedObject({ objectId: "0x2" }, { suiClient: client })
    ).rejects.toThrow("Object 0x2 is not shared or missing metadata")
  })

  it("throws when shared metadata lacks an initial version", async () => {
    const { client } = createSuiClientMock({
      getObject: vi.fn().mockResolvedValue({
        data: buildSuiObjectData({
          objectId: "0x4",
          owner: { Shared: { initial_shared_version: "" } }
        })
      })
    })

    await expect(
      getSuiSharedObject({ objectId: "0x4" }, { suiClient: client })
    ).rejects.toThrow("Shared object 0x4 missing initial shared version.")
  })
})
