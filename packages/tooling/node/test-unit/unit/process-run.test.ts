import { createHash } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import yargs from "yargs/yargs"

const configMocks = vi.hoisted(() => ({
  loadSuiConfig: vi.fn(),
  getNetworkConfig: vi.fn()
}))

const describeObjectMocks = vi.hoisted(() => ({
  createSuiClient: vi.fn()
}))

const factoryMocks = vi.hoisted(() => ({
  createTooling: vi.fn()
}))

const logMocks = vi.hoisted(() => ({
  logEachBlue: vi.fn(),
  logError: vi.fn(),
  logKeyValueBlue: vi.fn(() => vi.fn()),
  logSimpleBlue: vi.fn(),
  logWarning: vi.fn()
}))

const moveMocks = vi.hoisted(() => ({
  syncLocalnetMoveEnvironmentChainId: vi.fn()
}))

const suiCliMocks = vi.hoisted(() => ({
  createSuiCliEnvironment: vi.fn(),
  ensureSuiCli: vi.fn(),
  runSuiCli: vi.fn(() =>
    vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }))
  ),
  getActiveSuiCliEnvironment: vi.fn(),
  getSuiCliEnvironmentRpc: vi.fn(),
  listSuiCliEnvironments: vi.fn(),
  switchSuiCliEnvironment: vi.fn()
}))

vi.mock("../../src/config.ts", () => ({
  loadSuiConfig: configMocks.loadSuiConfig,
  getNetworkConfig: configMocks.getNetworkConfig
}))

vi.mock("../../src/describe-object.ts", () => ({
  createSuiClient: describeObjectMocks.createSuiClient
}))

vi.mock("../../src/factory.ts", () => ({
  createTooling: factoryMocks.createTooling
}))

vi.mock("../../src/log.ts", () => ({
  logEachBlue: logMocks.logEachBlue,
  logError: logMocks.logError,
  logKeyValueBlue: logMocks.logKeyValueBlue,
  logSimpleBlue: logMocks.logSimpleBlue,
  logWarning: logMocks.logWarning
}))

vi.mock("../../src/move.ts", () => ({
  syncLocalnetMoveEnvironmentChainId:
    moveMocks.syncLocalnetMoveEnvironmentChainId
}))

vi.mock("../../src/suiCli.ts", () => ({
  createSuiCliEnvironment: suiCliMocks.createSuiCliEnvironment,
  ensureSuiCli: suiCliMocks.ensureSuiCli,
  runSuiCli: suiCliMocks.runSuiCli,
  getActiveSuiCliEnvironment: suiCliMocks.getActiveSuiCliEnvironment,
  getSuiCliEnvironmentRpc: suiCliMocks.getSuiCliEnvironmentRpc,
  listSuiCliEnvironments: suiCliMocks.listSuiCliEnvironments,
  switchSuiCliEnvironment: suiCliMocks.switchSuiCliEnvironment
}))

import { runSuiScript } from "../../src/process.ts"

const buildNetworkConfig = () => ({
  networkName: "testnet",
  url: "https://rpc.test",
  account: {}
})

const buildResolvedConfig = () => {
  const network = buildNetworkConfig()
  return {
    currentNetwork: network.networkName,
    networks: { [network.networkName]: network },
    paths: {
      move: "/tmp/move",
      deployments: "/tmp/deployments",
      objects: "/tmp/objects",
      artifacts: "/tmp/artifacts"
    },
    network
  }
}

const flushPendingPromises = async () =>
  await new Promise<void>((resolve) => setImmediate(resolve))

const stubProcessExit = () => {
  const previousExitCode = process.exitCode
  const exitSpy = vi
    .spyOn(process, "exit")
    .mockImplementation((() => undefined) as never)

  return {
    exitSpy,
    restore: () => {
      exitSpy.mockRestore()
      process.exitCode = previousExitCode
    }
  }
}

