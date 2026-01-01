import { describe, expect, it } from "vitest"
import {
  extractSingleSuiFrameworkRevisionFromMoveLock,
  extractSuiFrameworkPinnedEntriesFromMoveLock,
  extractSuiFrameworkRevisionsFromMoveLock
} from "../../src/move-lock.ts"
import { readFixture } from "../../../test/helpers/fs.ts"

describe("extractSuiFrameworkRevisionsFromMoveLock", () => {
  it("extracts revisions from pinned Move.lock", async () => {
    const lockContents = await readFixture("move", "Move.lock.pinned")
    const revisions = extractSuiFrameworkRevisionsFromMoveLock({
      lockContents
    })

    expect([...revisions].sort()).toEqual(["1111111", "2222222", "3333333"])
  })

  it("filters pinned revisions by environment", async () => {
    const lockContents = await readFixture("move", "Move.lock.pinned")
    const revisions = extractSuiFrameworkRevisionsFromMoveLock({
      lockContents,
      environmentName: "testnet"
    })

    expect([...revisions].sort()).toEqual(["2222222", "3333333"])
  })

  it("extracts revisions from legacy Move.lock", async () => {
    const lockContents = await readFixture("move", "Move.lock.legacy")
    const revisions = extractSuiFrameworkRevisionsFromMoveLock({
      lockContents
    })

    expect([...revisions].sort()).toEqual(["aaaa", "bbbb"])
  })

  it("returns empty set for unknown format", () => {
    const revisions = extractSuiFrameworkRevisionsFromMoveLock({
      lockContents: "not a lock file"
    })

    expect([...revisions]).toEqual([])
  })
})

describe("extractSuiFrameworkPinnedEntriesFromMoveLock", () => {
  it("returns pinned entry metadata for environment", async () => {
    const lockContents = await readFixture("move", "Move.lock.pinned")
    const entries = extractSuiFrameworkPinnedEntriesFromMoveLock({
      lockContents,
      environmentName: "testnet"
    })

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          environmentName: "testnet",
          packageName: "Sui_1",
          revision: "2222222"
        }),
        expect.objectContaining({
          environmentName: "testnet",
          packageName: "MoveStdlib_1",
          revision: "3333333"
        })
      ])
    )
  })
})

describe("extractSingleSuiFrameworkRevisionFromMoveLock", () => {
  it("returns one revision from legacy locks", async () => {
    const lockContents = await readFixture("move", "Move.lock.legacy")
    const revision = extractSingleSuiFrameworkRevisionFromMoveLock({
      lockContents
    })

    expect(["aaaa", "bbbb"]).toContain(revision)
  })
})
