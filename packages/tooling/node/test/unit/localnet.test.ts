import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { withEnv } from "../../../test/helpers/env.ts"

const describeObjectMocks = vi.hoisted(() => ({
  createSuiClient: vi.fn()
}))

vi.mock("../../src/describe-object.ts", () => ({
  createSuiClient: describeObjectMocks.createSuiClient
}))

import {
  deriveFaucetUrl,
  getRpcSnapshot,
  isFaucetSupportedNetwork,
  probeRpcHealth,
  resolveLocalnetConfigDir
} from "../../src/localnet.ts"

describe("tooling localnet helpers", () => {
  it("resolves localnet config dirs with overrides and defaults", async () => {
    const homeDir = os.homedir()

    expect(resolveLocalnetConfigDir("~/sui")).toBe(
      path.resolve(path.join(homeDir, "sui"))
    )

    await withEnv(
      {
        SUI_LOCALNET_CONFIG_DIR: "/tmp/sui-localnet"
      },
      () => {
        expect(resolveLocalnetConfigDir()).toBe(
          path.resolve("/tmp/sui-localnet")
        )
      }
    )

    await withEnv(
      {
        SUI_LOCALNET_CONFIG_DIR: undefined,
        SUI_CONFIG_DIR: undefined
      },
      () => {
        expect(resolveLocalnetConfigDir()).toBe(
          path.resolve(path.join(homeDir, ".sui", "localnet"))
        )
      }
    )
  })

  it("detects faucet-supported networks", () => {
    expect(isFaucetSupportedNetwork("localnet")).toBe(true)
    expect(isFaucetSupportedNetwork("devnet")).toBe(true)
    expect(isFaucetSupportedNetwork("testnet")).toBe(true)
    expect(isFaucetSupportedNetwork("mainnet")).toBe(false)
  })

  it("derives a faucet url from a localnet rpc url", () => {
    expect(deriveFaucetUrl("http://localhost:9000")).toBe(
      "http://localhost:9123/v2/gas"
    )
  })

  it("falls back to default faucet url on invalid rpc url", () => {
    expect(deriveFaucetUrl("not a url")).toBe("http://127.0.0.1:9123/v2/gas")
  })

  it("returns rpc snapshots when the node is healthy", async () => {
    describeObjectMocks.createSuiClient.mockReturnValue({
      getLatestSuiSystemState: vi.fn().mockResolvedValue({
        epoch: "1",
        protocolVersion: "1",
        activeValidators: [],
        epochStartTimestampMs: null
      }),
      getLatestCheckpointSequenceNumber: vi.fn().mockResolvedValue("10"),
      getReferenceGasPrice: vi.fn().mockResolvedValue(1000n)
    })

    const snapshot = await getRpcSnapshot("http://localhost:9000")
    expect(snapshot.rpcUrl).toBe("http://localhost:9000")
    expect(snapshot.epoch).toBe("1")
  })

  it("reports offline status when rpc snapshot fails", async () => {
    describeObjectMocks.createSuiClient.mockReturnValue({
      getLatestSuiSystemState: vi.fn().mockRejectedValue(new Error("down"))
    })

    const result = await probeRpcHealth("http://localhost:9000")
    expect(result.status).toBe("offline")
  })
})
