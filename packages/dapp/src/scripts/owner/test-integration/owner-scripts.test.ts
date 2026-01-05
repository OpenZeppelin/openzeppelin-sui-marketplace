import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  createDappIntegrationTestEnv,
  createShopFixture,
  runOwnerScriptJson
} from "./helpers.ts"

type ShopOverviewPayload = {
  shopOverview?: {
    shopId?: string
    ownerAddress?: string
    name?: string
  }
  transactionSummary?: {
    status?: string
  }
}

const testEnv = createDappIntegrationTestEnv()

describe("owner scripts integration", () => {
  beforeAll(async () => {
    await testEnv.startSuite("dapp-owner-scripts")
  })

  afterAll(async () => {
    await testEnv.stopSuite()
  })

  it("creates a shop and updates the owner", async () => {
    await testEnv.withTestContext(
      "shop-create-update-owner",
      async (context) => {
        const { publisher, scriptRunner, shopId, shopCreateOutput } =
          await createShopFixture(context, {
            shopName: "Integration Shop"
          })

        expect(shopCreateOutput.transactionSummary?.status).toBe("success")
        expect(shopCreateOutput.shopOverview?.shopId).toBeTruthy()

        const newOwner = context.createAccount("new-owner")
        const updatePayload = await runOwnerScriptJson<ShopOverviewPayload>(
          scriptRunner,
          "shop-update-owner",
          {
            account: publisher,
            args: {
              shopId,
              newOwner: newOwner.address
            }
          }
        )

        expect(updatePayload.transactionSummary?.status).toBe("success")
        expect(updatePayload.shopOverview?.ownerAddress).toBe(newOwner.address)
      }
    )
  })
})
