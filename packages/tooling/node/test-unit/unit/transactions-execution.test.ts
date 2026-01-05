import { beforeEach, describe, expect, it, vi } from "vitest"

const { maybeLogDevInspect, signAndExecute } = vi.hoisted(() => ({
  maybeLogDevInspect: vi.fn(),
  signAndExecute: vi.fn()
}))

vi.mock("../../src/dev-inspect.ts", () => ({
  maybeLogDevInspect
}))
vi.mock("../../src/transactions.ts", () => ({
  signAndExecute
}))

import { executeTransactionWithSummary } from "../../src/transactions-execution.ts"

describe("transaction execution helpers", () => {
  beforeEach(() => {
    maybeLogDevInspect.mockReset()
    signAndExecute.mockReset()
  })

  it("executes transactions and returns summaries", async () => {
    signAndExecute.mockResolvedValue({
      transactionResult: {
        digest: "0xabc",
        effects: { status: { status: "success" } }
      }
    })

    const toolingContext = {
      suiClient: {},
      suiConfig: {}
    } as never

    const result = await executeTransactionWithSummary(
      {
        transaction: {} as never,
        signer: {} as never
      },
      toolingContext
    )

    expect(signAndExecute).toHaveBeenCalled()
    expect(result.execution?.transactionResult.digest).toBe("0xabc")
    expect(result.summary?.digest).toBe("0xabc")
  })

  it("skips execution on dry-run", async () => {
    const toolingContext = {
      suiClient: {},
      suiConfig: {}
    } as never

    const result = await executeTransactionWithSummary(
      {
        transaction: {} as never,
        signer: {} as never,
        dryRun: true
      },
      toolingContext
    )

    expect(result.execution).toBeUndefined()
    expect(signAndExecute).not.toHaveBeenCalled()
    expect(maybeLogDevInspect).toHaveBeenCalled()
  })
})
