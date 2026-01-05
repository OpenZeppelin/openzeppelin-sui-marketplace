import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { readFile } from "node:fs/promises"
import path from "node:path"

import { pickRootNonDependencyArtifact } from "@sui-oracle-market/tooling-node/artifacts"

import { createSuiLocalnetTestEnv } from "@sui-oracle-market/tooling-node/testing/env"

const keepTemp = process.env.SUI_IT_KEEP_TEMP === "1"
const withFaucet = process.env.SUI_IT_WITH_FAUCET !== "0"
const testEnv = createSuiLocalnetTestEnv({
  mode: "suite",
  keepTemp,
  withFaucet
})

describe("move build and publish", () => {
  beforeAll(async () => {
    await testEnv.startSuite("move-build-publish")
  })

  afterAll(async () => {
    await testEnv.stopSuite()
  })

  it("builds the oracle-market Move package", async () => {
    await testEnv.withTestContext(
      "move-build-oracle-market",
      async (context) => {
        const buildOutput = await context.buildMovePackage("oracle-market")

        expect(buildOutput.modules.length).toBeGreaterThan(0)
        expect(Array.isArray(buildOutput.dependencies)).toBe(true)
      }
    )
  })

  it("publishes the oracle-market Move package and writes artifacts", async () => {
    await testEnv.withTestContext(
      "move-publish-oracle-market",
      async (context) => {
        const publisher = context.createAccount("publisher")
        await context.fundAccount(publisher, { minimumCoinObjects: 2 })

        const artifacts = await context.publishPackage(
          "oracle-market",
          publisher,
          { withUnpublishedDependencies: true }
        )

        const rootArtifact = pickRootNonDependencyArtifact(artifacts)
        expect(rootArtifact.packageId).toMatch(/^0x[0-9a-fA-F]+$/)

        const deploymentPath = path.join(
          context.artifactsDir,
          "deployment.localnet.json"
        )
        const deploymentContents = await readFile(deploymentPath, "utf8")

        expect(deploymentContents).toContain(rootArtifact.packageId)
      }
    )
  })
})
