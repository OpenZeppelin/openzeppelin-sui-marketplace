import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  buildMoveEnvironmentFlags,
  buildMoveTestArguments,
  buildMoveTestPublishArguments,
  clearPublishedEntryForNetwork,
  resolveFullPackagePath,
  canonicalizePackagePath,
  hasDeploymentForPackage,
  syncMoveEnvironmentChainId
} from "../../src/move.ts"
import type { PublishArtifact } from "@sui-oracle-market/tooling-core/types"
import {
  readFixture,
  readTextFile,
  withTempDir,
  writeFileTree
} from "../../../test/helpers/fs.ts"

describe("move helpers", () => {
  const buildPublishArtifact = (
    overrides: Partial<PublishArtifact> = {}
  ): PublishArtifact => ({
    network: "localnet",
    rpcUrl: "http://localhost:9000",
    packagePath: "/tmp/contracts/../move/oracle-market",
    packageId: "0x1",
    sender: "0x2",
    digest: "digest",
    publishedAt: "2024-01-01T00:00:00Z",
    modules: [],
    dependencies: [],
    ...overrides
  })

  it("builds environment flags for move commands", () => {
    expect(buildMoveEnvironmentFlags({})).toEqual([])
    expect(buildMoveEnvironmentFlags({ environmentName: "localnet" })).toEqual([
      "--environment",
      "localnet"
    ])
  })

  it("builds move test arguments with environment name", () => {
    const args = buildMoveTestArguments({
      packagePath: "/tmp/pkg",
      environmentName: "testnet"
    })
    expect(args).toEqual(["--path", "/tmp/pkg", "--environment", "testnet"])
  })

  it("builds test publish arguments with flags", () => {
    const args = buildMoveTestPublishArguments({
      packagePath: "/tmp/pkg",
      buildEnvironmentName: "localnet",
      publicationFilePath: "/tmp/publish.json",
      withUnpublishedDependencies: true
    })
    expect(args).toEqual([
      "/tmp/pkg",
      "--build-env",
      "localnet",
      "--pubfile-path",
      "/tmp/publish.json",
      "--with-unpublished-dependencies"
    ])
  })

  it("normalizes package paths for comparisons", () => {
    const normalized = canonicalizePackagePath("./foo/../bar")
    expect(normalized.endsWith(path.join("bar"))).toBe(true)
  })

  it("resolves package paths relative to move root", () => {
    const moveRoot = "/tmp/move"
    const resolved = resolveFullPackagePath(moveRoot, "packages/oracle")
    expect(resolved).toBe(path.join(moveRoot, "packages", "oracle"))
  })

  it("matches deployments by canonicalized path", () => {
    const artifacts = [
      buildPublishArtifact({
        packagePath: "/tmp/contracts/../move/oracle-market"
      })
    ]
    expect(hasDeploymentForPackage(artifacts, "/tmp/move/oracle-market")).toBe(
      true
    )
  })
})

describe("syncMoveEnvironmentChainId", () => {
  it("inserts environments block when needed", async () => {
    const moveToml = await readFixture("move", "Move.toml")

    await withTempDir(async (dir) => {
      await writeFileTree(dir, { "Move.toml": moveToml })

      const result = await syncMoveEnvironmentChainId({
        moveRootPath: dir,
        environmentName: "localnet",
        chainId: "0xabc"
      })

      expect(result.updatedFiles).toEqual([path.join(dir, "Move.toml")])

      const updated = await readTextFile(path.join(dir, "Move.toml"))
      expect(updated).toContain("[environments]")
      expect(updated).toContain('localnet = "0xabc"')
    })
  })

  it("skips updates when no environment markers exist", async () => {
    await withTempDir(async (dir) => {
      await writeFileTree(dir, {
        "Move.toml": '[package]\nname = "noop"\nversion = "0.0.1"\n'
      })

      const result = await syncMoveEnvironmentChainId({
        moveRootPath: dir,
        environmentName: "localnet",
        chainId: "0x123"
      })

      expect(result.updatedFiles).toEqual([])

      const unchanged = await readTextFile(path.join(dir, "Move.toml"))
      expect(unchanged).toBe('[package]\nname = "noop"\nversion = "0.0.1"\n')
    })
  })
})

describe("clearPublishedEntryForNetwork", () => {
  it("removes the published section for a network", async () => {
    const published = await readFixture("move", "Published.toml")

    await withTempDir(async (dir) => {
      const publishedPath = path.join(dir, "Published.toml")
      await writeFileTree(dir, { "Published.toml": published })

      const result = await clearPublishedEntryForNetwork({
        packagePath: dir,
        networkName: "localnet"
      })

      expect(result.publishedTomlPath).toBe(publishedPath)
      expect(result.didUpdate).toBe(true)

      const updated = await readTextFile(publishedPath)
      expect(updated).not.toContain("[published.localnet]")
      expect(updated).toContain("[published.testnet]")
    })
  })

  it("no-ops when network name is undefined", async () => {
    const published = await readFixture("move", "Published.toml")

    await withTempDir(async (dir) => {
      const publishedPath = path.join(dir, "Published.toml")
      await writeFileTree(dir, { "Published.toml": published })

      const result = await clearPublishedEntryForNetwork({
        packagePath: dir,
        networkName: undefined
      })

      expect(result.publishedTomlPath).toBe(publishedPath)
      expect(result.didUpdate).toBe(false)

      const unchanged = await readTextFile(publishedPath)
      expect(unchanged).toBe(published)
    })
  })
})
