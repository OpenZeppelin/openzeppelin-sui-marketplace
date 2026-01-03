/* eslint-disable @typescript-eslint/consistent-type-imports */
import type { ExecException } from "node:child_process"
import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import {
  clearExecFileQueue,
  queueExecFileResult
} from "../../../tests-integration/helpers/child-process.ts"

let suiCli: typeof import("../../src/suiCli.ts")

const queueError = (message: string, stdout = "", stderr = "") => {
  const error = new Error(message) as ExecException
  error.code = 1
  error.stdout = stdout
  error.stderr = stderr
  queueExecFileResult({ error })
}

beforeAll(async () => {
  suiCli = await import("../../src/suiCli.ts")
})

beforeEach(() => {
  clearExecFileQueue()
})

describe("ensureSuiCli", () => {
  it("resolves when sui --version succeeds", async () => {
    queueExecFileResult({ stdout: "sui 1.0.0\n" })

    await expect(suiCli.ensureSuiCli()).resolves.toBeUndefined()
  })

  it("throws when sui --version fails", async () => {
    queueError("missing")

    await expect(suiCli.ensureSuiCli()).rejects.toThrow(
      "The Sui CLI is required but was not found."
    )
  })
})

describe("getActiveSuiCliEnvironment", () => {
  it("prefers json active-env output", async () => {
    queueExecFileResult({ stdout: '"localnet"' })

    await expect(suiCli.getActiveSuiCliEnvironment()).resolves.toBe("localnet")
  })

  it("falls back to text active-env output", async () => {
    queueError("no json")
    queueExecFileResult({ stdout: "active environment : testnet\n" })

    await expect(suiCli.getActiveSuiCliEnvironment()).resolves.toBe("testnet")
  })
})

describe("listSuiCliEnvironments", () => {
  it("parses environment aliases from json", async () => {
    queueExecFileResult({
      stdout: JSON.stringify([
        [{ alias: "localnet", rpc: "http://127.0.0.1:9000", chain_id: "1" }],
        "localnet"
      ])
    })

    await expect(suiCli.listSuiCliEnvironments()).resolves.toEqual(["localnet"])
  })

  it("falls back to tokenized env listing", async () => {
    queueError("json failed")
    queueExecFileResult({
      stdout: "* localnet\n testnet\n"
    })

    await expect(suiCli.listSuiCliEnvironments()).resolves.toEqual([
      "localnet",
      "testnet"
    ])
  })
})

describe("getSuiCliEnvironmentChainId/getSuiCliEnvironmentRpc", () => {
  it("returns chain id and rpc for active env", async () => {
    const envsPayload = {
      stdout: JSON.stringify([
        [
          {
            alias: "localnet",
            rpc: "http://127.0.0.1:9000",
            chain_id: "0x1"
          }
        ],
        "localnet"
      ])
    }

    queueExecFileResult(envsPayload)
    queueExecFileResult(envsPayload)

    await expect(suiCli.getSuiCliEnvironmentChainId()).resolves.toBe("0x1")
    await expect(suiCli.getSuiCliEnvironmentRpc()).resolves.toBe(
      "http://127.0.0.1:9000"
    )
  })
})

describe("switchSuiCliEnvironment/createSuiCliEnvironment", () => {
  it("returns true when switch succeeds", async () => {
    queueExecFileResult({ stdout: "ok" })
    await expect(suiCli.switchSuiCliEnvironment("localnet")).resolves.toBe(true)
  })

  it("returns false when create fails", async () => {
    queueError("create failed")
    await expect(
      suiCli.createSuiCliEnvironment("localnet", "http://127.0.0.1:9000")
    ).resolves.toBe(false)
  })
})
