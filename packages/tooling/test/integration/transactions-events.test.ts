import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  buildCreateShopTransaction,
  buildUpdateShopOwnerTransaction
} from "@sui-oracle-market/domain-core/ptb/shop"
import { findCreatedObjectIds } from "@sui-oracle-market/tooling-core/transactions"
import { getSuiSharedObject } from "@sui-oracle-market/tooling-core/shared-object"
import { pickRootNonDependencyArtifact } from "@sui-oracle-market/tooling-node/artifacts"

import { createLocalnetHarness, withTestContext } from "../support/sui-localnet"

const localnetHarness = createLocalnetHarness()
const keepTemp = process.env.SUI_IT_KEEP_TEMP === "1"
const withFaucet = process.env.SUI_IT_WITH_FAUCET !== "0"

const requireCreatedObjectId = (ids: string[], label: string) => {
  const [objectId] = ids
  if (!objectId) {
    throw new Error(`Expected ${label} to be created, but none was found.`)
  }
  return objectId
}

const eventTypeEndsWith = (eventType: string, suffix: string) =>
  eventType.toLowerCase().endsWith(suffix.toLowerCase())

describe("transactions and events", () => {
  beforeAll(async () => {
    await localnetHarness.start({
      testId: "transactions-events",
      keepTemp,
      withFaucet
    })
  })

  afterAll(async () => {
    await localnetHarness.stop()
  })

  it("creates a shop and updates the owner with event assertions", async () => {
    await withTestContext(
      localnetHarness.get(),
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
          findCreatedObjectIds(createResult, "::shop::Shop"),
          "Shop"
        )
        const ownerCapId = requireCreatedObjectId(
          findCreatedObjectIds(createResult, "::shop::ShopOwnerCap"),
          "ShopOwnerCap"
        )

        const createdEvents = await context.queryEventsByTransaction(
          createResult.digest
        )
        const shopCreatedEvents = createdEvents.filter((event) =>
          eventTypeEndsWith(event.type, "::shop::ShopCreated")
        )

        expect(shopCreatedEvents.length).toBeGreaterThan(0)

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

        const updatedEvents = await context.queryEventsByTransaction(
          updateResult.digest
        )
        const shopOwnerUpdatedEvents = updatedEvents.filter((event) =>
          eventTypeEndsWith(event.type, "::shop::ShopOwnerUpdated")
        )

        expect(shopOwnerUpdatedEvents.length).toBeGreaterThan(0)
      }
    )
  })
})
