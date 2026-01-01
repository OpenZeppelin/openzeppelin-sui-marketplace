import path from "node:path"
import { describe, expect, it } from "vitest"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import type { ObjectArtifact } from "@sui-oracle-market/tooling-core/object"
import type { PublishArtifact } from "@sui-oracle-market/tooling-core/types"
import { withCwd } from "../../../test/helpers/cwd.ts"
import {
  readTextFile,
  withTempDir,
  writeFileTree
} from "../../../test/helpers/fs.ts"
import {
  findLatestArtifactThat,
  getLatestArtifact,
  getLatestDeploymentFromArtifact,
  getLatestObjectFromArtifact,
  getObjectArtifactPath,
  getDeploymentArtifactPath,
  isPublishArtifactNamed,
  pickRootNonDependencyArtifact,
  readArtifact,
  resolvePublisherCapIdFromObjectArtifacts,
  writeObjectArtifact
} from "../../src/artifacts.ts"

describe("pickRootNonDependencyArtifact", () => {
  it("selects the first non-dependency artifact", () => {
    const artifacts = [
      { packageId: "0x1", isDependency: true },
      { packageId: "0x2", isDependency: false }
    ] as PublishArtifact[]

    expect(pickRootNonDependencyArtifact(artifacts).packageId).toBe("0x2")
  })

  it("throws when artifacts are empty", () => {
    expect(() => pickRootNonDependencyArtifact([])).toThrow(
      "No artifacts to select from."
    )
  })
})

describe("writeObjectArtifact", () => {
  it("dedupes by objectId and keeps the latest entry", async () => {
    await withTempDir(async (dir) => {
      const artifactPath = path.join(dir, "objects.json")
      const first: ObjectArtifact[] = [
        { objectId: "0x1", packageId: "0x2", signer: "0x3", objectType: "A" }
      ]
      const second: ObjectArtifact[] = [
        { objectId: "0x1", packageId: "0x2", signer: "0x3", objectType: "B" }
      ]

      await writeObjectArtifact(artifactPath, first)
      const merged = await writeObjectArtifact(artifactPath, second)

      expect(merged).toHaveLength(1)
      expect(merged[0]?.objectType).toBe("B")
    })
  })
})

describe("readArtifact", () => {
  it("creates the file with defaults when missing", async () => {
    await withTempDir(async (dir) => {
      const artifactPath = path.join(dir, "deployment.json")
      const defaults: PublishArtifact[] = []

      const result = await readArtifact(artifactPath, defaults)
      const persisted = JSON.parse(await readTextFile(artifactPath))

      expect(result).toEqual(defaults)
      expect(persisted).toEqual(defaults)
    })
  })
})

describe("latest artifact helpers", () => {
  it("returns latest artifact by publishedAt when available", () => {
    const artifacts = [
      { packageId: "0x1", publishedAt: "2024-01-01T00:00:00Z" },
      { packageId: "0x2", publishedAt: "2024-01-02T00:00:00Z" }
    ] as PublishArtifact[]

    expect(getLatestArtifact(artifacts)?.packageId).toBe("0x2")
  })

  it("returns latest artifact that matches predicate", () => {
    const artifacts = [
      {
        packageId: "0x1",
        packageName: "foo",
        publishedAt: "2024-01-01T00:00:00Z"
      },
      {
        packageId: "0x2",
        packageName: "bar",
        publishedAt: "2024-01-02T00:00:00Z"
      }
    ] as PublishArtifact[]

    const match = findLatestArtifactThat(
      (artifact) => artifact.packageName === "bar",
      artifacts
    )

    expect(match?.packageId).toBe("0x2")
  })
})

describe("artifact path helpers", () => {
  it("normalizes object/deployment artifacts from disk", async () => {
    await withTempDir(async (dir) => {
      const networkName = "localnet"
      await withCwd(dir, async () => {
        const objectArtifactPath = getObjectArtifactPath(networkName)
        const deploymentArtifactPath = getDeploymentArtifactPath(networkName)

        const objectArtifacts = [
          {
            packageId: "0x2",
            signer: "0x3",
            objectId: "0x4",
            objectType: "0x2::module::Struct"
          }
        ]
        const deploymentArtifacts = [
          {
            packageId: "0x5",
            packageName: "oracle-market",
            packagePath: "/tmp/move/oracle-market",
            publishedAt: "2024-01-01T00:00:00Z"
          }
        ]

        await writeFileTree(dir, {
          [path.relative(dir, objectArtifactPath)]: JSON.stringify(
            objectArtifacts,
            null,
            2
          ),
          [path.relative(dir, deploymentArtifactPath)]: JSON.stringify(
            deploymentArtifacts,
            null,
            2
          )
        })

        const latestObject =
          await getLatestObjectFromArtifact("::Struct")(networkName)
        const latestDeployment =
          await getLatestDeploymentFromArtifact("oracle-market")(networkName)

        expect(latestObject?.objectId).toBe(normalizeSuiObjectId("0x4"))
        expect(latestDeployment?.packageId).toBe(normalizeSuiObjectId("0x5"))
      })
    })
  })
})

describe("isPublishArtifactNamed", () => {
  it("matches by normalized package name or path", () => {
    const matcher = isPublishArtifactNamed("oracle-market")

    expect(
      matcher({
        packageName: "Oracle-Market",
        packagePath: "/tmp/move/oracle-market"
      } as PublishArtifact)
    ).toBe(true)
  })
})

describe("resolvePublisherCapIdFromObjectArtifacts", () => {
  it("returns the publisher object id for a digest", async () => {
    await withTempDir(async (dir) => {
      const networkName = "localnet"
      await withCwd(dir, async () => {
        const objectArtifactPath = getObjectArtifactPath(networkName)
        const objectArtifacts = [
          {
            packageId: "0x1",
            signer: "0x2",
            objectId: "0x3",
            objectType: "0x2::package::Publisher",
            digest: "digest-123"
          }
        ]

        await writeFileTree(dir, {
          [path.relative(dir, objectArtifactPath)]: JSON.stringify(
            objectArtifacts,
            null,
            2
          )
        })

        const publisherId = await resolvePublisherCapIdFromObjectArtifacts({
          networkName,
          publishDigest: "digest-123"
        })

        expect(publisherId).toBe("0x3")
      })
    })
  })
})
