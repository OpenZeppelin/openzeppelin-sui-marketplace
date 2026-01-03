import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { readFile } from "node:fs/promises"
import path from "node:path"

import { pickRootNonDependencyArtifact } from "@sui-oracle-market/tooling-node/artifacts"

import { createLocalnetHarness, withTestContext } from "../support/sui-localnet"

const localnetHarness = createLocalnetHarness()
const keepTemp = process.env.SUI_IT_KEEP_TEMP === "1"
const withFaucet = process.env.SUI_IT_WITH_FAUCET !== "0"

describe("move build and publish", () => {
  beforeAll(async () => {
    await localnetHarness.start({
      testId: "move-build-publish",
      keepTemp,
      withFaucet
    })
  })

  afterAll(async () => {
    await localnetHarness.stop()
  })

  it("builds the oracle-market Move package", async () => {
    await withTestContext(
      localnetHarness.get(),
      "move-build-oracle-market",
      async (context) => {
        const buildOutput = await context.buildMovePackage("oracle-market")

        expect(buildOutput.modules.length).toBeGreaterThan(0)
        expect(Array.isArray(buildOutput.dependencies)).toBe(true)
      }
    )
  })

  it("publishes the oracle-market Move package and writes artifacts", async () => {
    await withTestContext(
      localnetHarness.get(),
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
