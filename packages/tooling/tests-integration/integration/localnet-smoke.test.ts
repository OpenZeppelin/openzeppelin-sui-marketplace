import { describe, expect, it } from "vitest"

import {
  newTransaction,
  resolveSplitCoinResult
} from "@sui-oracle-market/tooling-core/transactions"

import { createToolingIntegrationTestEnv } from "../helpers/env.ts"

const testEnv = createToolingIntegrationTestEnv()

const unwrapSplitCoin = (value: Parameters<typeof resolveSplitCoinResult>[0]) =>
  resolveSplitCoinResult(value, 0)

describe("localnet smoke", () => {
  it("funds an account and transfers SUI", async () => {
    await testEnv.withTestContext(
      "localnet-smoke-transfer",
      async (context) => {
        const sender = context.createAccount("sender")
        const recipient = context.createAccount("recipient")

        await context.fundAccount(sender, { minimumCoinObjects: 2 })

        const transaction = newTransaction()
        const splitCoin = transaction.splitCoins(transaction.gas, [
          transaction.pure.u64(1_000_000n)
        ])
        transaction.transferObjects(
          [unwrapSplitCoin(splitCoin)],
          transaction.pure.address(recipient.address)
        )

        const result = await context.signAndExecuteTransaction(
          transaction,
          sender
        )
        await context.waitForFinality(result.digest)

        const balance = await context.suiClient.getBalance({
          owner: recipient.address,
          coinType: "0x2::sui::SUI"
        })

        expect(BigInt(balance.totalBalance)).toBeGreaterThan(0n)
      }
    )
  })

  it("allocates unique directories per test context", async () => {
    const firstPaths = await testEnv.withTestContext(
      "localnet-smoke-paths-a",
      async (context) => ({
        artifactsDir: context.artifactsDir,
        tempDir: context.tempDir
      })
    )

    const secondPaths = await testEnv.withTestContext(
      "localnet-smoke-paths-b",
      async (context) => ({
        artifactsDir: context.artifactsDir,
        tempDir: context.tempDir
      })
    )

    expect(secondPaths.artifactsDir).not.toBe(firstPaths.artifactsDir)
    expect(secondPaths.tempDir).not.toBe(firstPaths.tempDir)
  })
})
