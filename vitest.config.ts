import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/tooling/**/test/**/*.test.ts"],
    setupFiles: ["packages/tooling/test/setup.ts"],
    restoreMocks: true,
    clearMocks: true,
    unstubEnvs: true,
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage/tooling",
      reporter: ["text", "lcov", "json"],
      include: ["packages/tooling/**/src/**/*.ts"],
      exclude: [
        "**/*.d.ts",
        "**/dist/**",
        "packages/ui/**",
        "packages/tooling/node/src/constants.ts"
      ],
      extension: [".ts"],
      lines: 35,
      branches: 25,
      functions: 30,
      statements: 35
    }
  }
})
