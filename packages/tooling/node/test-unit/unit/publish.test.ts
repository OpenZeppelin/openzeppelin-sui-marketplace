/* eslint-disable @typescript-eslint/consistent-type-imports */
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519"
import type { PublishArtifact } from "@sui-oracle-market/tooling-core/types"
import path from "node:path"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { withCwd } from "../../../tests-integration/helpers/cwd.ts"
import {
  readFixture,
  readTextFile,
  withTempDir,
  writeFileTree
} from "../../../tests-integration/helpers/fs.ts"
import { createSuiClientMock } from "../../../tests-integration/helpers/sui.ts"
import { getDeploymentArtifactPath } from "../../src/artifacts.ts"

const moveMocks = vi.hoisted(() => ({
  buildMovePackage: vi.fn(),
  syncLocalnetMoveEnvironmentChainId: vi.fn(),
  clearPublishedEntryForNetwork: vi.fn()
}))
const runSuiCliMock = vi.hoisted(() => vi.fn())
const suiCliMocks = vi.hoisted(() => ({
  getSuiCliVersion: vi.fn()
}))
const logMocks = vi.hoisted(() => ({
  logKeyValueBlue: vi.fn(() => vi.fn()),
  logKeyValueGreen: vi.fn(() => vi.fn()),
  logSimpleBlue: vi.fn(),
  logSimpleGreen: vi.fn(),
  logWarning: vi.fn(),
  logError: vi.fn(),
  logEachBlue: vi.fn(),
  logEachGreen: vi.fn()
}))

vi.mock("../../src/move.ts", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/move.ts")>(
      "../../src/move.ts"
    )
  return {
    ...actual,
    buildMovePackage: moveMocks.buildMovePackage,
    syncLocalnetMoveEnvironmentChainId:
      moveMocks.syncLocalnetMoveEnvironmentChainId,
    clearPublishedEntryForNetwork: moveMocks.clearPublishedEntryForNetwork
  }
})

vi.mock("../../src/suiCli.ts", () => ({
  runSuiCli: () => runSuiCliMock,
  getSuiCliVersion: suiCliMocks.getSuiCliVersion
}))

vi.mock("../../src/log.ts", () => ({
  logKeyValueBlue: logMocks.logKeyValueBlue,
  logKeyValueGreen: logMocks.logKeyValueGreen,
  logSimpleBlue: logMocks.logSimpleBlue,
  logSimpleGreen: logMocks.logSimpleGreen,
  logWarning: logMocks.logWarning,
  logError: logMocks.logError,
  logEachBlue: logMocks.logEachBlue,
  logEachGreen: logMocks.logEachGreen
}))

let publishPackage: typeof import("../../src/publish.ts").publishPackage
let publishPackageWithLog: typeof import("../../src/publish.ts").publishPackageWithLog

const buildPublishPlan = (
  overrides: Partial<Parameters<typeof publishPackage>[0]> = {}
): Parameters<typeof publishPackage>[0] =>
  ({
    network: {
      networkName: "localnet",
      url: "http://localhost:9000",
      account: { accountIndex: 0 }
    },
    packagePath: "/tmp/move/oracle-market",
    fullNodeUrl: "http://localhost:9000",
    keypair: Ed25519Keypair.generate(),
    gasBudget: 1000,
    shouldUseUnpublishedDependencies: false,
    unpublishedDependencies: [],
    buildFlags: [],
    packageNames: { root: "oracle-market", dependencies: [] },
    useCliPublish: true,
    suiCliVersion: "1.2.3",
    ...overrides
  }) as Parameters<typeof publishPackage>[0]

const buildCliPublishResponse = () => ({
  digest: "digest-123",
  objectChanges: [
    { type: "published", packageId: "0x1" },
    {
      type: "created",
      objectType: "0x2::package::UpgradeCap",
      objectId: "0xcap"
    },
    {
      type: "created",
      objectType: "0x2::package::Publisher",
      objectId: "0xpublisher"
    }
  ]
})

const buildResolvedConfig = ({
  packageRoot,
  networkName,
  url
}: {
  packageRoot: string
  networkName: string
  url: string
}) => {
  const network = {
    networkName,
    url,
    account: { accountIndex: 0 }
  }

  return {
    currentNetwork: networkName,
    defaultNetwork: networkName,
    networks: { [networkName]: network },
    paths: {
      move: path.join(packageRoot, "move"),
      deployments: path.join(packageRoot, "deployments"),
      objects: path.join(packageRoot, "deployments"),
      artifacts: path.join(packageRoot, "deployments")
    },
    network
  }
}

