import { defineConfig } from "vitest/config"

import { toolingVitestPlugin } from "@sui-oracle-market/tooling-node/testing/vitest-plugin"

export default defineConfig({
  plugins: [toolingVitestPlugin()],
  test: {
    include: ["src/scripts/**/test-integration/**/*.test.ts"],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: true
      }
    }
  }
})
