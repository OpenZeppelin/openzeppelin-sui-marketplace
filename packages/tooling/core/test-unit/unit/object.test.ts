import { describe, expect, it, vi } from "vitest"
import { normalizeSuiAddress, normalizeSuiObjectId } from "@mysten/sui/utils"
import {
  createSuiClientMock,
  buildSuiObjectResponse
} from "../../../tests-integration/helpers/sui.ts"
import {
  deriveRelevantPackageId,
  extractOwnerAddress,
  getAllOwnedObjectsByFilter,
  getObjectSafe,
  mapOwnerToArtifact,
  normalizeObjectArtifact,
  normalizeOptionalIdFromValue,
  normalizeOwner,
  objectTypeMatches,
  unwrapMoveObjectFields
} from "../../src/object.ts"

describe("object helpers", () => {
  it("maps owner structures into artifacts", () => {
    expect(mapOwnerToArtifact({ AddressOwner: "0x2" })).toEqual({
      ownerType: "address",
      address: normalizeSuiAddress("0x2")
    })

    expect(mapOwnerToArtifact({ ObjectOwner: "0x3" })).toEqual({
      ownerType: "object",
      objectId: normalizeSuiObjectId("0x3")
    })

    expect(
      mapOwnerToArtifact({ Shared: { initial_shared_version: "5" } })
    ).toEqual({
      ownerType: "shared",
      initialSharedVersion: "5"
    })

    expect(
      mapOwnerToArtifact({
        ConsensusAddressOwner: { owner: "0x4", start_version: "1" }
      })
    ).toEqual({
      ownerType: "consensus-address",
      address: normalizeSuiAddress("0x4")
    })
  })

  it("normalizes owner fields for persistence", () => {
    const normalized = normalizeOwner({
      ownerType: "address",
      address: "0x2"
    })

    expect(normalized).toEqual({
      ownerType: "address",
      address: "0x2",
      ownerAddress: normalizeSuiAddress("0x2")
    })
  })

  it("normalizes full object artifacts", () => {
    const artifact = normalizeObjectArtifact({
      packageId: "0x2",
      signer: "0x3",
      objectId: "0x4",
      objectType: "0x2::module::Struct",
      owner: {
        ownerType: "object",
        objectId: "0x5"
      },
      initialSharedVersion: "12",
      version: "7"
    })

    expect(artifact.objectId).toBe(normalizeSuiObjectId("0x4"))
    expect(artifact.owner).toEqual({
      ownerType: "object",
      objectId: normalizeSuiObjectId("0x5")
    })
    expect(artifact.initialSharedVersion).toBe("12")
    expect(artifact.version).toBe("7")
  })

  it("extracts object ids from Move-like values", () => {
    expect(normalizeOptionalIdFromValue("0x2")).toBe(
      normalizeSuiObjectId("0x2")
    )
    expect(normalizeOptionalIdFromValue({ fields: { id: "0x3" } })).toBe(
      normalizeSuiObjectId("0x3")
    )
    expect(normalizeOptionalIdFromValue({ some: { id: "0x4" } })).toBe(
      normalizeSuiObjectId("0x4")
    )
    expect(normalizeOptionalIdFromValue({ none: null })).toBeUndefined()
  })

  it("unwraps Move object fields", () => {
    const fields = unwrapMoveObjectFields({
      objectId: "0x1",
      content: {
        dataType: "moveObject",
        fields: { value: { fields: { name: "example" } } }
      }
    } as never)

    expect(fields).toEqual({ name: "example" })
  })

  it("derives the relevant package id from type strings", () => {
    expect(deriveRelevantPackageId("0x2::module::Struct")).toBe(
      normalizeSuiObjectId("0x2")
    )
  })

  it("paginates owned objects and filters empty entries", async () => {
    const { client } = createSuiClientMock({
      getOwnedObjects: vi
        .fn()
        .mockResolvedValueOnce({
          data: [{ data: { objectId: "0x1" } }, { data: null }],
          hasNextPage: true,
          nextCursor: "cursor"
        })
        .mockResolvedValueOnce({
          data: [{ data: { objectId: "0x2" } }],
          hasNextPage: false,
          nextCursor: null
        })
    })

    const objects = await getAllOwnedObjectsByFilter(
      {
        ownerAddress: "0x1"
      },
      { suiClient: client }
    )

    expect(objects.map((object) => object.objectId)).toEqual(["0x1", "0x2"])
  })

  it("returns undefined when getObjectSafe encounters errors", async () => {
    const { client } = createSuiClientMock({
      getObject: vi.fn().mockRejectedValue(new Error("fail"))
    })

    await expect(
      getObjectSafe({ objectId: "0x1" }, { suiClient: client })
    ).resolves.toBeUndefined()
  })

  it("matches object types case-insensitively", () => {
    const response = buildSuiObjectResponse({
      data: { type: "0x2::module::Struct" }
    })

    expect(objectTypeMatches(response, "0x2::module::struct")).toBe(true)
  })

  it("extracts owner addresses and throws on non-address owners", () => {
    expect(extractOwnerAddress({ AddressOwner: "0x2" })).toBe(
      normalizeSuiAddress("0x2")
    )

    expect(() => extractOwnerAddress(undefined)).toThrow(
      "Coin object is missing its owner."
    )

    expect(() => extractOwnerAddress({ ObjectOwner: "0x3" } as never)).toThrow(
      "Coin object is not address-owned."
    )
  })
})
