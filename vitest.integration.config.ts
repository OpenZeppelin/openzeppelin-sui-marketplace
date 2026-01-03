import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const workspaceRoot = path.dirname(fileURLToPath(import.meta.url))
const resolveWorkspacePackage = (packagePath: string) =>
  path.join(workspaceRoot, packagePath)

export default defineConfig({
  resolve: {
    alias: {
      "@sui-oracle-market/tooling-core": resolveWorkspacePackage(
        "packages/tooling/core/src"
      ),
      "@sui-oracle-market/tooling-node": resolveWorkspacePackage(
        "packages/tooling/node/src"
      ),
      "@sui-oracle-market/domain-core": resolveWorkspacePackage(
        "packages/domain/core/src"
      ),
      "@sui-oracle-market/domain-node": resolveWorkspacePackage(
        "packages/domain/node/src"
      )
    }
  },
  test: {
    environment: "node",
    include: ["packages/tooling/**/test/integration/**/*.test.ts"],
    setupFiles: ["packages/tooling/test/setup.ts"],
    restoreMocks: true,
    clearMocks: true,
    unstubEnvs: true,
    testTimeout: 180_000,
    hookTimeout: 180_000,
    pool: "threads"
  }
})
