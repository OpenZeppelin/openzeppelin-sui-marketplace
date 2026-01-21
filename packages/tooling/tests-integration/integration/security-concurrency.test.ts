import { describe, expect, it } from "vitest"

import type { WrappedSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { getSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import {
  newTransaction,
  resolveSplitCoinResult
} from "@sui-oracle-market/tooling-core/transactions"
import {
  pickRootNonDependencyArtifact,
  withArtifactsRoot
} from "@sui-oracle-market/tooling-node/artifacts"
import { signAndExecute } from "@sui-oracle-market/tooling-node/transactions"

import { requireCreatedObjectId } from "@sui-oracle-market/tooling-node/testing/assert"

import type {
  TestAccount,
  TestContext
} from "@sui-oracle-market/tooling-node/testing/localnet"
import { createToolingIntegrationTestEnv } from "../helpers/env.ts"

const testEnv = createToolingIntegrationTestEnv()

const unwrapSplitCoin = (value: Parameters<typeof resolveSplitCoinResult>[0]) =>
  resolveSplitCoinResult(value, 0)

const publishSimpleContract = async (
  context: TestContext,
  publisherLabel: string
) => {
  const publisher = context.createAccount(publisherLabel)
  await context.fundAccount(publisher, { minimumCoinObjects: 2 })

  const artifacts = await context.publishPackage("simple-contract", publisher, {
    withUnpublishedDependencies: true
  })
  const rootArtifact = pickRootNonDependencyArtifact(artifacts)

  return { publisher, packageId: rootArtifact.packageId }
}

const encodeShopName = (name: string) => {
  if (!name.trim()) throw new Error("Shop name cannot be empty.")
  return new TextEncoder().encode(name)
}

const buildCreateShopTransaction = (packageId: string, shopName: string) => {
  const transaction = newTransaction()
  transaction.moveCall({
    target: `${packageId}::shop::create_shop`,
    arguments: [transaction.pure.vector("u8", encodeShopName(shopName))]
  })
  return transaction
}

const buildUpdateShopOwnerTransaction = (
  packageId: string,
  shop: WrappedSuiSharedObject,
  ownerCapId: string,
  newOwner: string
) => {
  const transaction = newTransaction()
  const shopArgument = transaction.sharedObjectRef(shop.sharedRef)
  transaction.moveCall({
    target: `${packageId}::shop::update_shop_owner`,
    arguments: [
      shopArgument,
      transaction.object(ownerCapId),
      transaction.pure.address(newOwner)
    ]
  })
  return transaction
}

const createShop = async (
  context: TestContext,
  packageId: string,
  owner: TestAccount,
  shopName: string
) => {
  const createShopTransaction = buildCreateShopTransaction(packageId, shopName)
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
  it("rejects owner-cap misuse between shops", async () => {
    await testEnv.withTestContext("security-owner-cap", async (context) => {
      const { publisher, packageId } = await publishSimpleContract(
        context,
        "publisher-a"
      )
      const secondOwner = context.createAccount("publisher-b")
      await context.fundAccount(secondOwner, { minimumCoinObjects: 2 })

      const shopA = await createShop(context, packageId, publisher, "Shop A")
      const shopB = await createShop(context, packageId, secondOwner, "Shop B")

      const updateOwnerTransaction = buildUpdateShopOwnerTransaction(
        packageId,
        shopA.shopShared,
        shopB.ownerCapId,
        secondOwner.address
      )

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
          withArtifactsRoot(context.artifactsDir, () =>
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
