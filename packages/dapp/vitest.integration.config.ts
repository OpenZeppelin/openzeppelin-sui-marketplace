import { defineConfig } from "vitest/config"

import { toolingVitestPlugin } from "@sui-oracle-market/tooling-node/testing/vitest-plugin"

export default defineConfig({
  plugins: [toolingVitestPlugin()],
  test: {
    include: ["src/scripts/**/test-integration/**/*.test.ts"],
    testTimeout: 280_000,
    hookTimeout: 280_000,
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: true
      }
    }
  }
})
