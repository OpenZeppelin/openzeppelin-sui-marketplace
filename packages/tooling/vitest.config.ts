import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/test-unit/**/*.test.ts"],
    setupFiles: ["tests-integration/setup.ts"],
    restoreMocks: true,
    clearMocks: true,
    unstubEnvs: true,
    coverage: {
      provider: "v8",
      reportsDirectory: "../../coverage/tooling",
      reporter: ["text", "lcov", "json"],
      include: ["core/src/**/*.ts", "node/src/**/*.ts"],
      exclude: [
        "**/*.d.ts",
        "**/dist/**",
        "node/src/constants.ts",
        "**/src/**/types.ts",
        "**/src/**/type-utils.ts"
      ],
      extension: [".ts"],
      lines: 35,
      branches: 25,
      functions: 30,
      statements: 35
    }
  }
})
