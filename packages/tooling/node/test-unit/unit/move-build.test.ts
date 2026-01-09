import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createSuiClientMock } from "../../../tests-integration/helpers/sui.ts"
import {
  readTextFile,
  withTempDir,
  writeFileTree
} from "../../../tests-integration/helpers/fs.ts"

const runSuiCliMock = vi.hoisted(() => vi.fn())
const getSuiCliEnvironmentChainIdMock = vi.hoisted(() => vi.fn())
const logWarningMock = vi.hoisted(() => vi.fn())

vi.mock("../../src/suiCli.ts", () => ({
  runSuiCli: () => runSuiCliMock,
  getSuiCliEnvironmentChainId: getSuiCliEnvironmentChainIdMock
}))

vi.mock("../../src/log.ts", () => ({
  logWarning: logWarningMock
}))

import {
  buildMovePackage,
  resolveChainIdentifier,
  syncLocalnetMoveEnvironmentChainId
} from "../../src/move.ts"
import type { SuiResolvedConfig } from "../../src/config.ts"

const buildSuiConfig = (networkName: string): SuiResolvedConfig => ({
  currentNetwork: networkName,
  networks: {},
  paths: {
    move: "/tmp/move",
    deployments: "/tmp/deployments",
    objects: "/tmp/objects",
    artifacts: "/tmp/artifacts"
  },
  network: {
    networkName,
    url: "http://localhost:9000",
    account: {}
  }
})

const buildBuildInfoYaml = ({
  packageName,
  dependencyAlias,
  dependencyAddress
}: {
  packageName: string
  dependencyAlias: string
  dependencyAddress: string
}) => `address_alias_instantiation:
  ${packageName}: "0x${"1".repeat(64)}"
  ${dependencyAlias}: "0x${dependencyAddress}"
`

beforeEach(() => {
  runSuiCliMock.mockReset()
  getSuiCliEnvironmentChainIdMock.mockReset()
  logWarningMock.mockReset()
})

describe("resolveChainIdentifier", () => {
  it("returns the RPC chain id when available", async () => {
    const { client } = createSuiClientMock({
      getChainIdentifier: vi.fn().mockResolvedValue("0xrpc")
    })

    await expect(
      resolveChainIdentifier(
        { environmentName: "localnet" },
        { suiClient: client, suiConfig: buildSuiConfig("localnet") }
      )
    ).resolves.toBe("0xrpc")

    expect(getSuiCliEnvironmentChainIdMock).not.toHaveBeenCalled()
  })

  it("falls back to the Sui CLI env chain id on RPC failure", async () => {
    const { client } = createSuiClientMock({
      getChainIdentifier: vi.fn().mockRejectedValue(new Error("rpc error"))
    })
    getSuiCliEnvironmentChainIdMock.mockResolvedValue("0xcli")

    await expect(
      resolveChainIdentifier(
        { environmentName: "localnet" },
        { suiClient: client, suiConfig: buildSuiConfig("localnet") }
      )
    ).resolves.toBe("0xcli")
  })
})

describe("syncLocalnetMoveEnvironmentChainId", () => {
  it("skips when the environment is not localnet", async () => {
    const { client } = createSuiClientMock({
      getChainIdentifier: vi.fn().mockResolvedValue("0xignored")
    })

    const result = await syncLocalnetMoveEnvironmentChainId(
      {
        moveRootPath: "/tmp",
        environmentName: "testnet"
      },
      { suiClient: client, suiConfig: buildSuiConfig("testnet") }
    )

    expect(result).toEqual({ updatedFiles: [], didAttempt: false })
  })

  it("updates Move.toml when localnet chain id is resolved", async () => {
    const { client } = createSuiClientMock({
      getChainIdentifier: vi.fn().mockResolvedValue("0xabc")
    })

    await withTempDir(async (dir) => {
      const moveToml = `[package]\nname = "fixture"\nversion = "0.0.1"\n\n[dep-replacements.localnet]\nSui = { local = "../sui" }\n`
      await writeFileTree(dir, { "Move.toml": moveToml })

      const result = await syncLocalnetMoveEnvironmentChainId(
        {
          moveRootPath: dir,
          environmentName: "localnet"
        },
        { suiClient: client, suiConfig: buildSuiConfig("localnet") }
      )

      expect(result.didAttempt).toBe(true)
      expect(result.updatedFiles).toEqual([path.join(dir, "Move.toml")])

      const updated = await readTextFile(path.join(dir, "Move.toml"))
      expect(updated).toContain("[environments]")
      expect(updated).toContain('localnet = "0xabc"')
    })
  })
})

describe("buildMovePackage", () => {
  it("parses build JSON output and ensures install dir", async () => {
    runSuiCliMock.mockResolvedValue({
      stdout: JSON.stringify({ modules: ["module"], dependencies: ["dep"] }),
      stderr: "",
      exitCode: 0
    })

    await withTempDir(async (dir) => {
      const result = await buildMovePackage(dir)

      expect(result.modules).toEqual(["module"])
      expect(result.dependencies).toEqual(["dep"])

      const [buildArgs] = runSuiCliMock.mock.calls[0] ?? []
      expect(buildArgs).toEqual(["--path", dir, "--install-dir", dir])
    })
  })

  it("falls back to build artifacts when JSON is missing modules", async () => {
    runSuiCliMock.mockResolvedValue({
      stdout: "{}",
      stderr: "",
      exitCode: 0
    })

    await withTempDir(async (dir) => {
      const packageName = "fixture"
      const buildInfoYaml = buildBuildInfoYaml({
        packageName,
        dependencyAlias: "Dep",
        dependencyAddress: "2".repeat(64)
      })
      await writeFileTree(dir, {
        [`build/${packageName}/BuildInfo.yaml`]: buildInfoYaml,
        [`build/${packageName}/bytecode_modules/Module.mv`]: "module",
        [`build/${packageName}/bytecode_modules/Module_tests.mv`]: "test-module"
      })

      const result = await buildMovePackage(dir, [], {
        stripTestModules: true
      })

      expect(result.modules).toEqual([Buffer.from("module").toString("base64")])
      expect(result.dependencies).toEqual([`0x${"2".repeat(64)}`])
      expect(result.dependencyAddresses).toEqual({
        Dep: `0x${"2".repeat(64)}`
      })
      expect(logWarningMock).toHaveBeenCalled()
    })
  })

  it("throws when build output is empty and artifacts are missing", async () => {
    runSuiCliMock.mockResolvedValue({
      stdout: "{}",
      stderr: "",
      exitCode: 1
    })

    await withTempDir(async (dir) => {
      await expect(buildMovePackage(dir)).rejects.toThrow(
        "Move build did not emit bytecode output"
      )
    })
  })
})
