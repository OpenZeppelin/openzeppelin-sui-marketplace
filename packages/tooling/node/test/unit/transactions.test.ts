import { describe, expect, it, vi } from "vitest"
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import { newTransaction } from "@sui-oracle-market/tooling-core/transactions"
import type { SuiResolvedConfig } from "../../src/config.ts"
import { createSuiClientMock } from "../../../test/helpers/sui.ts"
import {
  findCreatedArtifactIdBySuffix,
  requireCreatedArtifactIdBySuffix,
  signAndExecute
} from "../../src/transactions.ts"

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

describe("signAndExecute", () => {
  it("retries once on stale gas object errors", async () => {
    const keypair = Ed25519Keypair.generate()
    const { client, mocks } = createSuiClientMock({
      getCoins: vi.fn().mockResolvedValue({
        data: [
          {
            coinObjectId: "0x1",
            version: "1",
            digest: "digest-1"
          }
        ],
        hasNextPage: false,
        nextCursor: null
      }),
      signAndExecuteTransaction: vi
        .fn()
        .mockRejectedValueOnce(new Error("Object ID 0xdeadbeef is locked."))
        .mockResolvedValueOnce({
          effects: { status: { status: "success" } },
          objectChanges: []
        })
    })

    const result = await signAndExecute(
      { transaction: newTransaction(), signer: keypair },
      { suiClient: client, suiConfig: buildConfig("localnet") }
    )

    expect(result.transactionResult.effects?.status?.status).toBe("success")
    expect(mocks.signAndExecuteTransaction).toHaveBeenCalledTimes(2)
    expect(mocks.getCoins).toHaveBeenCalledTimes(2)
  })

  it("throws when the error is not gas-related", async () => {
    const keypair = Ed25519Keypair.generate()
    const { client, mocks } = createSuiClientMock({
      getCoins: vi.fn().mockResolvedValue({
        data: [
          {
            coinObjectId: "0x1",
            version: "1",
            digest: "digest-1"
          }
        ],
        hasNextPage: false,
        nextCursor: null
      }),
      signAndExecuteTransaction: vi.fn().mockRejectedValue(new Error("boom"))
    })

    await expect(
      signAndExecute(
        { transaction: newTransaction(), signer: keypair },
        { suiClient: client, suiConfig: buildConfig("localnet") }
      )
    ).rejects.toThrow("boom")

    expect(mocks.signAndExecuteTransaction).toHaveBeenCalledTimes(1)
  })
})

describe("artifact lookup helpers", () => {
  it("finds created artifact ids by suffix", () => {
    const artifacts = [
      {
        objectType: "0x2::package::Publisher",
        objectId: "0x1",
        packageId: "0x2",
        signer: "0x9"
      },
      {
        objectType: "0x2::example::Thing",
        objectId: "0x2",
        packageId: "0x2",
        signer: "0x9"
      }
    ]

    expect(
      findCreatedArtifactIdBySuffix(artifacts, "::package::Publisher")
    ).toBe("0x1")
  })

  it("throws when a required artifact is missing", () => {
    const artifacts = [
      {
        objectType: "0x2::example::Thing",
        objectId: "0x2",
        packageId: "0x2",
        signer: "0x9"
      }
    ]

    expect(() =>
      requireCreatedArtifactIdBySuffix({
        createdArtifacts: artifacts,
        suffix: "::package::Publisher",
        label: "Publisher"
      })
    ).toThrow("Expected Publisher to be created")
  })
})
