import { describe, expect, it, vi } from "vitest"
import { createSuiClientMock } from "../../../tests-integration/helpers/sui.ts"
import { getClockTimestampMs } from "../../src/clock.ts"

const buildClockObject = (timestamp: number | string | bigint) => ({
  objectId: "0x6",
  content: {
    dataType: "moveObject",
    fields: {
      timestamp_ms: timestamp
    }
  }
})

describe("getClockTimestampMs", () => {
  it("returns numeric timestamps", async () => {
    const { client } = createSuiClientMock({
      getObject: vi.fn().mockResolvedValue({
        data: buildClockObject(1234)
      })
    })

    await expect(getClockTimestampMs({}, { suiClient: client })).resolves.toBe(
      1234
    )
  })

  it("returns bigint timestamps as numbers when finite", async () => {
    const { client } = createSuiClientMock({
      getObject: vi.fn().mockResolvedValue({
        data: buildClockObject(9007199254740991n)
      })
    })

    await expect(getClockTimestampMs({}, { suiClient: client })).resolves.toBe(
      9007199254740991
    )
  })

  it("returns numeric strings parsed from timestamps", async () => {
    const { client } = createSuiClientMock({
      getObject: vi.fn().mockResolvedValue({
        data: buildClockObject("4567")
      })
    })

    await expect(getClockTimestampMs({}, { suiClient: client })).resolves.toBe(
      4567
    )
  })

  it("returns undefined for non-numeric timestamps", async () => {
    const { client } = createSuiClientMock({
      getObject: vi.fn().mockResolvedValue({
        data: buildClockObject("not-a-number")
      })
    })

    await expect(
      getClockTimestampMs({}, { suiClient: client })
    ).resolves.toBeUndefined()
  })

  it("returns undefined when the clock object is missing", async () => {
    const { client } = createSuiClientMock({
      getObject: vi.fn().mockResolvedValue({ data: undefined })
    })

    await expect(
      getClockTimestampMs({}, { suiClient: client })
    ).resolves.toBeUndefined()
  })

  it("returns undefined on client errors", async () => {
    const { client } = createSuiClientMock({
      getObject: vi.fn().mockRejectedValue(new Error("rpc failed"))
    })

    await expect(
      getClockTimestampMs({}, { suiClient: client })
    ).resolves.toBeUndefined()
  })
})
