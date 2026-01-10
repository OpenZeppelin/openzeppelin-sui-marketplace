import { describe, it } from "vitest"

import {
  buildCreateShopTransaction,
  buildUpdateShopOwnerTransaction
} from "@sui-oracle-market/domain-core/ptb/shop"
import { getSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
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

describe("transactions and events", () => {
  it("creates a shop and updates the owner with event assertions", async () => {
    await testEnv.withTestContext(
      "transactions-create-shop",
      async (context) => {
        const publisher = context.createAccount("publisher")
        await context.fundAccount(publisher, { minimumCoinObjects: 2 })

        const artifacts = await context.publishPackage(
          "oracle-market",
          publisher,
          { withUnpublishedDependencies: true }
        )
        const rootArtifact = pickRootNonDependencyArtifact(artifacts)

        const createShopTransaction = buildCreateShopTransaction({
          packageId: rootArtifact.packageId,
          shopName: "Integration Shop"
        })
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
            eventTypeEndsWith(event.type, "::shop::ShopCreated"),
          label: "ShopCreated"
        })

        const newOwner = context.createAccount("new-owner")
        const shopShared = await getSuiSharedObject(
          { objectId: shopId, mutable: true },
          { suiClient: context.suiClient }
        )

        const updateOwnerTransaction = buildUpdateShopOwnerTransaction({
          packageId: rootArtifact.packageId,
          shop: shopShared,
          ownerCapId,
          newOwner: newOwner.address
        })
        const updateResult = await context.signAndExecuteTransaction(
          updateOwnerTransaction,
          publisher
        )
        await context.waitForFinality(updateResult.digest)

        await assertEventByDigest({
          suiClient: context.suiClient,
          digest: updateResult.digest,
          predicate: (event) =>
            eventTypeEndsWith(event.type, "::shop::ShopOwnerUpdated"),
          label: "ShopOwnerUpdated"
        })
      }
    )
  })
})
