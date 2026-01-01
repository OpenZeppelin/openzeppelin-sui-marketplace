/* eslint-disable @typescript-eslint/consistent-type-imports */
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import { normalizeSuiAddress, normalizeSuiObjectId } from "@mysten/sui/utils"
import { newTransaction } from "@sui-oracle-market/tooling-core/transactions"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  buildCreatedObjectChange,
  buildDeletedObjectChange,
  buildMutatedObjectChange,
  buildTransferredObjectChange,
  buildWrappedObjectChange,
  createSuiClientMock
} from "../../../test/helpers/sui.ts"
import type { SuiResolvedConfig } from "../../src/config.ts"

const artifactMocks = vi.hoisted(() => ({
  writeObjectArtifact: vi.fn().mockResolvedValue([]),
  loadObjectArtifacts: vi.fn(),
  rewriteUpdatedArtifacts: vi.fn(),
  getObjectArtifactPath: vi.fn(
    (networkName: string) => `/tmp/${networkName}-objects.json`
  )
}))

const getSuiObjectMock = vi.hoisted(() => vi.fn())

vi.mock("../../src/artifacts.ts", () => ({
  writeObjectArtifact: artifactMocks.writeObjectArtifact,
  loadObjectArtifacts: artifactMocks.loadObjectArtifacts,
  rewriteUpdatedArtifacts: artifactMocks.rewriteUpdatedArtifacts,
  getObjectArtifactPath: artifactMocks.getObjectArtifactPath
}))

vi.mock("@sui-oracle-market/tooling-core/object", async () => {
  const actual = await vi.importActual<
    typeof import("@sui-oracle-market/tooling-core/object")
  >("@sui-oracle-market/tooling-core/object")
  return {
    ...actual,
    getSuiObject: getSuiObjectMock
  }
})

import { executeTransactionOnce } from "../../src/transactions.ts"

const buildConfig = (networkName: string): SuiResolvedConfig => ({
  currentNetwork: networkName,
  defaultNetwork: networkName,
  networks: {},
  paths: {
    move: "/tmp/move",
    deployments: "/tmp/deployments",
    objects: "/tmp/deployments",
    artifacts: "/tmp/deployments"
  },
  network: {
    networkName,
    url: "http://localhost:9000",
    account: { accountIndex: 0 }
  }
})

beforeEach(() => {
  artifactMocks.writeObjectArtifact.mockClear()
  artifactMocks.loadObjectArtifacts.mockReset()
  artifactMocks.rewriteUpdatedArtifacts.mockClear()
  artifactMocks.getObjectArtifactPath.mockClear()
  getSuiObjectMock.mockReset()
})

describe("executeTransactionOnce", () => {
  it("persists created object artifacts on success", async () => {
    const keypair = Ed25519Keypair.generate()
    const { client } = createSuiClientMock({
      signAndExecuteTransaction: vi.fn().mockResolvedValue({
        digest: "digest-1",
        effects: { status: { status: "success" } },
        objectChanges: [
          buildCreatedObjectChange({
            objectId: "0x1",
            objectType: "0x2::example::Thing",
            version: "1",
            digest: "digest-created"
          })
        ]
      })
    })

    getSuiObjectMock.mockResolvedValue({
      object: {
        objectId: "0x1",
        type: "0x2::example::Thing",
        owner: { AddressOwner: "0x5" },
        version: "2"
      }
    })

    const result = await executeTransactionOnce(
      {
        transaction: newTransaction(),
        signer: keypair,
        requestType: "WaitForLocalExecution",
        assertSuccess: true
      },
      { suiClient: client, suiConfig: buildConfig("localnet") }
    )

    expect(result.objectArtifacts.created).toHaveLength(1)
    expect(result.objectArtifacts.created[0]?.objectId).toBe(
      normalizeSuiObjectId("0x1")
    )
    expect(result.objectArtifacts.created[0]?.packageId).toBe(
      normalizeSuiObjectId("0x2")
    )
    expect(result.objectArtifacts.created[0]?.owner).toMatchObject({
      ownerType: "address",
      address: normalizeSuiAddress("0x5")
    })

    expect(artifactMocks.writeObjectArtifact).toHaveBeenCalledWith(
      "/tmp/localnet-objects.json",
      expect.arrayContaining([
        expect.objectContaining({ objectId: normalizeSuiObjectId("0x1") })
      ])
    )
  })

  it("updates owners and timestamps deleted and wrapped artifacts", async () => {
    const keypair = Ed25519Keypair.generate()
    const now = new Date("2024-01-01T00:00:00.000Z")
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const { client } = createSuiClientMock({
      signAndExecuteTransaction: vi.fn().mockResolvedValue({
        digest: "digest-2",
        effects: { status: { status: "success" } },
        objectChanges: [
          buildMutatedObjectChange({
            objectId: "0x1",
            version: "2",
            digest: "digest-mutated",
            owner: { AddressOwner: "0x5" }
          }),
          buildTransferredObjectChange({
            objectId: "0x2",
            version: "3",
            digest: "digest-transferred",
            recipient: { AddressOwner: "0x6" }
          }),
          buildDeletedObjectChange({
            objectId: "0x3",
            version: "4"
          }),
          buildWrappedObjectChange({
            objectId: "0x4",
            version: "5"
          })
        ]
      })
    })

    artifactMocks.loadObjectArtifacts.mockResolvedValue([
      {
        objectId: "0x1",
        objectType: "0x2::example::Thing",
        packageId: "0x2",
        signer: "0x9",
        owner: { ownerType: "address", address: "0x9" },
        version: "1",
        digest: "old"
      },
      {
        objectId: "0x2",
        objectType: "0x2::example::Thing",
        packageId: "0x2",
        signer: "0x9",
        owner: { ownerType: "address", address: "0x9" },
        version: "1",
        digest: "old"
      },
      {
        objectId: "0x3",
        objectType: "0x2::example::Thing",
        packageId: "0x2",
        signer: "0x9",
        owner: { ownerType: "address", address: "0x9" },
        version: "1",
        digest: "old"
      },
      {
        objectId: "0x4",
        objectType: "0x2::example::Thing",
        packageId: "0x2",
        signer: "0x9",
        owner: { ownerType: "address", address: "0x9" },
        version: "1",
        digest: "old"
      }
    ])

    const result = await executeTransactionOnce(
      {
        transaction: newTransaction(),
        signer: keypair,
        requestType: "WaitForLocalExecution",
        assertSuccess: true
      },
      { suiClient: client, suiConfig: buildConfig("localnet") }
    )

    expect(result.objectArtifacts.updated).toHaveLength(2)
    expect(result.objectArtifacts.updated[0]?.owner).toMatchObject({
      ownerType: "address",
      address: normalizeSuiAddress("0x5")
    })
    expect(result.objectArtifacts.updated[1]?.owner).toMatchObject({
      ownerType: "address",
      address: normalizeSuiAddress("0x6")
    })

    expect(result.objectArtifacts.deleted).toHaveLength(1)
    expect(result.objectArtifacts.deleted[0]?.deletedAt).toBe(now.toISOString())
    expect(result.objectArtifacts.wrapped).toHaveLength(1)
    expect(result.objectArtifacts.wrapped[0]?.wrappedAt).toBe(now.toISOString())

    expect(artifactMocks.rewriteUpdatedArtifacts).toHaveBeenCalledTimes(3)

    vi.useRealTimers()
  })
})
