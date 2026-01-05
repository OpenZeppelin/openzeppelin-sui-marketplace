import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { newTransaction } from "@sui-oracle-market/tooling-core/transactions"

import { createSuiLocalnetTestEnv } from "@sui-oracle-market/tooling-node/testing/env"

const keepTemp = process.env.SUI_IT_KEEP_TEMP === "1"
const withFaucet = process.env.SUI_IT_WITH_FAUCET !== "0"
const testEnv = createSuiLocalnetTestEnv({
  mode: "suite",
  keepTemp,
  withFaucet
})

const unwrapSplitCoin = <T>(value: T | T[]) =>
  Array.isArray(value) ? value[0] : value

describe("localnet smoke", () => {
  beforeAll(async () => {
    await testEnv.startSuite("localnet-smoke")
  })

  afterAll(async () => {
    await testEnv.stopSuite()
  })

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
})