const createPackageFixture = async ({
  rootDir,
  moveTomlContents,
  moveLockContents
}: {
  rootDir: string
  moveTomlContents: string
  moveLockContents?: string
}) => {
  const packagePath = path.join(rootDir, "move-package")
  const files: Record<string, string> = {
    "Move.toml": moveTomlContents
  }
  if (moveLockContents) files["Move.lock"] = moveLockContents

  await writeFileTree(packagePath, files)

  return packagePath
}

beforeAll(async () => {
  const publishModule = await import("../../src/publish.ts")
  publishPackage = publishModule.publishPackage
  publishPackageWithLog = publishModule.publishPackageWithLog
})

beforeEach(() => {
  moveMocks.buildMovePackage.mockReset()
  moveMocks.syncLocalnetMoveEnvironmentChainId.mockReset().mockResolvedValue({
    updatedFiles: [],
    chainId: "0x0",
    didAttempt: false
  })
  moveMocks.clearPublishedEntryForNetwork.mockReset().mockResolvedValue({
    didUpdate: false
  })
  runSuiCliMock.mockReset()
  suiCliMocks.getSuiCliVersion.mockResolvedValue("1.2.3")
  logMocks.logWarning.mockClear()
  logMocks.logError.mockClear()
  logMocks.logKeyValueBlue.mockClear()
  logMocks.logKeyValueGreen.mockClear()
  logMocks.logSimpleBlue.mockClear()
  logMocks.logSimpleGreen.mockClear()
  logMocks.logEachBlue.mockClear()
  logMocks.logEachGreen.mockClear()
})

