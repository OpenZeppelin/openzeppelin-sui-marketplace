import { createSuiLocalnetTestEnv } from "@sui-oracle-market/tooling-node/testing/env"

import { fixturePath } from "./fs.ts"

const resolveKeepTemp = () => process.env.SUI_IT_KEEP_TEMP === "1"

const resolveWithFaucet = () => process.env.SUI_IT_WITH_FAUCET !== "0"

export const createToolingIntegrationTestEnv = () =>
  createSuiLocalnetTestEnv({
    mode: "test",
    keepTemp: resolveKeepTemp(),
    withFaucet: resolveWithFaucet(),
    moveSourceRootPath: fixturePath("localnet-move")
  })

type EnvOverrideEntry = {
  token: symbol
  value: string | undefined
}

type EnvOverrideState = {
  baseline: string | undefined
  overrides: EnvOverrideEntry[]
}

const envOverrideStacks = new Map<string, EnvOverrideState>()

const setEnvValue = (key: string, value: string | undefined) => {
  if (value === undefined) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete process.env[key]
    return
  }
  process.env[key] = value
}

const applyEnvOverride = (key: string, value: string | undefined) => {
  const token = Symbol(key)
  const existing = envOverrideStacks.get(key)
  if (!existing) {
    envOverrideStacks.set(key, {
      baseline: process.env[key],
      overrides: [{ token, value }]
    })
  } else {
    existing.overrides.push({ token, value })
  }

  setEnvValue(key, value)
  return token
}

const releaseEnvOverride = (key: string, token: symbol) => {
  const state = envOverrideStacks.get(key)
  if (!state) return

  const index = state.overrides.findIndex((entry) => entry.token === token)
  if (index === -1) return

  state.overrides.splice(index, 1)

  const next = state.overrides[state.overrides.length - 1]
  if (next) {
    setEnvValue(key, next.value)
    return
  }

  envOverrideStacks.delete(key)
  setEnvValue(key, state.baseline)
}

export const withEnv = async <T>(
  updates: Record<string, string | undefined>,
  action: () => Promise<T> | T
): Promise<T> => {
  const applied = Object.entries(updates).map(([key, value]) => ({
    key,
    token: applyEnvOverride(key, value)
  }))

  try {
    return await action()
  } finally {
    for (let index = applied.length - 1; index >= 0; index -= 1) {
      const entry = applied[index]
      releaseEnvOverride(entry.key, entry.token)
    }
  }
}
