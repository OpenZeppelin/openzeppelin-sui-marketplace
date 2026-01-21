import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { pickRootNonDependencyArtifact } from "@sui-oracle-market/tooling-node/artifacts"
import {
  createSuiScriptRunner,
  parseJsonFromScriptOutput
} from "@sui-oracle-market/tooling-node/testing/scripts"

import { createToolingIntegrationTestEnv } from "../helpers/env.ts"

const testEnv = createToolingIntegrationTestEnv()

describe("script runner", () => {
  it("runs owner shop-create script on localnet", async () => {
    await testEnv.withTestContext("owner-shop-create", async (context) => {
      const publisher = context.createAccount("publisher")
      await context.fundAccount(publisher, { minimumCoinObjects: 2 })

      const artifacts = await context.publishPackage(
        "simple-contract",
        publisher,
        { withUnpublishedDependencies: true }
      )
      const rootArtifact = pickRootNonDependencyArtifact(artifacts)

      const scriptRunner = createSuiScriptRunner(context)
      const result = await scriptRunner.runOwnerScript("shop-create", {
        account: publisher,
        args: {
          json: true,
          shopPackageId: rootArtifact.packageId,
          name: "Script Shop"
        }
      })

      expect(result.exitCode).toBe(0)
      const parsed = parseJsonFromScriptOutput<{
        shopOverview?: { shopId?: string }
      }>(result.stdout, "shop-create output")
      expect(parsed.shopOverview?.shopId).toBeTruthy()

      const objectsPath = path.join(
        context.artifactsDir,
        "objects.localnet.json"
      )
      const objectsContents = await readFile(objectsPath, "utf8")
      const objects = JSON.parse(objectsContents) as Array<{
        objectType?: string
      }>

      const hasShopObject = objects.some((entry) =>
        entry.objectType?.endsWith("::shop::Shop")
      )
      expect(hasShopObject).toBe(true)
    })
  })
})
