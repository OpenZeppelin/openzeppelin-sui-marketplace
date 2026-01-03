import { describe, expect, it } from "vitest"
import {
  buildCreatedObjectChange,
  buildMutatedObjectChange,
  buildTransactionEffects,
  buildTransactionResponse
} from "../helpers/sui.ts"
import {
  assertCreatedObject,
  assertTransactionSuccess,
  ensureCreatedObject,
  extractCreatedObjects,
  findCreatedObjectBySuffix,
  findCreatedObjectIds,
  summarizeGasUsed,
  summarizeObjectChanges
} from "../../src/transactions.ts"

describe("transactions helpers", () => {
  it("asserts transaction success and throws on failure", () => {
    expect(() =>
      assertTransactionSuccess(
        buildTransactionResponse({
          effects: buildTransactionEffects({ status: { status: "success" } })
        })
      )
    ).not.toThrow()

    expect(() =>
      assertTransactionSuccess(
        buildTransactionResponse({
          effects: buildTransactionEffects({
            status: { status: "failure", error: "failed" }
          })
        })
      )
    ).toThrow("failed")
  })

  it("finds created object ids by suffix", () => {
    const response = buildTransactionResponse({
      objectChanges: [
        buildCreatedObjectChange({
          objectType: "0x2::module::Foo",
          objectId: "0x1"
        }),
        buildCreatedObjectChange({
          objectType: "0x2::module::Bar",
          objectId: "0x2"
        })
      ]
    })

    expect(findCreatedObjectIds(response, "::Foo")).toEqual(["0x1"])
  })

  it("returns matching created objects and throws when missing", () => {
    const response = buildTransactionResponse({
      objectChanges: [
        buildCreatedObjectChange({
          objectType: "0x2::module::Foo",
          objectId: "0x1"
        })
      ]
    })

    const found = findCreatedObjectBySuffix(response, "::Foo")
    expect(assertCreatedObject(found, "Foo").objectId).toBe("0x1")

    expect(() => ensureCreatedObject("Bar", response)).toThrow(
      "Transaction succeeded but Bar was not found"
    )
  })

  it("extracts created objects and summarizes changes", () => {
    const response = buildTransactionResponse({
      objectChanges: [
        buildCreatedObjectChange({
          objectType: "0x2::module::Foo",
          objectId: "0x1"
        }),
        buildMutatedObjectChange({
          objectType: "0x2::module::Foo",
          objectId: "0x2"
        })
      ]
    })

    expect(extractCreatedObjects(response)).toHaveLength(1)

    const summary = summarizeObjectChanges(response.objectChanges)
    const createdSummary = summary.find((entry) => entry.label === "Created")

    expect(createdSummary?.count).toBe(1)
    expect(createdSummary?.types[0]?.label).toBe("Foo")
  })

  it("summarizes gas usage when effects are present", () => {
    const summary = summarizeGasUsed({
      computationCost: "10",
      nonRefundableStorageFee: "0",
      storageCost: "5",
      storageRebate: "3"
    })

    expect(summary).toEqual({
      computation: 10n,
      storage: 5n,
      rebate: 3n,
      total: 12n
    })
  })
})
