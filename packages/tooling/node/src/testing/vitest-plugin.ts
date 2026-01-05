import type { UserConfig } from "vitest/config"

export type ToolingVitestPluginOptions = {
  test?: UserConfig["test"]
}

const DEFAULT_TEST_OPTIONS: NonNullable<UserConfig["test"]> = {
  environment: "node",
  restoreMocks: true,
  clearMocks: true,
  unstubEnvs: true
}

const mergeTestOptions = (
  current: UserConfig["test"] | undefined,
  override: UserConfig["test"] | undefined
) => ({
  ...DEFAULT_TEST_OPTIONS,
  ...(current ?? {}),
  ...(override ?? {})
})

export const toolingVitestPlugin = (
  options?: ToolingVitestPluginOptions
): {
  name: string
  config: (config: UserConfig) => Pick<UserConfig, "test">
} => ({
  name: "sui-oracle-market:tooling-vitest",
  config: (config: UserConfig) => ({
    test: mergeTestOptions(config.test, options?.test)
  })
})
