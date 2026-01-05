import { beforeEach, describe, expect, it, vi } from "vitest"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import path from "node:path"

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

    const context = {
      localnet: { rpcUrl: "http://localhost:9000" },
      artifactsDir: "/tmp/artifacts"
    } as never

    const runner = createSuiScriptRunner(context)
    const result = await runner.runScript("/tmp/script.ts", {
      args: { fooBar: "baz" },
      account: {
        address: "0x1",
        keypair: { getSecretKey: () => "secret" }
      } as never
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
