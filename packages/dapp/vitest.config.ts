import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/test/**/*.test.ts"],
    restoreMocks: true,
    clearMocks: true,
    unstubEnvs: true
  }
})
