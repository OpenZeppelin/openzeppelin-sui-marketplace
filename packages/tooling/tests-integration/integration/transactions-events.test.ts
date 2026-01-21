import { describe, it } from "vitest"

import type { WrappedSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { getSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { newTransaction } from "@sui-oracle-market/tooling-core/transactions"
import { pickRootNonDependencyArtifact } from "@sui-oracle-market/tooling-node/artifacts"

import {
  assertEventByDigest,
  assertObjectOwnerById,
  requireCreatedObjectId
} from "@sui-oracle-market/tooling-node/testing/assert"

import { createToolingIntegrationTestEnv } from "../helpers/env.ts"

const testEnv = createToolingIntegrationTestEnv()

const eventTypeEndsWith = (eventType: string, suffix: string) =>
  eventType.toLowerCase().endsWith(suffix.toLowerCase())

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

describe("transactions and events", () => {
  it("creates a shop and updates the owner with event assertions", async () => {
    await testEnv.withTestContext(
      "transactions-create-shop",
      async (context) => {
        const publisher = context.createAccount("publisher")
        await context.fundAccount(publisher, { minimumCoinObjects: 2 })

        const artifacts = await context.publishPackage(
          "simple-contract",
          publisher,
          { withUnpublishedDependencies: true }
        )
        const rootArtifact = pickRootNonDependencyArtifact(artifacts)

        const createShopTransaction = buildCreateShopTransaction(
          rootArtifact.packageId,
          "Integration Shop"
        )
        const createResult = await context.signAndExecuteTransaction(
          createShopTransaction,
          publisher
        )
        await context.waitForFinality(createResult.digest)

        const shopId = requireCreatedObjectId(
          createResult,
          "::shop::Shop",
          "Shop"
        )
        const ownerCapId = requireCreatedObjectId(
          createResult,
          "::shop::ShopOwnerCap",
          "ShopOwnerCap"
        )

        await assertObjectOwnerById({
          suiClient: context.suiClient,
          objectId: ownerCapId,
          expectedOwner: publisher.address,
          label: "ShopOwnerCap"
        })

        await assertEventByDigest({
          suiClient: context.suiClient,
          digest: createResult.digest,
          predicate: (event) =>
            eventTypeEndsWith(event.type, "::shop::ShopCreatedEvent"),
          label: "ShopCreatedEvent"
        })

        const newOwner = context.createAccount("new-owner")
        const shopShared = await getSuiSharedObject(
          { objectId: shopId, mutable: true },
          { suiClient: context.suiClient }
        )

        const updateOwnerTransaction = buildUpdateShopOwnerTransaction(
          rootArtifact.packageId,
          shopShared,
          ownerCapId,
          newOwner.address
        )
        const updateResult = await context.signAndExecuteTransaction(
          updateOwnerTransaction,
          publisher
        )
        await context.waitForFinality(updateResult.digest)

        await assertEventByDigest({
          suiClient: context.suiClient,
          digest: updateResult.digest,
          predicate: (event) =>
            eventTypeEndsWith(event.type, "::shop::ShopOwnerUpdatedEvent"),
          label: "ShopOwnerUpdatedEvent"
        })
      }
    )
  })
})