describe("runSuiScript", () => {
  beforeEach(() => {
    const resolvedConfig = buildResolvedConfig()
    const resolvedNetwork = resolvedConfig.network
    const suiClientStub = { rpc: resolvedNetwork.url }

    configMocks.loadSuiConfig.mockResolvedValue(resolvedConfig)
    configMocks.getNetworkConfig.mockReturnValue(resolvedNetwork)
    describeObjectMocks.createSuiClient.mockReturnValue(suiClientStub)
    factoryMocks.createTooling.mockImplementation(async (input) => ({
      suiClient: input.suiClient,
      suiConfig: input.suiConfig
    }))
    moveMocks.syncLocalnetMoveEnvironmentChainId.mockResolvedValue({
      chainId: "0x0",
      updatedFiles: [],
      didAttempt: false
    })
    suiCliMocks.ensureSuiCli.mockResolvedValue(undefined)
    suiCliMocks.getActiveSuiCliEnvironment.mockResolvedValue(
      resolvedNetwork.networkName
    )
    suiCliMocks.listSuiCliEnvironments.mockResolvedValue([
      resolvedNetwork.networkName
    ])
    suiCliMocks.getSuiCliEnvironmentRpc.mockResolvedValue(resolvedNetwork.url)
    suiCliMocks.switchSuiCliEnvironment.mockResolvedValue(true)
    suiCliMocks.createSuiCliEnvironment.mockResolvedValue(true)
  })

  it("runs the script and exits with code 0", async () => {
    const { exitSpy, restore } = stubProcessExit()
    const scriptMock = vi.fn().mockResolvedValue(undefined)

    runSuiScript(scriptMock)

    await flushPendingPromises()
    await flushPendingPromises()

    expect(suiCliMocks.ensureSuiCli).toHaveBeenCalled()
    expect(factoryMocks.createTooling).toHaveBeenCalled()
    expect(scriptMock).toHaveBeenCalledTimes(1)
    expect(exitSpy).toHaveBeenCalledWith(0)

    restore()
  })

  it("sets exitCode to 1 when the script fails", async () => {
    const { exitSpy, restore } = stubProcessExit()
    const scriptMock = vi.fn().mockRejectedValue(new Error("boom"))

    runSuiScript(scriptMock)

    await flushPendingPromises()
    await flushPendingPromises()

    expect(process.exitCode).toBe(1)
    expect(exitSpy).not.toHaveBeenCalled()

    restore()
  })

  it("switches environments when the active Sui CLI environment differs", async () => {
    const { exitSpy, restore } = stubProcessExit()
    const scriptMock = vi.fn().mockResolvedValue(undefined)

    suiCliMocks.getActiveSuiCliEnvironment.mockResolvedValue("devnet")
    suiCliMocks.listSuiCliEnvironments.mockResolvedValue(["devnet", "testnet"])

    runSuiScript(scriptMock)

    await flushPendingPromises()
    await flushPendingPromises()

    expect(suiCliMocks.switchSuiCliEnvironment).toHaveBeenNthCalledWith(
      1,
      "testnet"
    )
    expect(suiCliMocks.switchSuiCliEnvironment).toHaveBeenNthCalledWith(
      2,
      "devnet"
    )
    expect(exitSpy).toHaveBeenCalledWith(0)

    restore()
  })

  it("uses CLI network overrides when provided", async () => {
    const { exitSpy, restore } = stubProcessExit()
    const scriptMock = vi.fn().mockResolvedValue(undefined)

    configMocks.getNetworkConfig.mockImplementation(
      (networkName: string) =>
        ({
          networkName,
          url: `https://rpc.${networkName}`,
          account: {}
        }) as never
    )

    const previousArgv = process.argv
    process.argv = ["node", "script", "--network", "devnet"]

    runSuiScript(scriptMock, yargs([]))

    await flushPendingPromises()
    await flushPendingPromises()

    expect(configMocks.getNetworkConfig).toHaveBeenCalledWith(
      "devnet",
      expect.anything()
    )
    expect(exitSpy).toHaveBeenCalledWith(0)

    process.argv = previousArgv
    restore()
  })

  it("creates a temporary CLI environment when RPCs mismatch", async () => {
    const { exitSpy, restore } = stubProcessExit()
    const scriptMock = vi.fn().mockResolvedValue(undefined)

    suiCliMocks.getSuiCliEnvironmentRpc.mockResolvedValue("https://rpc.other")
    suiCliMocks.listSuiCliEnvironments.mockResolvedValue(["testnet"])
    suiCliMocks.getActiveSuiCliEnvironment.mockResolvedValue("testnet")

    runSuiScript(scriptMock)

    await flushPendingPromises()
    await flushPendingPromises()

    const expectedHash = createHash("sha256")
      .update("https://rpc.test")
      .digest("hex")
      .slice(0, 10)
    const expectedAlias = `testnet-rpc-${expectedHash}`

    expect(suiCliMocks.createSuiCliEnvironment).toHaveBeenCalledWith(
      expectedAlias,
      "https://rpc.test"
    )
    expect(suiCliMocks.switchSuiCliEnvironment).toHaveBeenNthCalledWith(
      1,
      expectedAlias
    )
    expect(suiCliMocks.switchSuiCliEnvironment).toHaveBeenNthCalledWith(
      2,
      "testnet"
    )
    expect(logMocks.logWarning).toHaveBeenCalledWith(
      expect.stringContaining("Switching to a temporary environment alias")
    )
    expect(exitSpy).toHaveBeenCalledWith(0)

    restore()
  })

  it("logs a warning when the CLI environment cannot be created", async () => {
    const { exitSpy, restore } = stubProcessExit()
    const scriptMock = vi.fn().mockResolvedValue(undefined)

    suiCliMocks.listSuiCliEnvironments.mockResolvedValue(["devnet"])
    suiCliMocks.getActiveSuiCliEnvironment.mockResolvedValue("devnet")
    suiCliMocks.getSuiCliEnvironmentRpc.mockResolvedValue(undefined)
    suiCliMocks.createSuiCliEnvironment.mockResolvedValue(false)

    runSuiScript(scriptMock)

    await flushPendingPromises()
    await flushPendingPromises()

    expect(suiCliMocks.switchSuiCliEnvironment).not.toHaveBeenCalled()
    expect(logMocks.logWarning).toHaveBeenCalledWith(
      expect.stringContaining("environment testnet is not configured")
    )
    expect(exitSpy).toHaveBeenCalledWith(0)

    restore()
  })

  it("sets exitCode to 1 when ensureSuiCli fails", async () => {
    const { exitSpy, restore } = stubProcessExit()
    const scriptMock = vi.fn().mockResolvedValue(undefined)

    suiCliMocks.ensureSuiCli.mockRejectedValue(new Error("missing cli"))

    runSuiScript(scriptMock)

    await flushPendingPromises()
    await flushPendingPromises()

    expect(process.exitCode).toBe(1)
    expect(scriptMock).not.toHaveBeenCalled()
    expect(exitSpy).not.toHaveBeenCalled()

    restore()
  })
})
