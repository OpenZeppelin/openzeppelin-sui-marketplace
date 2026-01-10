import { EventEmitter } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { PassThrough } from "node:stream"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { spawn } = vi.hoisted(() => ({
  spawn: vi.fn()
}))

vi.mock("node:child_process", () => ({
  spawn
}))

import {
  buildScriptArguments,
  createSuiScriptRunner,
  parseJsonFromScriptOutput,
  resolveBuyerScriptPath,
  resolveOwnerScriptPath
} from "../../src/testing/scripts.ts"

class MockChildProcess extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  kill = vi.fn()
}

const runWithRunnerContext = async <T>(
  action: (context: never) => Promise<T>
): Promise<T> => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "sui-script-test-"))
  const context = {
    tempDir,
    artifactsDir: tempDir,
    moveRootPath: tempDir,
    localnet: {
      rpcUrl: "http://localhost:9000",
      configDir: tempDir
    },
    suiConfig: {
      network: {
        gasBudget: 500_000_000
      }
    }
  } as never

  try {
    return await action(context)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

describe("testing script helpers", () => {
  beforeEach(() => {
    spawn.mockReset()
  })

  it("builds script arguments from maps", () => {
    const args = buildScriptArguments({
      fooBar: "baz",
      enabled: true,
      disabled: false,
      values: [1, 2]
    })

    expect(args).toEqual([
      "--foo-bar",
      "baz",
      "--enabled",
      "--no-disabled",
      "--values",
      "1",
      "--values",
      "2"
    ])
  })

  it("resolves script paths", () => {
    const buyerPath = resolveBuyerScriptPath("buy.ts")
    const ownerPath = resolveOwnerScriptPath("shop-create")

    expect(buyerPath.endsWith(path.join("buyer", "buy.ts"))).toBe(true)
    expect(ownerPath.endsWith(path.join("owner", "shop-create.ts"))).toBe(true)
  })

  it("runs scripts with resolved environment", async () => {
    spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      process.nextTick(() => {
        child.stdout.end("ok")
        child.stderr.end("")
        child.emit("close", 0)
      })
      return child
    })

    const result = await runWithRunnerContext(async (context) => {
      const runner = createSuiScriptRunner(context)
      return runner.runScript("/tmp/script.ts", {
        args: { fooBar: "baz" },
        account: {
          address: "0x1",
          keypair: { getSecretKey: () => "secret" }
        } as never
      })
    })

    expect(result.stdout).toBe("ok")
    expect(spawn).toHaveBeenCalledTimes(1)
    const [command, args, options] = spawn.mock.calls[0]
    expect(path.basename(command)).toContain("ts-node-esm")
    expect(args).toContain("--transpile-only")
    expect(args).toContain("/tmp/script.ts")
    expect(args).toContain("--foo-bar")
    expect((options as { env: Record<string, string> }).env.SUI_RPC_URL).toBe(
      "http://localhost:9000"
    )
    expect((options as { env: Record<string, string> }).env.SUI_NETWORK).toBe(
      "localnet"
    )
    expect(
      (options as { env: Record<string, string> }).env.SUI_ACCOUNT_PRIVATE_KEY
    ).toBe("secret")
  })

  it("throws when scripts exit with non-zero codes by default", async () => {
    spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      process.nextTick(() => {
        child.stdout.end("fail")
        child.stderr.end("boom")
        child.emit("close", 2)
      })
      return child
    })

    await expect(
      runWithRunnerContext(async (context) => {
        const runner = createSuiScriptRunner(context)
        await runner.runScript("/tmp/script.ts")
      })
    ).rejects.toThrow(/Script failed/)
  })

  it("returns exit metadata when allowFailure is enabled", async () => {
    spawn.mockImplementation(() => {
      const child = new MockChildProcess()
      process.nextTick(() => {
        child.stdout.end("warn")
        child.stderr.end("error")
        child.emit("close", 3)
      })
      return child
    })

    const result = await runWithRunnerContext(async (context) => {
      const runner = createSuiScriptRunner(context)
      return runner.runScript("/tmp/script.ts", { allowFailure: true })
    })

    expect(result.exitCode).toBe(3)
    expect(result.stdout).toContain("warn")
    expect(result.stderr).toContain("error")
  })

  it("parses JSON output from script stdout", () => {
    const payload = { ok: true }
    const parsed = parseJsonFromScriptOutput(JSON.stringify(payload))

    expect(parsed).toEqual(payload)
  })

  it("parses JSON output from mixed stdout", () => {
    const payload = { ok: true }
    const stdout = `log line\\n${JSON.stringify(payload)}`
    const parsed = parseJsonFromScriptOutput(stdout)

    expect(parsed).toEqual(payload)
  })
})
