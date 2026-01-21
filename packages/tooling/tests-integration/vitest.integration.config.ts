import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const integrationRoot = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(integrationRoot, "..", "..", "..")
const resolveWorkspacePackage = (packagePath: string) =>
  path.join(workspaceRoot, packagePath)
const runSingleThread = process.env.SUI_IT_SINGLE_THREAD !== "0"

export default defineConfig({
  resolve: {
    alias: {
      "@sui-oracle-market/tooling-core": resolveWorkspacePackage(
        "packages/tooling/core/src"
      ),
      "@sui-oracle-market/tooling-node": resolveWorkspacePackage(
        "packages/tooling/node/src"
      )
    }
  },
  test: {
    environment: "node",
    include: ["integration/**/*.test.ts"],
    setupFiles: ["setup.ts"],
    restoreMocks: true,
    clearMocks: true,
    unstubEnvs: true,
    testTimeout: 600_000,
    hookTimeout: 600_000,
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: runSingleThread
      }
    }
  }
})