describe("publishPackage", () => {
  it("publishes via CLI and writes deployment artifacts", async () => {
    moveMocks.buildMovePackage.mockResolvedValue({
      modules: ["module"],
      dependencies: ["dep"],
      dependencyAddresses: {}
    })

    const response = buildCliPublishResponse()
    runSuiCliMock.mockResolvedValue({
      stdout: `notice\n${JSON.stringify(response)}`,
      stderr: "",
      exitCode: 0
    })

    await withTempDir(async (dir) => {
      await withCwd(dir, async () => {
        const publishPlan = buildPublishPlan()
        const artifacts = await publishPackage(publishPlan, {
          suiClient: {} as never,
          suiConfig: publishPlan.network as never
        })

        expect(artifacts).toHaveLength(1)
        expect(artifacts[0]?.packageId).toBe("0x1")
        expect(artifacts[0]?.packageName).toBe("oracle-market")

        const deploymentPath = getDeploymentArtifactPath("localnet")
        const persisted = JSON.parse(
          await readTextFile(deploymentPath)
        ) as PublishArtifact[]

        expect(persisted[0]?.packageId).toBe("0x1")
      })
    })
  })

  it("throws when CLI publish fails", async () => {
    moveMocks.buildMovePackage.mockResolvedValue({
      modules: ["module"],
      dependencies: ["dep"],
      dependencyAddresses: {}
    })

    runSuiCliMock.mockResolvedValue({
      stdout: "bad",
      stderr: "error",
      exitCode: 1
    })

    const publishPlan = buildPublishPlan()
    await expect(
      publishPackage(publishPlan, {
        suiClient: {} as never,
        suiConfig: publishPlan.network as never
      })
    ).rejects.toThrow("Sui CLI publish exited with code 1")
  })

  it("throws when publish returns no packages", async () => {
    moveMocks.buildMovePackage.mockResolvedValue({
      modules: ["module"],
      dependencies: ["dep"],
      dependencyAddresses: {}
    })

    runSuiCliMock.mockResolvedValue({
      stdout: JSON.stringify({ digest: "digest-123", objectChanges: [] }),
      stderr: "",
      exitCode: 0
    })

    const publishPlan = buildPublishPlan()
    await expect(
      publishPackage(publishPlan, {
        suiClient: {} as never,
        suiConfig: publishPlan.network as never
      })
    ).rejects.toThrow("Publish succeeded but no packageId was returned.")
  })

  it("throws when CLI output has no JSON payload", async () => {
    moveMocks.buildMovePackage.mockResolvedValue({
      modules: ["module"],
      dependencies: ["dep"],
      dependencyAddresses: {}
    })

    runSuiCliMock.mockResolvedValue({
      stdout: "published successfully",
      stderr: "",
      exitCode: 0
    })

    const publishPlan = buildPublishPlan()
    await expect(
      publishPackage(publishPlan, {
        suiClient: {} as never,
        suiConfig: publishPlan.network as never
      })
    ).rejects.toThrow("Failed to parse JSON from Sui CLI publish output.")
  })

  it("publishes via SDK and persists labeled artifacts", async () => {
    moveMocks.buildMovePackage.mockResolvedValue({
      modules: ["module"],
      dependencies: ["dep"],
      dependencyAddresses: { Dep: "0x9" }
    })

    const { client } = createSuiClientMock({
      signAndExecuteTransaction: vi.fn().mockResolvedValue({
        digest: "digest-456",
        effects: { status: { status: "success" } },
        objectChanges: [
          { type: "published", packageId: "0x1" },
          {
            type: "created",
            objectType: "0x2::package::UpgradeCap",
            objectId: "0xcap"
          },
          {
            type: "created",
            objectType: "0x2::package::Publisher",
            objectId: "0xpublisher"
          }
        ]
      })
    })

    await withTempDir(async (dir) => {
      await withCwd(dir, async () => {
        const publishPlan = buildPublishPlan({ useCliPublish: false })
        const artifacts = await publishPackage(publishPlan, {
          suiClient: client,
          suiConfig: publishPlan.network as never
        })

        expect(artifacts[0]?.packageId).toBe("0x1")
        expect(artifacts[0]?.upgradeCap).toBe("0xcap")
        expect(artifacts[0]?.publisherId).toBe("0xpublisher")
        expect(artifacts[0]?.packageName).toBe("oracle-market")
        expect(artifacts[0]?.dependencies).toEqual(["dep"])
        expect(artifacts[0]?.dependencyAddresses).toEqual({ Dep: "0x9" })

        const deploymentPath = getDeploymentArtifactPath("localnet")
        const persisted = JSON.parse(
          await readTextFile(deploymentPath)
        ) as PublishArtifact[]

        expect(persisted[0]?.packageId).toBe("0x1")
      })
    })
  })

  it("falls back to CLI publish when SDK hits size limits", async () => {
    moveMocks.buildMovePackage.mockResolvedValue({
      modules: ["module"],
      dependencies: ["dep"],
      dependencyAddresses: {}
    })

    const { client } = createSuiClientMock({
      signAndExecuteTransaction: vi
        .fn()
        .mockRejectedValue(
          new Error("Serialized transaction size limit exceeded")
        )
    })

    const response = buildCliPublishResponse()
    runSuiCliMock.mockResolvedValue({
      stdout: JSON.stringify(response),
      stderr: "",
      exitCode: 0
    })

    const publishPlan = buildPublishPlan({ useCliPublish: false })
    const artifacts = await publishPackage(publishPlan, {
      suiClient: client,
      suiConfig: publishPlan.network as never
    })

    expect(logMocks.logWarning).toHaveBeenCalledWith(
      expect.stringContaining("SDK publish exceeded transaction limits")
    )
    expect(runSuiCliMock).toHaveBeenCalled()
    expect(artifacts[0]?.packageId).toBe("0x1")
  })

  it("warns when CLI unpublished dependency publish lacks keystore", async () => {
    moveMocks.buildMovePackage.mockResolvedValue({
      modules: ["module"],
      dependencies: ["dep"],
      dependencyAddresses: {}
    })

    const response = buildCliPublishResponse()
    runSuiCliMock.mockResolvedValue({
      stdout: JSON.stringify(response),
      stderr: "",
      exitCode: 0
    })

    const publishPlan = buildPublishPlan({
      shouldUseUnpublishedDependencies: true,
      keystorePath: undefined
    })

    await publishPackage(publishPlan, {
      suiClient: {} as never,
      suiConfig: publishPlan.network as never
    })

    expect(logMocks.logWarning).toHaveBeenCalledWith(
      expect.stringContaining("no keystore path override was provided")
    )
  })
})

