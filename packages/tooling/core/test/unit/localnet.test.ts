import { describe, expect, it, vi } from "vitest"
import { toB64 } from "@mysten/sui/utils"
import type { SuiTransactionBlockResponse } from "@mysten/sui/client"
import type { Transaction } from "@mysten/sui/transactions"
import {
  isLocalRpc,
  makeLocalnetExecutor,
  walletSupportsChain
} from "../../src/localnet.ts"

const buildTransactionStub = () =>
  ({
    build: vi.fn().mockResolvedValue("transaction-bytes")
  }) as unknown as Transaction

const buildLocalClient = (overrides: Partial<Record<string, unknown>> = {}) =>
  ({
    getRpcUrl: () => "http://localhost:9000",
    dryRunTransactionBlock: vi.fn().mockResolvedValue({
      effects: { status: { status: "success" } }
    }),
    executeTransactionBlock: vi.fn().mockResolvedValue({
      effects: { status: { status: "success" } },
      rawEffects: [1, 2]
    }),
    ...overrides
  }) as never

describe("localnet helpers", () => {
  it("detects local RPC urls", () => {
    expect(isLocalRpc("http://localhost:9000")).toBe(true)
    expect(isLocalRpc("https://127.0.0.1:9000")).toBe(true)
    expect(isLocalRpc("https://example.com")).toBe(false)
  })

  it("executes localnet transactions with dry run", async () => {
    const client = buildLocalClient()
    const reportTransactionEffects = vi.fn()

    const executor = makeLocalnetExecutor({
      client,
      signTransaction: vi.fn().mockResolvedValue({
        bytes: "signed-bytes",
        signature: "signature",
        reportTransactionEffects
      })
    })

    const result = await executor(buildTransactionStub())

    expect(result.effects?.status?.status).toBe("success")
    expect(client.dryRunTransactionBlock).toHaveBeenCalledTimes(1)
    expect(client.executeTransactionBlock).toHaveBeenCalledTimes(1)
    expect(reportTransactionEffects).toHaveBeenCalledWith(
      toB64(new Uint8Array([1, 2]))
    )
  })

  it("skips dry run when disabled", async () => {
    const client = buildLocalClient()

    const executor = makeLocalnetExecutor({
      client,
      signTransaction: vi.fn().mockResolvedValue({
        bytes: "signed-bytes",
        signature: "signature"
      })
    })

    await executor(buildTransactionStub(), { dryRun: false })

    expect(client.dryRunTransactionBlock).not.toHaveBeenCalled()
  })

  it("throws when localnet uses a non-local RPC url", () => {
    expect(() =>
      makeLocalnetExecutor({
        client: buildLocalClient({ getRpcUrl: () => "https://example.com" }),
        signTransaction: vi.fn()
      })
    ).toThrow("Refusing to use non-local RPC URL for localnet")
  })

  it("supports chain checks for wallets and accounts", () => {
    expect(
      walletSupportsChain({ chains: ["sui:localnet"] }, "sui:localnet")
    ).toBe(true)
    expect(
      walletSupportsChain(
        { accounts: [{ chains: ["sui:testnet"] }] },
        "sui:localnet"
      )
    ).toBe(false)
  })
})
