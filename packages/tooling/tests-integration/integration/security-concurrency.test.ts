import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  buildCreateShopTransaction,
  buildUpdateShopOwnerTransaction
} from "@sui-oracle-market/domain-core/ptb/shop"
import { newTransaction } from "@sui-oracle-market/tooling-core/transactions"
import { getSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { pickRootNonDependencyArtifact } from "@sui-oracle-market/tooling-node/artifacts"
import { signAndExecute } from "@sui-oracle-market/tooling-node/transactions"

import { withEnv } from "../helpers/env"
import { createSuiLocalnetTestEnv } from "@sui-oracle-market/tooling-node/testing/env"
import { requireCreatedObjectId } from "@sui-oracle-market/tooling-node/testing/assert"
import type {
  TestAccount,
  TestContext
} from "@sui-oracle-market/tooling-node/testing/localnet"

const keepTemp = process.env.SUI_IT_KEEP_TEMP === "1"
const withFaucet = process.env.SUI_IT_WITH_FAUCET !== "0"
const testEnv = createSuiLocalnetTestEnv({
  mode: "suite",
  keepTemp,
  withFaucet
})

const unwrapSplitCoin = <T>(value: T | T[]) =>
  Array.isArray(value) ? value[0] : value

const publishOracleMarket = async (
  context: TestContext,
  publisherLabel: string
) => {
  const publisher = context.createAccount(publisherLabel)
  await context.fundAccount(publisher, { minimumCoinObjects: 2 })

  const artifacts = await context.publishPackage("oracle-market", publisher, {
    withUnpublishedDependencies: true
  })
  const rootArtifact = pickRootNonDependencyArtifact(artifacts)

  return { publisher, packageId: rootArtifact.packageId }
}

const createShop = async (
  context: TestContext,
  packageId: string,
  owner: TestAccount,
  shopName: string
) => {
  const createShopTransaction = buildCreateShopTransaction({
    packageId,
    shopName
  })
  const createResult = await context.signAndExecuteTransaction(
    createShopTransaction,
    owner
  )
  await context.waitForFinality(createResult.digest)

  const shopId = requireCreatedObjectId(createResult, "::shop::Shop", "Shop")
  const ownerCapId = requireCreatedObjectId(
    createResult,
    "::shop::ShopOwnerCap",
    "ShopOwnerCap"
  )

  const shopShared = await getSuiSharedObject(
    { objectId: shopId, mutable: true },
    { suiClient: context.suiClient }
  )

  return { shopId, ownerCapId, shopShared }
}

describe("security and concurrency", () => {
  beforeAll(async () => {
    await testEnv.startSuite("security-concurrency")
  })

  afterAll(async () => {
    await testEnv.stopSuite()
  })

  it("rejects owner-cap misuse between shops", async () => {
    await testEnv.withTestContext("security-owner-cap", async (context) => {
      const { publisher, packageId } = await publishOracleMarket(
        context,
        "publisher-a"
      )
      const secondOwner = context.createAccount("publisher-b")
      await context.fundAccount(secondOwner, { minimumCoinObjects: 2 })

      const shopA = await createShop(context, packageId, publisher, "Shop A")
      const shopB = await createShop(context, packageId, secondOwner, "Shop B")

      const updateOwnerTransaction = buildUpdateShopOwnerTransaction({
        packageId,
        shop: shopA.shopShared,
        ownerCapId: shopB.ownerCapId,
        newOwner: secondOwner.address
      })

      await expect(
        context.signAndExecuteTransaction(updateOwnerTransaction, secondOwner)
      ).rejects.toThrow()
    })
  })

  it("rejects transactions signed by a different sender", async () => {
    await testEnv.withTestContext(
      "security-signer-mismatch",
      async (context) => {
        const sender = context.createAccount("sender")
        const signer = context.createAccount("signer")
        await context.fundAccount(sender, { minimumCoinObjects: 2 })
        await context.fundAccount(signer, { minimumCoinObjects: 2 })

        const transaction = newTransaction()
        const splitCoin = transaction.splitCoins(transaction.gas, [
          transaction.pure.u64(1_000_000n)
        ])
        transaction.transferObjects(
          [unwrapSplitCoin(splitCoin)],
          transaction.pure.address(sender.address)
        )
        transaction.setSender(sender.address)

        await expect(
          withEnv({ SUI_ARTIFACTS_DIR: context.artifactsDir }, () =>
            signAndExecute(
              { transaction, signer: signer.keypair },
              { suiClient: context.suiClient, suiConfig: context.suiConfig }
            )
          )
        ).rejects.toThrow()
      }
    )
  })

  it("retries when two transactions contend on the same gas coin", async () => {
    await testEnv.withTestContext("concurrency-gas", async (context) => {
      const account = context.createAccount("gas-owner")
      await context.fundAccount(account, { minimumCoinObjects: 2 })

      const coins = await context.suiClient.getCoins({
        owner: account.address,
        coinType: "0x2::sui::SUI",
        limit: 1
      })
      const gasCoin = coins.data[0]
      if (!gasCoin) {
        throw new Error("Missing gas coin after funding")
      }

      const buildContendedTransfer = (recipientAddress: string) => {
        const transaction = newTransaction()
        const splitCoin = transaction.splitCoins(transaction.gas, [
          transaction.pure.u64(1_000_000n)
        ])
        transaction.transferObjects(
          [unwrapSplitCoin(splitCoin)],
          transaction.pure.address(recipientAddress)
        )
        transaction.setGasPayment([
          {
            objectId: gasCoin.coinObjectId,
            version: gasCoin.version,
            digest: gasCoin.digest
          }
        ])
        transaction.setGasOwner(account.address)
        return transaction
      }

      const txA = buildContendedTransfer(context.createAccount("a").address)
      const txB = buildContendedTransfer(context.createAccount("b").address)

      const results = await Promise.allSettled([
        context.signAndExecuteTransaction(txA, account),
        context.signAndExecuteTransaction(txB, account)
      ])

      const successCount = results.filter(
        (result) => result.status === "fulfilled"
      ).length
      const errors = results
        .filter((result) => result.status === "rejected")
        .map((result) => result.reason as Error)

      expect(successCount).toBeGreaterThan(0)
      if (errors.length > 0) {
        const errorMessages = errors.map((error) => error.message).join("\n")
        expect(errorMessages).toMatch(/object|lock|gas|stale/i)
      }
    })
  })

  it("fails when the signer has no gas", async () => {
    await testEnv.withTestContext("security-no-gas", async (context) => {
      const account = context.createAccount("unfunded")

      const transaction = newTransaction()
      const splitCoin = transaction.splitCoins(transaction.gas, [
        transaction.pure.u64(1_000_000n)
      ])
      transaction.transferObjects(
        [unwrapSplitCoin(splitCoin)],
        transaction.pure.address(context.createAccount("recipient").address)
      )

      await expect(
        context.signAndExecuteTransaction(transaction, account)
      ).rejects.toThrow(/gas|coin/i)
    })
  })
})