describe("publishPackageWithLog", () => {
  it("auto-enables unpublished dependencies on localnet when allowed", async () => {
    moveMocks.buildMovePackage.mockResolvedValue({
      modules: ["module"],
      dependencies: ["dep"],
      dependencyAddresses: {}
    })

    const cliPublishResponse = buildCliPublishResponse()
    runSuiCliMock.mockResolvedValueOnce({
      stdout: JSON.stringify(cliPublishResponse),
      stderr: "",
      exitCode: 0
    })

    await withTempDir(async (dir) => {
      const packagePath = await createPackageFixture({
        rootDir: dir,
        moveTomlContents: await readFixture("move", "Move.toml")
      })

      const { client } = createSuiClientMock()
      const config = buildResolvedConfig({
        packageRoot: dir,
        networkName: "localnet",
        url: "http://localhost:9000"
      })

      await withCwd(dir, async () => {
        const artifacts = await publishPackageWithLog(
          {
            packagePath,
            keypair: Ed25519Keypair.generate(),
            withUnpublishedDependencies: false,
            allowAutoUnpublishedDependencies: true
          },
          { suiClient: client, suiConfig: config }
        )

        const [, buildFlags] = moveMocks.buildMovePackage.mock.calls[0] ?? []
        expect(buildFlags).toContain("--with-unpublished-dependencies")
        expect(runSuiCliMock).toHaveBeenNthCalledWith(
          1,
          expect.arrayContaining(["--with-unpublished-dependencies"]),
          { env: undefined }
        )
        expect(logMocks.logWarning).toHaveBeenCalledWith(
          expect.stringContaining("Enabling --with-unpublished-dependencies")
        )
        expect(artifacts[0]?.suiCliVersion).toBe("1.2.3")
        expect(artifacts[0]?.withUnpublishedDependencies).toBe(true)
      })
    })
  })

  it("rejects unpublished dependencies on shared networks", async () => {
    const { client } = createSuiClientMock()
    const config = buildResolvedConfig({
      packageRoot: "/tmp",
      networkName: "testnet",
      url: "https://example.invalid"
    })

    await expect(
      publishPackageWithLog(
        {
          packagePath: "/tmp/package",
          keypair: Ed25519Keypair.generate(),
          withUnpublishedDependencies: true
        },
        { suiClient: client, suiConfig: config }
      )
    ).rejects.toThrow(
      "--with-unpublished-dependencies is reserved for localnet"
    )
  })

  it("errors when Move.lock contains multiple framework revisions on shared networks", async () => {
    const { client } = createSuiClientMock()

    await withTempDir(async (dir) => {
      const packagePath = await createPackageFixture({
        rootDir: dir,
        moveTomlContents: await readFixture("move", "Move.toml"),
        moveLockContents: await readFixture("move", "Move.lock.pinned")
      })

      const config = buildResolvedConfig({
        packageRoot: dir,
        networkName: "testnet",
        url: "https://example.invalid"
      })

      await expect(
        publishPackageWithLog(
          {
            packagePath,
            keypair: Ed25519Keypair.generate()
          },
          { suiClient: client, suiConfig: config }
        )
      ).rejects.toThrow(
        "Multiple Sui framework revisions detected in Move.lock"
      )
    })
  })

  it("warns when Move.lock contains multiple framework revisions on localnet", async () => {
    moveMocks.buildMovePackage.mockResolvedValue({
      modules: ["module"],
      dependencies: ["dep"],
      dependencyAddresses: {}
    })

    runSuiCliMock.mockResolvedValueOnce({
      stdout: JSON.stringify(buildCliPublishResponse()),
      stderr: "",
      exitCode: 0
    })

    const { client } = createSuiClientMock()

    await withTempDir(async (dir) => {
      const packagePath = await createPackageFixture({
        rootDir: dir,
        moveTomlContents: await readFixture("move", "Move.toml"),
        moveLockContents: await readFixture("move", "Move.lock.pinned")
      })

      const config = buildResolvedConfig({
        packageRoot: dir,
        networkName: "localnet",
        url: "http://localhost:9000"
      })

      await withCwd(dir, async () => {
        const artifacts = await publishPackageWithLog(
          {
            packagePath,
            keypair: Ed25519Keypair.generate()
          },
          { suiClient: client, suiConfig: config }
        )

        expect(artifacts[0]?.packageId).toBe("0x1")
        expect(
          logMocks.logWarning.mock.calls.some(([message]) =>
            String(message).includes(
              "Multiple Sui framework revisions detected in Move.lock"
            )
          )
        ).toBe(true)
      })
    })
  })

  it("rejects missing network urls", async () => {
    const { client } = createSuiClientMock()
    const config = buildResolvedConfig({
      packageRoot: "/tmp",
      networkName: "localnet",
      url: ""
    })

    await expect(
      publishPackageWithLog(
        {
          packagePath: "/tmp/package",
          keypair: Ed25519Keypair.generate()
        },
        { suiClient: client, suiConfig: config }
      )
    ).rejects.toThrow("Missing network.url in ToolingContext.network.")
  })
})
